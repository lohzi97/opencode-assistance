import process from "node:process";
import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  loadWorkerConfig,
  type ProactiveBudgetPolicy,
  type ProactiveConfig,
  type ProactivePrecheck,
  type ProactiveTaskConfig,
  type ProactiveTrigger,
  type QuietHoursConfig,
  type WorkerConfig,
  workerConfigFile,
} from "./config";
import {
  createAnchorWindow,
  appendRunLedger,
  ensureAnchorState,
  ensureTaskState,
  findAnchorWindow,
  loadDeliveryRuntimeState,
  loadProactiveState,
  mutateProactiveState,
  randomID,
  removeAnchorWindow,
  pruneTimestamps,
  sortQueue,
  writeDeliveryRuntimeState,
  writeFailureArtifact,
  type DeliveryRuntimeState,
  type ProactiveActiveRun,
  type ProactiveAnchorAction,
  type ProactiveAnchorState,
  type ProactiveAnchorWindow,
  type ProactiveExecutionMode,
  type ProactiveLane,
  type ProactiveQueueItem,
  type ProactiveQueueSource,
  type ProactiveRunLedgerEntry,
  type ProactiveRunStatus,
  type ProactiveState,
} from "./proactive-state";
import { inspectOutcome, waitForSessionCompletion } from "./run-monitor";
import {
  OpenCodeClient,
  parseJsonc,
  readText,
  record,
  root,
  sleep,
  type BusEventPayload,
  type MessageWithParts,
  type ModelRef,
} from "./shared";

type AdmissionInput = {
  task: ProactiveTaskConfig;
  source: ProactiveQueueSource;
  now: number;
  wakeReason?: string;
  kind: "configured-task" | "ad_hoc";
  taskID?: string;
  taskName?: string;
  triggerKind?: string;
  title?: string;
  instructions: string;
  mode: ProactiveExecutionMode;
  anchorAction?: ProactiveAnchorAction;
  priority: number;
  ttlMs: number;
  notBefore: number;
  dedupeKey?: string;
  agent?: string;
  model?: ModelRef;
  context?: Record<string, unknown>;
  command?: string[];
  scheduledAt?: number;
  attempt?: number;
  enforceEnabled?: boolean;
  anchorWindowID?: string;
  bypassAnchorNoOverlap?: boolean;
};

type AdmissionOutcome = {
  queueItem?: ProactiveQueueItem;
  suppressed?: {
    queueID: string;
    reason: string;
    status?: ProactiveRunStatus;
  };
};

type DispatchClaim = {
  queueItem: ProactiveQueueItem;
  activeRun: ProactiveActiveRun;
  task?: ProactiveTaskConfig;
};

type PrecheckResult = {
  decision: "proceed" | "skip" | "error";
  reason: string;
  context?: Record<string, unknown>;
  dedupe_key?: string;
  ttl_ms?: number;
  raw_stdout?: string;
  raw_stderr?: string;
};

type RunFinishInput = {
  status: ProactiveRunStatus;
  summary?: string;
  error?: string;
  suppressionReason?: string;
  finalSessionID?: string;
  pid?: number;
  retryable?: boolean;
  failureArtifact?: Record<string, unknown>;
  retryAsAnchorAction?: ProactiveAnchorAction;
};

const DEFAULT_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const CONFIG_RELOAD_DEBOUNCE_MS = 250;
// Lands each tick a few hundred ms inside the interval boundary so clock
// jitter can never make a tick compute the previous minute.
const TICK_BOUNDARY_GUARD_MS = 300;
const ANCHOR_END_PRIORITY_BOOST = 2000;
const ANCHOR_ROLLOVER_PRIORITY_BOOST = 1000;

export class ProactiveService {
  private readonly client: OpenCodeClient;
  private workerConfig?: WorkerConfig;
  private config?: ProactiveConfig;
  private timer?: ReturnType<typeof setTimeout>;
  private configWatcher?: FSWatcher;
  private configReloadTimer?: ReturnType<typeof setTimeout>;
  private configReloadInFlight?: Promise<boolean>;
  private tickInFlight?: Promise<void>;
  private configMTimeMs?: number;
  private runtimePrepared = false;
  private providersLoadedAt = 0;
  private readonly providers = new Map<string, number>();
  private defaultModel?: ModelRef;

  constructor(client: OpenCodeClient) {
    this.client = client;
  }

  async start() {
    await this.ensureLoaded();
    this.startConfigWatcher();
    if (!this.config?.enabled) {
      console.log("[proactive] disabled");
      await this.clearDeliverySuppression();
    } else {
      await this.prepareEnabledRuntime();
    }

    await this.runTick();
    this.loop();
  }

  async handleEvent(event: BusEventPayload) {
    await this.ensureLoaded();
    await this.requestConfigReload();
    if (!this.config?.enabled) return;
    if (!this.runtimePrepared) {
      await this.prepareEnabledRuntime();
    }
    if (event.type === "session.status" || event.type === "session.compacted") {
      await this.refreshAnchorSessions().catch(() => undefined);
    }
    if (event.type === "session.idle") {
      await this.refreshAnchorSessions().catch(() => undefined);
    }
    if (event.type === "message.updated") {
      await this.captureAnchorUsageFromEvent(event).catch(() => undefined);
    }

    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const now = Date.now();
      for (const task of this.config!.tasks) {
        if (task.enabled === false || task.trigger.kind !== "event") continue;
        if (!this.matchesEvent(task, state, event)) continue;
        let outcome: AdmissionOutcome;
        if (task.mode === "anchor-session") {
          if (task.policy.no_overlap && ensureAnchorState(state, task.id).open_windows.length > 0) {
            this.recordAdmissionSuppression(
              state,
              {
                task,
                source: {
                  type: eventSessionSourceType(event, state),
                  session_id: getEventSessionID(event),
                  event_name: event.type,
                },
                now,
                wakeReason: `event:${task.trigger.name}`,
                kind: "configured-task",
                taskID: task.id,
                taskName: task.name,
                triggerKind: "event",
                instructions: task.instructions,
                mode: task.mode,
                priority: task.priority,
                ttlMs: task.policy.ttl_ms,
                notBefore: now,
                scheduledAt: now,
              },
              "no-overlap blocked duplicate run",
            );
            outcome = { suppressed: { queueID: randomID("pq"), reason: "no-overlap blocked duplicate run" } };
          } else {
            const window = this.createScheduledAnchorWindow(state, task, now);
            outcome = this.admitConfiguredTask(state, task, {
              now,
              source: {
                type: eventSessionSourceType(event, state),
                session_id: getEventSessionID(event),
                event_name: event.type,
              },
              wakeReason: `event:${task.trigger.name}`,
              triggerKind: "event",
              context: {
                event_type: event.type,
                event_properties: event.properties,
                anchor_action: "start",
                window_started_at: window.scheduled_start_at,
                window_ends_at: window.window_end_at,
              },
              scheduledAt: now,
              anchorAction: "start",
              anchorWindowID: window.window_id,
              instructions: task.instructions,
              dedupeKey: `anchor:${task.id}:start:${window.window_id}`,
            });
            if (!outcome.queueItem) {
              removeAnchorWindow(ensureAnchorState(state, task.id), window.window_id);
            }
          }
        } else {
          outcome = this.admitConfiguredTask(state, task, {
            now,
            source: {
              type: eventSessionSourceType(event, state),
              session_id: getEventSessionID(event),
              event_name: event.type,
            },
            wakeReason: `event:${task.trigger.name}`,
            triggerKind: "event",
            context: {
              event_type: event.type,
              event_properties: event.properties,
            },
            scheduledAt: now,
          });
        }
        if (outcome.suppressed) {
          suppressions.push(
            this.buildLedgerEntry({
              queueID: outcome.suppressed.queueID,
              task,
              wakeReason: `event:${task.trigger.name}`,
              mode: task.mode,
              status: outcome.suppressed.status ?? "suppressed",
              suppressionReason: outcome.suppressed.reason,
            }),
          );
        }
      }
    });
    await this.writeLedgerEntries(suppressions);
  }

  async enqueueAdHoc(input: {
    instructions: string;
    priority?: number;
    ttl_ms?: number;
    agent?: string;
    model?: ModelRef;
    context?: Record<string, unknown>;
    dedupe_key?: string;
    not_before?: number;
    source?: ProactiveQueueSource;
    title?: string;
  }) {
    await this.ensureLoaded();
    await this.requestConfigReload();
    this.requireEnabled();
    const config = this.config!;
    const source = input.source ?? { type: "script" };
    const now = Date.now();
    const syntheticTask = adHocTask(config);
    const result = await mutateProactiveState(async (state) => {
      const outcome = this.admitQueueItem(state, {
        task: syntheticTask,
        source,
        now,
        kind: "ad_hoc",
        instructions: input.instructions,
        mode: "isolated-session",
        title: input.title,
        priority: input.priority ?? 0,
        ttlMs: input.ttl_ms ?? config.defaults.ttl_ms,
        notBefore: input.not_before ?? now,
        dedupeKey: input.dedupe_key,
        agent: input.agent,
        model: input.model,
        context: input.context ?? {},
      });
      return outcome;
    });
    if (result.result.suppressed) {
      await appendRunLedger(
        this.buildLedgerEntry({
          queueID: result.result.suppressed.queueID,
          taskName: syntheticTask.name,
          wakeReason: `queue:${result.result.suppressed.queueID}`,
          mode: "isolated-session",
          status: result.result.suppressed.status ?? "suppressed",
          suppressionReason: result.result.suppressed.reason,
        }),
      );
      throw new Error(result.result.suppressed.reason);
    }
    return result.result.queueItem!;
  }

  async removeQueuedItem(queueID: string) {
    await this.ensureLoaded();
    await this.requestConfigReload();
    this.requireEnabled();
    const { result } = await mutateProactiveState(async (state) => {
      const index = state.queue.findIndex((item) => item.queue_id === queueID);
      if (index < 0) {
        throw new Error(`queued item not found: ${queueID}`);
      }
      return state.queue.splice(index, 1)[0];
    });
    return result;
  }

  async editQueuedItem(
    queueID: string,
    patch: Partial<
      Pick<
        ProactiveQueueItem,
        "instructions" | "priority" | "ttl_ms" | "not_before" | "agent" | "model" | "context" | "dedupe_key" | "title"
      >
    >,
  ) {
    await this.ensureLoaded();
    await this.requestConfigReload();
    this.requireEnabled();
    const { result } = await mutateProactiveState(async (state) => {
      const item = state.queue.find((entry) => entry.queue_id === queueID);
      if (!item) {
        throw new Error(`queued item not found: ${queueID}`);
      }
      if (
        patch.dedupe_key !== undefined &&
        patch.dedupe_key &&
        hasDedupeCollisionExcluding(state, patch.dedupe_key, queueID)
      ) {
        throw new Error("dedupe key already queued or active");
      }
      if (patch.instructions !== undefined) item.instructions = patch.instructions;
      if (patch.priority !== undefined) item.priority = patch.priority;
      if (patch.ttl_ms !== undefined) item.ttl_ms = patch.ttl_ms;
      if (patch.not_before !== undefined) item.not_before = patch.not_before;
      if (patch.agent !== undefined) item.agent = patch.agent;
      if (patch.model !== undefined) item.model = patch.model;
      if (patch.context !== undefined) item.context = patch.context;
      if (patch.dedupe_key !== undefined) item.dedupe_key = patch.dedupe_key;
      if (patch.title !== undefined) item.title = patch.title;
      state.queue = sortQueue(state.queue);
      return item;
    });
    return result;
  }

  async runTaskNow(taskID: string, source?: ProactiveQueueSource) {
    await this.ensureLoaded();
    await this.requestConfigReload();
    this.requireEnabled();
    const task = this.getTask(taskID);
    const now = Date.now();
    if (task.mode === "anchor-session") {
      const { result } = await mutateProactiveState(async (state) => {
        const window = this.createScheduledAnchorWindow(state, task, now);
        return this.admitConfiguredTask(state, task, {
          now,
          source: source ?? { type: "manual" },
          wakeReason: `manual:${task.id}`,
          triggerKind: task.trigger.kind,
          context: {
            manual: true,
            anchor_action: "start",
            window_started_at: window.scheduled_start_at,
            window_ends_at: window.window_end_at,
          },
          scheduledAt: now,
          enforceEnabled: true,
          anchorAction: "start",
          anchorWindowID: window.window_id,
          instructions: task.instructions,
          dedupeKey: `anchor:${task.id}:start:${window.window_id}`,
          bypassAnchorNoOverlap: true,
        });
      });
      if (result.suppressed) {
        await appendRunLedger(
          this.buildLedgerEntry({
            queueID: result.suppressed.queueID,
            task,
            wakeReason: `manual:${task.id}`,
            mode: task.mode,
            status: result.suppressed.status ?? "suppressed",
            suppressionReason: result.suppressed.reason,
          }),
        );
        throw new Error(result.suppressed.reason);
      }
      return result.queueItem!;
    }
    const { result } = await mutateProactiveState(async (state) => {
      const outcome = this.admitConfiguredTask(state, task, {
        now,
        source: source ?? { type: "manual" },
        wakeReason: `manual:${task.id}`,
        triggerKind: task.trigger.kind,
        context: {
          manual: true,
        },
        scheduledAt: now,
        enforceEnabled: true,
      });
      return outcome;
    });
    if (result.suppressed) {
      await appendRunLedger(
        this.buildLedgerEntry({
          queueID: result.suppressed.queueID,
          task,
          wakeReason: `manual:${task.id}`,
          mode: task.mode,
          status: result.suppressed.status ?? "suppressed",
          suppressionReason: result.suppressed.reason,
        }),
      );
      throw new Error(result.suppressed.reason);
    }
    return result.queueItem!;
  }

  async getAllTasks() {
    // Lightweight read-only path for CLI queries.
    // Only loads config and state without acquiring locks or preparing runtime,
    // avoiding contention with the worker process.
    if (!this.config) {
      const workerConfig = await loadWorkerConfig();
      this.workerConfig = workerConfig;
      this.config = workerConfig.proactive;
    }
    const config = this.config!;
    const state = await loadProactiveState();
    // Preserve the previous output shape without persisting from the CLI.
    this.syncTaskDefinitions(state, false);
    return {
      enabled: config.enabled,
      anchors: state.anchors,
      configured_tasks: config.tasks.map((task) => ({
        ...task,
        queued_count: state.queue.filter((item) => item.task_id === task.id).length,
        active_count: Object.values(state.active).filter((item) => item.task_id === task.id).length,
        open_anchor_windows: task.mode === "anchor-session" ? ensureAnchorState(state, task.id).open_windows : undefined,
      })),
      queue: sortQueue(state.queue),
      active_runs: Object.values(state.active),
    };
  }

  private loop() {
    const intervalMs = this.config?.dispatcher.poll_interval_ms ?? 60_000;
    const now = Date.now();
    // Boundary-anchored scheduling: fire at the next interval boundary plus a
    // small guard instead of now+intervalMs. A now+interval loop always drifts
    // forward by the tick duration, which eventually leaves a wall-clock
    // minute with no tick at all — silently skipping any cron due in it.
    const nextBoundary = (Math.floor((now - TICK_BOUNDARY_GUARD_MS) / intervalMs) + 1) * intervalMs + TICK_BOUNDARY_GUARD_MS;
    this.timer = setTimeout(async () => {
      const firedAt = Date.now();
      let tickError: string | undefined;
      try {
        await this.runTick();
      } catch (err) {
        console.error("proactive tick failed", err);
        tickError = errorMessage(err);
      }
      const endedAt = Date.now();
      this.logTickOutcome(intervalMs, firedAt, endedAt, tickError);
      this.loop();
    }, nextBoundary - now);
  }

  private logTickOutcome(intervalMs: number, firedAt: number, endedAt: number, tickError?: string) {
    const durationMs = endedAt - firedAt;
    const minute = minuteStamp(new Date(firedAt), this.timezone());
    // Boundaries whose fire point passed while the tick was still running.
    // The re-arm in loop() then jumps to the following boundary; skipped
    // minutes are intentionally not caught up.
    const skipped = Math.max(
      0,
      Math.floor((endedAt - TICK_BOUNDARY_GUARD_MS) / intervalMs) - Math.floor((firedAt - TICK_BOUNDARY_GUARD_MS) / intervalMs),
    );
    const extra = { minute, duration_ms: durationMs, skipped_boundaries: skipped };
    if (skipped > 0) {
      const message = `proactive tick overran poll interval (duration ${durationMs}ms > ${intervalMs}ms); skipped ${skipped} boundary tick(s) after minute ${minute}`;
      console.warn(`[proactive] ${message}`);
      void this.client.log("warn", message, extra);
      return;
    }
    if (tickError) {
      void this.client.log("error", "proactive tick failed", { ...extra, error: tickError });
      return;
    }
    void this.client.log("info", "proactive-tick", extra);
  }

  private async runTick() {
    if (this.tickInFlight) {
      await this.tickInFlight;
      return;
    }
    this.tickInFlight = this.tick().finally(() => {
      this.tickInFlight = undefined;
    });
    await this.tickInFlight;
  }

  private async tick() {
    await this.ensureLoaded();
    await this.requestConfigReload();
    if (!this.config?.enabled) return;
    if (!this.runtimePrepared) {
      await this.prepareEnabledRuntime();
    }
    await this.refreshAnchorSessions();
    await this.refreshAnchorUsage();
    await this.updateDeliverySuppression();
    await this.scheduleAnchorActions();
    await this.scheduleDueTasks();
    await this.dispatchQueuedRuns();
  }

  private async reconcileStartupState() {
    if (!this.config) return;
    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const statusMap = await this.client.sessionStatus().catch(() => ({}));
      for (const [runID, active] of Object.entries(state.active)) {
        let stillActive = false;
        let finalSessionID = active.session_id;
        if (active.mode === "exec") {
          stillActive = typeof active.pid === "number" ? isAlive(active.pid) : false;
        } else if (active.session_id) {
          finalSessionID = active.session_id;
          const status = finalSessionID ? statusMap[finalSessionID] : undefined;
          stillActive = status?.type === "busy" || status?.type === "retry";
        }

        if (stillActive) {
          if (finalSessionID && finalSessionID !== active.session_id) {
            active.session_id = finalSessionID;
            if (active.lane === "anchor" && active.task_id && active.anchor_window_id) {
              const anchor = ensureAnchorState(state, active.task_id);
              const window = findAnchorWindow(anchor, active.anchor_window_id);
              if (window) {
                window.current_session_id = finalSessionID;
                window.updated_at = Date.now();
                if (!window.lineage.includes(finalSessionID)) window.lineage.push(finalSessionID);
              }
              anchor.updated_at = Date.now();
            }
          }
          continue;
        }

        delete state.active[runID];
        if (active.task_id) {
          const taskState = ensureTaskState(state, active.task_id);
          if (taskState.active_run_id === runID) {
            delete taskState.active_run_id;
          }
          taskState.last_status = "recovered-ambiguous";
        }
        suppressions.push({
          run_id: runID,
          queue_id: active.queue_id,
          task_id: active.task_id,
          task_name: active.task_name,
          trigger_kind: active.trigger_kind,
          wake_reason: active.wake_reason,
          mode: active.mode,
          started_at: active.started_at,
          ended_at: Date.now(),
          status: "failed",
          summary: "Recovered ambiguous in-flight run after worker restart.",
          error: "Worker restart left run state ambiguous.",
          session_id: active.session_id,
          pid: active.pid,
        });
      }

      for (const task of this.config!.tasks) {
        if (task.trigger.kind !== "at") continue;
        const taskState = ensureTaskState(state, task.id);
        if (taskState.at_status && taskState.at_status !== "pending") continue;
        const ts = Date.parse(task.trigger.timestamp);
        if (Number.isNaN(ts)) continue;
        if (ts <= Date.now()) {
          taskState.at_status = "missed";
          taskState.at_resolved_at = Date.now();
          taskState.last_status = "missed";
        }
      }
    });
    await this.writeLedgerEntries(suppressions);
  }

  private async scheduleAnchorActions() {
    if (!this.config) return;
    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const now = Date.now();
      const statusMap = await this.client.sessionStatus().catch(() => ({} as Record<string, { type: string }>));
      for (const task of this.config!.tasks) {
        if (!task.enabled || task.mode !== "anchor-session" || !task.anchor) continue;
        const anchor = ensureAnchorState(state, task.id);
        for (const window of [...anchor.open_windows]) {
          const endDue = now >= window.window_end_at;
          const rolloverDue = Boolean(
            window.current_session_id &&
              typeof window.last_usage_ratio === "number" &&
              window.last_usage_ratio >= task.anchor.rollover_threshold,
          );
          const retriggerDue = this.anchorRetriggerDue(task, window, now);

          if (endDue) {
            window.pending_action = rolloverDue ? "rollover" : "end";
          } else if (rolloverDue) {
            window.pending_action = "rollover";
          } else if (retriggerDue) {
            window.pending_action = "retrigger";
          } else if (!windowActionQueuedOrActive(state, window.window_id, "end") && !windowActionQueuedOrActive(state, window.window_id, "rollover")) {
            window.pending_action = undefined;
          }

          if (!window.current_session_id) {
            if (window.pending_action && window.pending_action !== "start") {
              window.last_error = "current anchor session unavailable";
            }
            continue;
          }

          const sessionStatus = statusMap[window.current_session_id];
          if (sessionStatus?.type === "busy" || sessionStatus?.type === "retry") continue;

          if (window.pending_action === "rollover" && !windowActionQueuedOrActive(state, window.window_id, "rollover")) {
            const outcome = this.admitConfiguredTask(state, task, {
              now,
              source: { type: "trigger", session_id: window.current_session_id },
              wakeReason: `anchor-rollover:${task.id}`,
              triggerKind: "anchor-rollover",
              context: {
                purpose: task.purpose,
                anchor_action: "rollover",
                prior_session_id: window.current_session_id,
              },
              scheduledAt: now,
              anchorAction: "rollover",
              anchorWindowID: window.window_id,
              instructions: task.anchor.rollover_instructions,
              priority: task.priority + ANCHOR_ROLLOVER_PRIORITY_BOOST,
              ttlMsOverride: 0,
              dedupeKey: `anchor:${task.id}:rollover:${window.window_id}:${window.last_message_id ?? "usage"}`,
            });
            if (outcome.suppressed) {
              suppressions.push(
                this.buildLedgerEntry({
                  queueID: outcome.suppressed.queueID,
                  task,
                  wakeReason: `anchor-rollover:${task.id}`,
                  mode: task.mode,
                  status: outcome.suppressed.status ?? "suppressed",
                  suppressionReason: outcome.suppressed.reason,
                }),
              );
            } else {
              window.status = "rolling-over";
            }
            continue;
          }

          if (window.pending_action === "end" && !windowActionQueuedOrActive(state, window.window_id, "end")) {
            const outcome = this.admitConfiguredTask(state, task, {
              now,
              source: { type: "trigger", session_id: window.current_session_id },
              wakeReason: `anchor-end:${task.id}`,
              triggerKind: "anchor-end",
              context: {
                purpose: task.purpose,
                anchor_action: "end",
              },
              scheduledAt: window.window_end_at,
              anchorAction: "end",
              anchorWindowID: window.window_id,
              instructions: task.anchor.end_instructions,
              priority: task.priority + ANCHOR_END_PRIORITY_BOOST,
              ttlMsOverride: 0,
              dedupeKey: `anchor:${task.id}:end:${window.window_id}`,
            });
            if (outcome.suppressed) {
              suppressions.push(
                this.buildLedgerEntry({
                  queueID: outcome.suppressed.queueID,
                  task,
                  wakeReason: `anchor-end:${task.id}`,
                  mode: task.mode,
                  status: outcome.suppressed.status ?? "suppressed",
                  suppressionReason: outcome.suppressed.reason,
                }),
              );
            } else {
              window.status = "closing";
            }
            continue;
          }

          if (window.pending_action === "retrigger" && retriggerDue && !windowActionQueuedOrActive(state, window.window_id, "retrigger")) {
            const outcome = this.admitConfiguredTask(state, task, {
              now,
              source: { type: "trigger", session_id: window.current_session_id },
              wakeReason: `anchor-retrigger:${task.id}`,
              triggerKind: "anchor-retrigger",
              context: {
                purpose: task.purpose,
                anchor_action: "retrigger",
              },
              scheduledAt: retriggerDue.scheduledAt,
              anchorAction: "retrigger",
              anchorWindowID: window.window_id,
              instructions: task.anchor.retrigger_instructions!,
              dedupeKey: `anchor:${task.id}:retrigger:${window.window_id}:${retriggerDue.scheduledAt}`,
            });
            if (outcome.suppressed) {
              suppressions.push(
                this.buildLedgerEntry({
                  queueID: outcome.suppressed.queueID,
                  task,
                  wakeReason: `anchor-retrigger:${task.id}`,
                  mode: task.mode,
                  status: outcome.suppressed.status ?? "suppressed",
                  suppressionReason: outcome.suppressed.reason,
                }),
              );
            }
          }
        }
      }
    });
    await this.writeLedgerEntries(suppressions);
  }

  private async scheduleDueTasks() {
    if (!this.config) return;
    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const now = Date.now();
      for (const task of this.config!.tasks) {
        if (!task.enabled || task.trigger.kind === "event") continue;
        const due = this.isTaskDue(state, task, now);
        if (!due) continue;
        let outcome: AdmissionOutcome;
        if (task.mode === "anchor-session") {
          if (task.policy.no_overlap && ensureAnchorState(state, task.id).open_windows.length > 0) {
            this.recordAdmissionSuppression(
              state,
              {
                task,
                source: due.source,
                now,
                wakeReason: due.wakeReason,
                kind: "configured-task",
                taskID: task.id,
                taskName: task.name,
                triggerKind: "anchor-start",
                instructions: task.instructions,
                mode: task.mode,
                priority: task.priority,
                ttlMs: task.policy.ttl_ms,
                notBefore: now,
                scheduledAt: due.scheduledAt,
              },
              "no-overlap blocked duplicate run",
            );
            suppressions.push(
              this.buildLedgerEntry({
                queueID: randomID("pq"),
                task,
                wakeReason: `anchor-start:${task.id}`,
                mode: task.mode,
                status: "suppressed",
                suppressionReason: "no-overlap blocked duplicate run",
              }),
            );
            continue;
          }
          const window = this.createScheduledAnchorWindow(state, task, due.scheduledAt);
          outcome = this.admitConfiguredTask(state, task, {
            ...due,
            wakeReason: due.wakeReason,
            triggerKind: "anchor-start",
            context: {
              ...due.context,
              anchor_action: "start",
              window_started_at: window.scheduled_start_at,
              window_ends_at: window.window_end_at,
            },
            anchorAction: "start",
            anchorWindowID: window.window_id,
            instructions: task.instructions,
            dedupeKey: `anchor:${task.id}:start:${window.window_id}`,
          });
          if (!outcome.queueItem) {
            removeAnchorWindow(ensureAnchorState(state, task.id), window.window_id);
          }
        } else {
          outcome = this.admitConfiguredTask(state, task, due);
        }
        if (outcome.suppressed) {
          const wakeReason = task.mode === "anchor-session" ? `anchor-start:${task.id}` : due.wakeReason;
          suppressions.push(
            this.buildLedgerEntry({
              queueID: outcome.suppressed.queueID,
              task,
              wakeReason,
              mode: task.mode,
              status: outcome.suppressed.status ?? "suppressed",
              suppressionReason: outcome.suppressed.reason,
            }),
          );
        }
      }

      for (const taskID of Object.keys(state.anchors)) {
        const task = this.findTask(taskID);
        if (!task || task.enabled === false || task.mode !== "anchor-session") {
          this.orphanAnchorTask(state, taskID);
        }
      }
    });
    await this.writeLedgerEntries(suppressions);
  }

  private async dispatchQueuedRuns() {
    if (!this.config) return;
    const ledger: ProactiveRunLedgerEntry[] = [];
    const claims = await mutateProactiveState(async (state) => {
      const now = Date.now();
      const lanes = laneAvailability(state, this.config!.dispatcher.max_concurrent_runs);
      const selected: DispatchClaim[] = [];
      const keep: ProactiveQueueItem[] = [];
      for (const item of sortQueue(state.queue)) {
        const task = item.task_id ? this.findTask(item.task_id) : undefined;
        const expiryReason = this.getQueueExpiryReason(state, item, task, now);
        if (expiryReason) {
          this.recordSuppressedOutcome(state, item, task, expiryReason === "stale" ? "suppressed" : "expired", expiryReason, now);
          ledger.push(
            this.buildLedgerEntry({
              queueID: item.queue_id,
              task,
              taskID: item.task_id,
              taskName: item.task_name,
              wakeReason: item.wake_reason,
              mode: item.mode,
              status: expiryReason === "stale" ? "suppressed" : "expired",
              suppressionReason: expiryReason,
            }),
          );
          continue;
        }
        if (item.not_before > now) {
          keep.push(item);
          continue;
        }
        const finalReason = this.finalDispatchBlockReason(state, item, task, now);
        if (finalReason) {
          this.recordSuppressedOutcome(state, item, task, "suppressed", finalReason, now);
          ledger.push(
            this.buildLedgerEntry({
              queueID: item.queue_id,
              task,
              taskID: item.task_id,
              taskName: item.task_name,
              wakeReason: item.wake_reason,
              mode: item.mode,
              status: "suppressed",
              suppressionReason: finalReason,
            }),
          );
          continue;
        }
        const lane = laneForMode(item.mode);
        if (!laneAvailable(lanes, lane, item.task_id, item.anchor_window_id)) {
          keep.push(item);
          continue;
        }
        occupyLane(lanes, lane, item.task_id, item.anchor_window_id);
        const runID = randomID("run");
        const activeRun: ProactiveActiveRun = {
          run_id: runID,
          queue_id: item.queue_id,
          task_id: item.task_id,
          task_name: item.task_name,
          mode: item.mode,
          lane,
          status: "running",
          anchor_action: item.anchor_action,
          anchor_window_id: item.anchor_window_id,
          started_at: now,
          wake_reason: item.wake_reason,
          attempt: item.attempt ?? 1,
          source: item.source,
          trigger_kind: item.trigger_kind,
          instructions: item.instructions,
          command: item.command,
          context: item.context,
          dedupe_key: item.dedupe_key,
        };
        state.active[runID] = activeRun;
        selected.push({ queueItem: item, activeRun, task });
        if (item.task_id && task) {
          const taskState = ensureTaskState(state, item.task_id);
          if (!item.anchor_window_id || item.anchor_action === "start") {
            taskState.active_run_id = runID;
          }
          taskState.last_started_at = now;
          taskState.last_status = "running";
          taskState.recent_runs = pruneTimestamps(taskState.recent_runs, task.policy.budget?.window_ms ?? Number.MAX_SAFE_INTEGER, now);
          taskState.recent_runs.push(now);
          if (item.mode === "isolated-session") {
            taskState.recent_isolated_llm_runs = pruneTimestamps(
              taskState.recent_isolated_llm_runs,
              task.policy.budget?.window_ms ?? Number.MAX_SAFE_INTEGER,
              now,
            );
            taskState.recent_isolated_llm_runs.push(now);
          }
        }
      }
      state.queue = keep;
      return selected;
    });
    await this.updateDeliverySuppression();
    await this.writeLedgerEntries(ledger);
    for (const claim of claims.result) {
      void this.executeClaim(claim).catch(async (err) => {
        await this.finishRun(claim, {
          status: "failed",
          error: errorMessage(err),
          retryable: true,
          failureArtifact: {
            worker_error: errorMessage(err),
          },
        });
      });
    }
  }

  private async executeClaim(claim: DispatchClaim) {
    const task = claim.task;
    const precheck = task?.precheck;
    let context = { ...claim.activeRun.context };
    let dedupeKey = claim.activeRun.dedupe_key;
    let ttlMs = claim.queueItem.ttl_ms;
    let precheckResult: PrecheckResult | undefined;

    if (precheck) {
      precheckResult = await this.runPrecheck(claim, precheck);
      if (precheckResult.decision === "skip") {
        await this.finishRun(claim, {
          status: "suppressed",
          summary: precheckResult.reason,
          suppressionReason: precheckResult.reason,
          failureArtifact: {
            precheck,
            precheck_result: precheckResult,
          },
        });
        return;
      }
      if (precheckResult.decision === "error") {
        await this.finishRun(claim, {
          status: "failed",
          error: precheckResult.reason,
          retryable: false,
          failureArtifact: {
            precheck,
            precheck_result: precheckResult,
          },
        });
        return;
      }
      context = { ...context, ...(precheckResult.context ?? {}) };
      dedupeKey = precheckResult.dedupe_key ?? dedupeKey;
      ttlMs = typeof precheckResult.ttl_ms === "number" && precheckResult.ttl_ms > 0 ? precheckResult.ttl_ms : ttlMs;
      claim.queueItem.context = context;
      claim.queueItem.dedupe_key = dedupeKey;
      claim.queueItem.ttl_ms = ttlMs;
      await mutateProactiveState(async (state) => {
        const active = state.active[claim.activeRun.run_id];
        if (!active) return;
        active.context = context;
        active.dedupe_key = dedupeKey;
      });
    }

    if (claim.activeRun.mode === "exec") {
      await this.executeExecClaim(claim, context, precheckResult, ttlMs);
      return;
    }
    await this.executeSessionClaim(claim, context, precheckResult);
  }

  private async executeSessionClaim(
    claim: DispatchClaim,
    context: Record<string, unknown>,
    precheckResult?: PrecheckResult,
  ) {
    const task = claim.task;
    const timeoutMs = task?.policy.max_runtime_ms ?? DEFAULT_SESSION_TIMEOUT_MS;
    let rootSessionID: string;
    let title: string;
    let anchorWindow: ProactiveAnchorWindow | undefined;
    if (claim.queueItem.mode === "anchor-session") {
      anchorWindow = await this.ensureTaskAnchorWindow(task!, claim.queueItem.anchor_window_id, claim.queueItem.anchor_action ?? "start");
      rootSessionID = anchorWindow.current_session_id!;
      title = anchorWindow.rendered_title;
    } else {
      title =
        claim.queueItem.title ??
        (task ? renderIsolatedTitle(task, claim.queueItem.scheduled_at ?? Date.now(), this.timezone()) : "Proactive Isolated Run");
      const session = await this.client.createSession(title);
      rootSessionID = session.id;
    }

    await mutateProactiveState(async (state) => {
      const active = state.active[claim.activeRun.run_id];
      if (!active) return;
      active.root_session_id = rootSessionID;
      active.session_id = rootSessionID;
    });

    const dispatchModel =
      claim.queueItem.mode === "anchor-session" && task
        ? this.resolveAnchorDispatchModel(task, anchorWindow)
        : claim.queueItem.model;
    const dispatchAgent =
      claim.queueItem.mode === "anchor-session" && task
        ? this.resolveAnchorDispatchAgent(task, anchorWindow)
        : claim.queueItem.agent;
    const prompt = claim.queueItem.instructions.trim();
    try {
      const trimmed = claim.queueItem.instructions.trim();
      if (trimmed.startsWith("/")) {
        const [head, ...tail] = trimmed.split(/\s+/);
        await this.client.command(rootSessionID, {
          agent: dispatchAgent,
          model: dispatchModel,
          command: head.slice(1),
          arguments: tail.join(" "),
        });
      } else {
        await this.client.promptAsync(rootSessionID, {
          agent: dispatchAgent,
          model: dispatchModel,
          parts: [{ type: "text", text: prompt }],
        });
      }
      const outcome = await waitForSessionCompletion(this.client, rootSessionID, {
        timeoutMs,
        pollMs: 1_000,
        onSessionChange: async (sessionID) => {
          await mutateProactiveState(async (state) => {
            const active = state.active[claim.activeRun.run_id];
            if (!active) return;
            active.session_id = sessionID;
            if (active.lane === "anchor" && active.task_id && active.anchor_window_id) {
              const anchor = ensureAnchorState(state, active.task_id);
              const window = findAnchorWindow(anchor, active.anchor_window_id);
              if (!window) return;
              window.current_session_id = sessionID;
              window.updated_at = Date.now();
              if (!window.lineage.includes(sessionID)) window.lineage.push(sessionID);
              anchor.updated_at = Date.now();
            }
          });
        },
      });
      if (claim.queueItem.mode === "anchor-session") {
        let continuationPrompt: string | undefined;
        await mutateProactiveState(async (state) => {
          if (!claim.queueItem.task_id || !claim.queueItem.anchor_window_id) return;
          const anchor = ensureAnchorState(state, claim.queueItem.task_id);
          const window = findAnchorWindow(anchor, claim.queueItem.anchor_window_id);
          if (!window) return;
          window.current_session_id = outcome.finalSessionID;
          window.updated_at = Date.now();
          if (!window.lineage.includes(outcome.finalSessionID)) window.lineage.push(outcome.finalSessionID);
          anchor.updated_at = Date.now();
        });
        if (claim.queueItem.anchor_action === "rollover" && task) {
          continuationPrompt = outcome.lastAssistantText?.trim() || undefined;
          if (!continuationPrompt) {
            throw new Error("rollover handover produced no continuation prompt");
          }
          if (continuationPrompt === "SEBASTIAN_IDLE") {
            await this.finishRun(claim, {
              status: "suppressed",
              summary: "SEBASTIAN_IDLE",
              suppressionReason: "SEBASTIAN_IDLE",
              finalSessionID: outcome.finalSessionID,
            });
            return;
          }
          const fresh = await this.rotateAnchorWindow(task, claim.queueItem.anchor_window_id!, continuationPrompt);
          rootSessionID = fresh.current_session_id!;
          outcome.finalSessionID = rootSessionID;
        }
      }
      const text = outcome.lastAssistantText?.trim();
      if (claim.queueItem.mode === "anchor-session" && text === "SEBASTIAN_IDLE") {
        await this.finishRun(claim, {
          status: "suppressed",
          summary: "SEBASTIAN_IDLE",
          suppressionReason: "SEBASTIAN_IDLE",
          finalSessionID: outcome.finalSessionID,
        });
        return;
      }
      await this.finishRun(claim, {
        status: "completed",
        summary: text ? truncateText(text, 500) : `Completed proactive run in ${title}`,
        finalSessionID: outcome.finalSessionID,
      });
    } catch (err) {
      await this.client.abortSession(rootSessionID).catch(() => undefined);
      await this.finishRun(claim, {
        status: "failed",
        error: errorMessage(err),
        finalSessionID: rootSessionID,
        retryable: true,
        failureArtifact: {
          queue_item: claim.queueItem,
          resolved_task: task,
          precheck_result: precheckResult,
          final_prompt: prompt,
          session_id: rootSessionID,
          worker_error: errorMessage(err),
        },
      });
    }
  }

  private async executeExecClaim(
    claim: DispatchClaim,
    context: Record<string, unknown>,
    precheckResult: PrecheckResult | undefined,
    ttlMs: number,
  ) {
    const task = claim.task;
    const timeoutMs = task?.policy.max_runtime_ms ?? ttlMs;
    const command = claim.queueItem.command;
    if (!command || command.length === 0) {
      await this.finishRun(claim, {
        status: "failed",
        error: "exec mode missing command",
        retryable: false,
      });
      return;
    }
    const child = Bun.spawn({
      cmd: command,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        OPENCODE_PROACTIVE_RUN_ID: claim.activeRun.run_id,
        OPENCODE_PROACTIVE_MODE: claim.activeRun.mode,
        OPENCODE_PROACTIVE_QUEUE_ID: claim.queueItem.queue_id,
        OPENCODE_PROACTIVE_TASK_ID: claim.queueItem.task_id ?? "",
      },
    });
    if (child.pid === undefined) {
      await this.finishRun(claim, {
        status: "failed",
        error: "failed to start exec process",
        retryable: true,
      });
      return;
    }
    await mutateProactiveState(async (state) => {
      const active = state.active[claim.activeRun.run_id];
      if (active) active.pid = child.pid;
    });

    try {
      const { code, stdout, stderr } = await waitForProcess(child, timeoutMs);
      if (code !== 0) {
        await this.finishRun(claim, {
          status: "failed",
          error: stderr || stdout || `exec exited with code ${code}`,
          pid: child.pid,
          retryable: true,
          failureArtifact: {
            queue_item: claim.queueItem,
            resolved_task: task,
            precheck_result: precheckResult,
            final_command: command,
            pid: child.pid,
            stdout,
            stderr,
            context,
          },
        });
        return;
      }
      await this.finishRun(claim, {
        status: "completed",
        summary: truncateText(stdout || "exec completed", 500),
        pid: child.pid,
      });
    } catch (err) {
      child.kill();
      await this.finishRun(claim, {
        status: "failed",
        error: errorMessage(err),
        pid: child.pid,
        retryable: true,
        failureArtifact: {
          queue_item: claim.queueItem,
          resolved_task: task,
          precheck_result: precheckResult,
          final_command: command,
          pid: child.pid,
          worker_error: errorMessage(err),
        },
      });
    }
  }

  private async finishRun(claim: DispatchClaim, input: RunFinishInput) {
    const task = claim.task;
    const endedAt = Date.now();
    let retryItem: ProactiveQueueItem | undefined;
    await mutateProactiveState(async (state) => {
      const active = state.active[claim.activeRun.run_id];
      delete state.active[claim.activeRun.run_id];
      if (claim.queueItem.task_id) {
        const taskState = ensureTaskState(state, claim.queueItem.task_id);
        if (taskState.active_run_id === claim.activeRun.run_id) {
          delete taskState.active_run_id;
        }
        taskState.last_completed_at = endedAt;
        taskState.last_status = input.status;
        if (
          task &&
          task.policy.cooldown_ms &&
          input.status !== "failed" &&
          (claim.queueItem.mode !== "anchor-session" || claim.queueItem.anchor_action === "start")
        ) {
          taskState.cooldown_until = endedAt + task.policy.cooldown_ms;
        }
        if (input.status === "suppressed" || input.status === "expired") {
          taskState.suppression_count += 1;
          state.suppression_counters[claim.queueItem.task_id] = (state.suppression_counters[claim.queueItem.task_id] ?? 0) + 1;
        }
        if (input.status === "failed") {
          taskState.failure_count += 1;
          state.failure_counters[claim.queueItem.task_id] = (state.failure_counters[claim.queueItem.task_id] ?? 0) + 1;
        }
      }

      const retryAllowed =
        task &&
        input.status === "failed" &&
        input.retryable &&
        (claim.queueItem.mode === "anchor-session" && (claim.queueItem.anchor_action === "rollover" || claim.queueItem.anchor_action === "end")
          ? true
          : shouldRetry(task, claim.activeRun.attempt));
      if (task && retryAllowed) {
        const candidate: ProactiveQueueItem = {
          ...claim.queueItem,
          queue_id: randomID("pq"),
          created_at: endedAt,
          not_before: endedAt + (task.policy.retry?.delay_ms ?? 60_000),
          status: "queued",
          attempt: claim.activeRun.attempt + 1,
          source: {
            ...claim.queueItem.source,
            run_id: claim.activeRun.run_id,
          },
        };
        if (!candidate.dedupe_key || !hasDedupeCollision(state, candidate.dedupe_key)) {
          retryItem = candidate;
          state.queue.push(retryItem);
        }
      }

      if (active?.lane === "anchor" && claim.queueItem.task_id && claim.queueItem.anchor_window_id) {
        const anchor = ensureAnchorState(state, claim.queueItem.task_id);
        const window = findAnchorWindow(anchor, claim.queueItem.anchor_window_id);
        if (window) {
          if (input.finalSessionID) {
            window.current_session_id = input.finalSessionID;
            window.updated_at = endedAt;
            if (!window.lineage.includes(input.finalSessionID)) window.lineage.push(input.finalSessionID);
          }
          if (input.status === "completed" || input.status === "suppressed") {
            window.pending_action = undefined;
            window.last_error = undefined;
            if (claim.queueItem.anchor_action === "retrigger") {
              window.last_retrigger_at = endedAt;
            }
            if (claim.queueItem.anchor_action === "rollover") {
              window.status = "open";
              window.last_usage_ratio = undefined;
              window.last_tokens_total = undefined;
              window.last_message_id = undefined;
            }
            if (claim.queueItem.anchor_action === "end") {
              removeAnchorWindow(anchor, claim.queueItem.anchor_window_id);
            }
          }
          if (input.status === "failed") {
            window.last_error = input.error;
            if (claim.queueItem.anchor_action === "end") {
              window.status = "closing";
              window.pending_action = "end";
            } else if (claim.queueItem.anchor_action === "rollover") {
              window.status = "rolling-over";
              window.pending_action = "rollover";
            }
          }
        }
        anchor.updated_at = endedAt;
      }
      state.queue = sortQueue(state.queue);
    });

    const ledgerEntry: ProactiveRunLedgerEntry = {
      run_id: claim.activeRun.run_id,
      queue_id: claim.queueItem.queue_id,
      task_id: claim.queueItem.task_id,
      task_name: claim.queueItem.task_name,
      trigger_kind: claim.queueItem.trigger_kind,
      wake_reason: claim.queueItem.wake_reason,
      mode: claim.queueItem.mode,
      started_at: claim.activeRun.started_at,
      ended_at: endedAt,
      status: input.status,
      summary: input.summary,
      error: input.error,
      session_id: input.finalSessionID,
      pid: input.pid,
      suppressed: input.status === "suppressed" || input.status === "expired",
      suppression_reason: input.suppressionReason,
    };
    await appendRunLedger(ledgerEntry);

    if (input.status === "failed" && input.failureArtifact) {
      await writeFailureArtifact(
        claim.queueItem.task_id ?? "ad-hoc",
        claim.activeRun.run_id,
        {
          queue_item: claim.queueItem,
          resolved_task: task,
          session_id: input.finalSessionID,
          pid: input.pid,
          timestamps: {
            started_at: claim.activeRun.started_at,
            ended_at: endedAt,
          },
          worker_failure_reason: input.error,
          retry_enqueued: Boolean(retryItem),
          ...input.failureArtifact,
        },
      );
    }

    await this.updateDeliverySuppression();
  }

  private admitConfiguredTask(
    state: ProactiveState,
    task: ProactiveTaskConfig,
    input: {
      now: number;
      source: ProactiveQueueSource;
      wakeReason: string;
      triggerKind: string;
      context: Record<string, unknown>;
      scheduledAt: number;
      enforceEnabled?: boolean;
      anchorAction?: ProactiveAnchorAction;
      anchorWindowID?: string;
      instructions?: string;
      priority?: number;
      dedupeKey?: string;
      ttlMsOverride?: number;
      bypassAnchorNoOverlap?: boolean;
    },
  ): AdmissionOutcome {
    return this.admitQueueItem(state, {
      task,
      source: input.source,
      now: input.now,
      wakeReason: input.wakeReason,
      kind: "configured-task",
      taskID: task.id,
      taskName: task.name,
      triggerKind: input.triggerKind,
      instructions: input.instructions ?? task.instructions,
      mode: task.mode,
      anchorAction: input.anchorAction,
      anchorWindowID: input.anchorWindowID,
      priority: input.priority ?? task.priority,
      ttlMs: input.ttlMsOverride ?? task.policy.ttl_ms,
      notBefore: input.now,
      dedupeKey: input.dedupeKey,
      agent: task.agent,
      model: this.resolveConfiguredTaskModel(task),
      context: {
        purpose: task.purpose,
        ...input.context,
      },
      command: task.command,
      scheduledAt: input.scheduledAt,
      attempt: 1,
      enforceEnabled: input.enforceEnabled,
      bypassAnchorNoOverlap: input.bypassAnchorNoOverlap,
    });
  }

  private admitQueueItem(state: ProactiveState, input: AdmissionInput): AdmissionOutcome {
    const queueID = randomID("pq");
    const wakeReason = input.wakeReason ?? `queue:${queueID}`;
    const taskState = input.taskID ? ensureTaskState(state, input.taskID) : undefined;
    if (input.enforceEnabled && input.task.enabled === false) {
      this.recordAdmissionSuppression(state, input, `task ${input.task.id} is disabled`);
      return { suppressed: { queueID, reason: `task ${input.task.id} is disabled` } };
    }
    if (input.kind === "configured-task" && input.task.enabled === false) {
      this.recordAdmissionSuppression(state, input, `task ${input.task.id} is disabled`);
      return { suppressed: { queueID, reason: `task ${input.task.id} is disabled` } };
    }
    if (
      taskState &&
      input.task.policy.no_overlap &&
      !(input.mode === "anchor-session" && input.anchorAction && input.anchorAction !== "start") &&
      !input.bypassAnchorNoOverlap &&
      hasTaskInFlight(state, input.task.id)
    ) {
      this.recordAdmissionSuppression(state, input, "no-overlap blocked duplicate run");
      return { suppressed: { queueID, reason: "no-overlap blocked duplicate run" } };
    }
    if (taskState?.cooldown_until && taskState.cooldown_until > input.now) {
      this.recordAdmissionSuppression(state, input, "task is under cooldown");
      return { suppressed: { queueID, reason: "task is under cooldown" } };
    }
    const budgetReason = budgetExceeded(taskState, input.task.policy.budget, input.now, input.mode);
    if (budgetReason) {
      this.recordAdmissionSuppression(state, input, budgetReason);
      return { suppressed: { queueID, reason: budgetReason } };
    }
    if (input.task.trigger.kind === "event" && taskState) {
      const eventReason = eventAdmissionBlocked(taskState, input.task.trigger, input.now);
      if (eventReason) {
        this.recordAdmissionSuppression(state, input, eventReason);
        return { suppressed: { queueID, reason: eventReason } };
      }
    }

    const dedupeKey =
      input.dedupeKey ??
      (input.task.policy.no_overlap && input.taskID && !(input.mode === "anchor-session" && input.anchorAction && input.anchorAction !== "start")
        ? `task:${input.taskID}`
        : undefined);
    if (dedupeKey && hasDedupeCollision(state, dedupeKey)) {
      this.recordAdmissionSuppression(state, input, "dedupe key already queued or active");
      return { suppressed: { queueID, reason: "dedupe key already queued or active" } };
    }

    const queueItem: ProactiveQueueItem = {
      queue_id: queueID,
      kind: input.kind,
      task_id: input.taskID,
      task_name: input.taskName,
      trigger_kind: input.triggerKind,
      source: input.source,
      created_at: input.now,
      scheduled_at: input.scheduledAt,
      not_before: input.notBefore,
      priority: input.priority,
      dedupe_key: dedupeKey,
      ttl_ms: input.ttlMs,
      mode: input.mode,
      anchor_action: input.anchorAction,
      anchor_window_id: input.anchorWindowID,
      agent: input.agent,
      model: input.model,
      title: input.title,
      instructions: input.instructions,
      context: input.context ?? {},
      status: "queued",
      wake_reason: wakeReason,
      command: input.command,
      attempt: input.attempt ?? 1,
    };
    state.queue.push(queueItem);
    state.queue = sortQueue(state.queue);
    if (taskState) {
      taskState.last_status = "queued";
      if (input.task.trigger.kind === "event") {
        taskState.recent_event_at = input.now;
        if (input.task.trigger.window_ms) {
          taskState.event_window = pruneTimestamps(taskState.event_window, input.task.trigger.window_ms, input.now);
        }
        taskState.event_window.push(input.now);
      }
      this.applyScheduledBookkeeping(taskState, wakeReason, input.scheduledAt, input.now);
    }
    return { queueItem };
  }

  private finalDispatchBlockReason(
    state: ProactiveState,
    item: ProactiveQueueItem,
    task: ProactiveTaskConfig | undefined,
    now: number,
  ) {
    if (!task) {
      return item.kind === "configured-task" ? "task missing from config" : undefined;
    }
    const taskState = ensureTaskState(state, task.id);
    if (task.enabled === false) return "task disabled";
    if (task.policy.no_overlap && !(item.mode === "anchor-session" && item.anchor_action && item.anchor_action !== "start")) {
      const other = Object.values(state.active).some(
        (active) => active.task_id === task.id && active.run_id !== taskState.active_run_id,
      );
      if (other) return "no-overlap blocked duplicate run";
    }
    if (taskState.cooldown_until && taskState.cooldown_until > now) return "task is under cooldown";
    return budgetExceeded(taskState, task.policy.budget, now, item.mode);
  }

  private getQueueExpiryReason(
    state: ProactiveState,
    item: ProactiveQueueItem,
    task: ProactiveTaskConfig | undefined,
    now: number,
  ) {
    if (item.ttl_ms > 0 && now - item.created_at > item.ttl_ms) {
      if (activeReasonIsScheduled(item.wake_reason)) {
        return "stale";
      }
      return "expired";
    }
    if (
      activeReasonIsScheduled(item.wake_reason) &&
      task &&
      typeof item.scheduled_at === "number"
    ) {
      const taskState = ensureTaskState(state, task.id);
      if (typeof taskState.last_scheduled_at === "number" && taskState.last_scheduled_at > item.scheduled_at) {
        return "stale";
      }
    }
    return undefined;
  }

  private async runPrecheck(claim: DispatchClaim, precheck: ProactivePrecheck): Promise<PrecheckResult> {
    if (precheck.kind === "internal") {
      return runInternalPrecheck(precheck.name, claim);
    }

    const child = Bun.spawn({
      cmd: precheck.cmd,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        OPENCODE_PROACTIVE_RUN_ID: claim.activeRun.run_id,
        OPENCODE_PROACTIVE_MODE: claim.activeRun.mode,
        OPENCODE_PROACTIVE_QUEUE_ID: claim.queueItem.queue_id,
        OPENCODE_PROACTIVE_TASK_ID: claim.queueItem.task_id ?? "",
      },
    });
    const { code, stdout, stderr } = await waitForProcess(child, claim.task?.policy.max_runtime_ms ?? 60_000);
    if (code !== 0) {
      return {
        decision: "error",
        reason: stderr || stdout || `precheck exited with code ${code}`,
        raw_stdout: stdout,
        raw_stderr: stderr,
      };
    }
    try {
      const parsed = JSON.parse(stdout || "{}") as PrecheckResult;
      if (!parsed || (parsed.decision !== "proceed" && parsed.decision !== "skip" && parsed.decision !== "error")) {
        throw new Error("invalid precheck decision");
      }
      return {
        ...parsed,
        raw_stdout: stdout,
        raw_stderr: stderr,
      };
    } catch (err) {
      return {
        decision: "error",
        reason: `invalid precheck JSON: ${errorMessage(err)}`,
        raw_stdout: stdout,
        raw_stderr: stderr,
      };
    }
  }

  private matchesEvent(task: ProactiveTaskConfig, state: ProactiveState, event: BusEventPayload) {
    if (task.trigger.kind !== "event") return false;
    if (task.trigger.name !== event.type) return false;
    const sessionID = getEventSessionID(event);
    if (!task.trigger.include_user_sessions && sessionID && !belongsToProactive(state, sessionID)) {
      return false;
    }
    for (const [key, value] of Object.entries(task.trigger.match)) {
      if (lookup(event, key) !== value) return false;
    }
    return true;
  }

  private isTaskDue(
    state: ProactiveState,
    task: ProactiveTaskConfig,
    now: number,
  ):
    | {
        now: number;
        source: ProactiveQueueSource;
        wakeReason: string;
        triggerKind: string;
        context: Record<string, unknown>;
        scheduledAt: number;
      }
    | undefined {
    const taskState = ensureTaskState(state, task.id);
    if (task.trigger.kind === "cron") {
      if (!matchesCron(task.trigger.expr, new Date(now), this.timezone())) return undefined;
      const stamp = minuteStamp(new Date(now), this.timezone());
      if (taskState.last_cron_stamp === stamp) return undefined;
      return {
        now,
        source: { type: "trigger" },
        wakeReason: `cron:${task.id}`,
        triggerKind: "cron",
        context: {},
        scheduledAt: now,
      };
    }
    if (task.trigger.kind === "every") {
      const intervalMs = task.trigger.minutes * 60_000;
      const last = taskState.last_scheduled_at;
      if (typeof last !== "number") {
        return {
          now,
          source: { type: "trigger" },
          wakeReason: `interval:${task.id}`,
          triggerKind: "every",
          context: {},
          scheduledAt: now,
        };
      }
      if (now - last < intervalMs) return undefined;
      return {
        now,
        source: { type: "trigger" },
        wakeReason: `interval:${task.id}`,
        triggerKind: "every",
        context: {},
        scheduledAt: last + intervalMs,
      };
    }
    if (task.trigger.kind === "at") {
      const ts = Date.parse(task.trigger.timestamp);
      if (Number.isNaN(ts) || ts > now) return undefined;
      if (taskState.at_status && taskState.at_status !== "pending") return undefined;
      return {
        now,
        source: { type: "trigger" },
        wakeReason: `at:${task.id}`,
        triggerKind: "at",
        context: {},
        scheduledAt: ts,
      };
    }
    return undefined;
  }

  private async refreshAnchorSessions() {
    if (!this.config?.enabled) return;
    await mutateProactiveState(async (state) => {
      for (const task of this.config!.tasks) {
        if (task.mode !== "anchor-session") continue;
        const anchor = ensureAnchorState(state, task.id);
        for (const window of [...anchor.open_windows]) {
          if (!window.current_session_id) continue;
          try {
            const session = await this.client.getSession(window.current_session_id);
            window.current_session_id = session.id;
            window.updated_at = Date.now();
            if (!window.lineage.includes(session.id)) window.lineage.push(session.id);
          } catch {
            window.last_error = "current anchor session unavailable";
          }
        }
        anchor.updated_at = Date.now();
      }
    });
  }

  private async refreshAnchorUsage() {
    if (!this.config?.enabled) return;
    await this.refreshProviders(false);
    const messages = await this.recentAnchorAssistantMessages();
    if (messages.length === 0) return;
    await mutateProactiveState(async (state) => {
      for (const message of messages) {
        if (message.info.role !== "assistant") continue;
        const owner = findAnchorOwnerBySession(state, message.info.sessionID);
        if (!owner) continue;
        const task = this.findTask(owner.task_id);
        if (!task?.anchor) continue;
        const anchor = ensureAnchorState(state, owner.task_id);
        const contextLimit = this.providers.get(`${message.info.providerID}/${message.info.modelID}`);
        if (!contextLimit) continue;
        const total = assistantTokenCount(message.info.tokens);
        if (total <= 0) continue;
        owner.window.last_tokens_total = total;
        owner.window.last_usage_ratio = total / contextLimit;
        owner.window.last_message_id = message.info.id;
        owner.window.model = {
          providerID: message.info.providerID,
          modelID: message.info.modelID,
          variant: message.info.variant,
        };
        owner.window.agent = message.info.agent;
        owner.window.updated_at = Date.now();
        anchor.updated_at = Date.now();
      }
    });
  }

  private async captureAnchorUsageFromEvent(_event: BusEventPayload) {
    await this.refreshAnchorUsage();
  }

  private anchorRetriggerDue(task: ProactiveTaskConfig, window: ProactiveAnchorWindow, now: number) {
    if (!task.anchor?.retrigger || !task.anchor.retrigger_instructions) return undefined;
    if (now >= window.window_end_at) return undefined;
    if (!window.current_session_id) return undefined;

    const retrigger = task.anchor.retrigger;
    if (retrigger.kind === "cron") {
      if (!matchesCron(retrigger.expr, new Date(now), this.timezone())) return undefined;
      const stamp = minuteStamp(new Date(now), this.timezone());
      const lastStamp = typeof window.last_retrigger_at === "number"
        ? minuteStamp(new Date(window.last_retrigger_at), this.timezone())
        : undefined;
      if (lastStamp === stamp) return undefined;
      return { scheduledAt: now };
    }

    const intervalMs = retrigger.minutes * 60_000;
    const last = window.last_retrigger_at ?? window.scheduled_start_at;
    if (now - last < intervalMs) return undefined;
    return { scheduledAt: last + intervalMs };
  }

  private async recentAnchorAssistantMessages() {
    const state = await loadProactiveState();
    const messages: MessageWithParts[] = [];
    for (const anchor of Object.values(state.anchors)) {
      for (const window of anchor.open_windows) {
        if (!window.current_session_id) continue;
        try {
          const history = await this.client.sessionMessages(window.current_session_id);
          const lastAssistant = [...history].reverse().find((message) => message.info.role === "assistant");
          if (lastAssistant) messages.push(lastAssistant);
        } catch {
          // ignore transient failures
        }
      }
    }
    return messages;
  }

  private async ensureTaskAnchorWindow(
    task: ProactiveTaskConfig,
    windowID: string | undefined,
    action: ProactiveAnchorAction,
  ) {
    this.requireEnabled();
    if (!windowID) {
      throw new Error(`anchor ${action} is missing window id for task ${task.id}`);
    }
    const { result } = await mutateProactiveState(async (state) => {
      const anchor = ensureAnchorState(state, task.id);
      const window = findAnchorWindow(anchor, windowID);
      if (!window) {
        throw new Error(`anchor window ${windowID} not found for task ${task.id}`);
      }
      if ((action === "retrigger" || action === "rollover" || action === "end") && !window.current_session_id) {
        throw new Error(`anchor window ${windowID} has no active session`);
      }
      if (action === "start") {
        await this.ensureAnchorStartModelLimit(task, window);
      }
      if (action === "start" || !window.current_session_id) {
        const session = await this.client.createSession(window.rendered_title);
        window.current_session_id = session.id;
        window.root_session_id ??= session.id;
        window.updated_at = Date.now();
        if (!window.lineage.includes(session.id)) window.lineage.push(session.id);
      }
      return window;
    });
    return result;
  }

  private async rotateAnchorWindow(task: ProactiveTaskConfig, windowID: string, continuationPrompt: string): Promise<{ current_session_id: string }> {
    this.requireEnabled();

    // 1. Read window state under lock
    const { result: snapshot } = await mutateProactiveState(async (state) => {
      const anchor = ensureAnchorState(state, task.id);
      const window = findAnchorWindow(anchor, windowID);
      if (!window) {
        throw new Error(`anchor window ${windowID} not found for task ${task.id}`);
      }
      return {
        rendered_title: window.rendered_title,
        agent: this.resolveAnchorDispatchAgent(task, window),
        model: this.resolveAnchorDispatchModel(task, window),
        window_end_at: window.window_end_at,
      };
    });
    const dispatchModel = snapshot.model;
    if (!dispatchModel) {
      throw new Error(`anchor window ${windowID} cannot rollover: effective model is unknown`);
    }

    // 2. Outside lock: create session, send prompt, wait for completion
    const session = await this.client.createSession(snapshot.rendered_title);
    let continuationSessionID: string;
    try {
      await this.client.promptAsync(session.id, {
        agent: snapshot.agent,
        model: dispatchModel,
        parts: [{ type: "text", text: buildRolloverContinuationPrompt(task, windowID, snapshot.window_end_at, continuationPrompt) }],
      });
      await waitForSessionCompletion(this.client, session.id, {
        timeoutMs: task.policy.max_runtime_ms ?? DEFAULT_SESSION_TIMEOUT_MS,
        pollMs: 1_000,
      });
      continuationSessionID = session.id;
    } catch (err) {
      await this.client.abortSession(session.id).catch(() => undefined);
      throw err;
    }

    // 3. Write final state under lock
    await mutateProactiveState(async (state) => {
      const anchor = ensureAnchorState(state, task.id);
      const window = findAnchorWindow(anchor, windowID);
      if (!window) return;
      window.current_session_id = continuationSessionID;
      window.root_session_id ??= continuationSessionID;
      window.status = "open";
      window.pending_action = undefined;
      window.updated_at = Date.now();
      if (!window.lineage.includes(continuationSessionID)) window.lineage.push(continuationSessionID);
      if (task.agent) {
        window.agent = task.agent;
      }
      anchor.updated_at = Date.now();
    });

    return { current_session_id: continuationSessionID };
  }

  private async refreshProviders(force: boolean) {
    const now = Date.now();
    if (!force && now - this.providersLoadedAt < 300_000) return;
    const result = await this.client.providers().catch(() => undefined);
    if (!result) return;
    this.providers.clear();
    for (const provider of result.all) {
      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        if (typeof model.limit?.context === "number") {
          this.providers.set(`${provider.id}/${modelID}`, model.limit.context);
        }
      }
    }
    this.providersLoadedAt = now;
  }

  private async updateDeliverySuppression() {
    if (!this.config?.enabled) return;
    const now = Date.now();
    const proactiveState = await loadProactiveState();
    const state = await loadDeliveryRuntimeState();
    const activeTasks = Object.values(proactiveState.active).map((run) => {
      if (run.task_id) return this.findTask(run.task_id);
      return adHocTask(this.config!);
    });
    const next: DeliveryRuntimeState = {
      version: 1,
      channels: {
        ...state.channels,
      },
    };
    for (const channel of this.knownDeliveryChannels()) {
      const suppressed = this.channelSuppressedNow(channel, activeTasks, now);
      next.channels[channel] = {
        suppressed,
        reason: suppressed ? "quiet-hours" : undefined,
        updated_at: now,
      };
    }
    await writeDeliveryRuntimeState(next);
  }

  private async clearDeliverySuppression() {
    const now = Date.now();
    const state = await loadDeliveryRuntimeState();
    const next: DeliveryRuntimeState = {
      version: 1,
      channels: {
        ...state.channels,
      },
    };
    for (const channel of this.knownDeliveryChannels()) {
      next.channels[channel] = {
        suppressed: false,
        updated_at: now,
      };
    }
    await writeDeliveryRuntimeState({
      ...next,
    });
  }

  private knownDeliveryChannels() {
    const channels = new Set<string>();
    const globalQuiet = this.config?.delivery.quiet_hours;
    for (const channel of globalQuiet?.channels ?? []) {
      channels.add(channel);
    }
    for (const task of this.config?.tasks ?? []) {
      for (const channel of task.policy.quiet_hours?.channels ?? []) {
        channels.add(channel);
      }
    }
    for (const channel of this.config ? adHocTask(this.config).policy.quiet_hours?.channels ?? [] : []) {
      channels.add(channel);
    }
    if (channels.size === 0) {
      channels.add("telegram");
    }
    return [...channels];
  }

  private channelSuppressedNow(channel: string, activeTasks: Array<ProactiveTaskConfig | undefined>, now: number) {
    if (activeTasks.length === 0) {
      const quiet = this.config?.delivery.quiet_hours;
      return Boolean(quiet && quiet.channels.includes(channel) && withinQuietHours(quiet, now));
    }

    return activeTasks.some((task) => {
      const quiet = task?.policy.quiet_hours ?? this.config?.delivery.quiet_hours;
      return Boolean(quiet && quiet.channels.includes(channel) && withinQuietHours(quiet, now));
    });
  }

  private buildLedgerEntry(input: {
    queueID: string;
    task?: ProactiveTaskConfig;
    taskID?: string;
    taskName?: string;
    wakeReason: string;
    mode: ProactiveExecutionMode;
    status: ProactiveRunStatus;
    suppressionReason?: string;
  }): ProactiveRunLedgerEntry {
    return {
      run_id: randomID("run"),
      queue_id: input.queueID,
      task_id: input.task?.id ?? input.taskID,
      task_name: input.task?.name ?? input.taskName,
      trigger_kind: input.task?.trigger.kind,
      wake_reason: input.wakeReason,
      mode: input.mode,
      ended_at: Date.now(),
      status: input.status,
      suppressed: input.status === "suppressed" || input.status === "expired",
      suppression_reason: input.suppressionReason,
      summary: input.suppressionReason,
    };
  }

  private recordAdmissionSuppression(state: ProactiveState, input: AdmissionInput, reason: string) {
    if (!input.taskID) return;
    const taskState = ensureTaskState(state, input.taskID);
    taskState.last_status = `suppressed:${reason}`;
    taskState.suppression_count += 1;
    state.suppression_counters[input.taskID] = (state.suppression_counters[input.taskID] ?? 0) + 1;
    this.applyScheduledBookkeeping(taskState, input.wakeReason ?? "", input.scheduledAt, input.now);
  }

  private recordSuppressedOutcome(
    state: ProactiveState,
    item: ProactiveQueueItem,
    task: ProactiveTaskConfig | undefined,
    status: Extract<ProactiveRunStatus, "suppressed" | "expired">,
    reason: string,
    now: number,
  ) {
    if (!item.task_id || !task) return;
    const taskState = ensureTaskState(state, item.task_id);
    taskState.last_status = status === "expired" ? "expired" : `suppressed:${reason}`;
    taskState.suppression_count += 1;
    state.suppression_counters[item.task_id] = (state.suppression_counters[item.task_id] ?? 0) + 1;
    if (activeReasonIsScheduled(item.wake_reason)) {
      this.applyScheduledBookkeeping(taskState, item.wake_reason, item.scheduled_at, now);
    }
  }

  private applyScheduledBookkeeping(
    taskState: ReturnType<typeof ensureTaskState>,
    wakeReason: string,
    scheduledAt: number | undefined,
    now: number,
  ) {
    if (!activeReasonIsScheduled(wakeReason)) return;
    const effectiveScheduledAt = scheduledAt ?? now;
    taskState.last_scheduled_at = Math.max(taskState.last_scheduled_at ?? 0, effectiveScheduledAt);
    if (wakeReason.startsWith("cron:")) {
      const stamp = minuteStamp(new Date(effectiveScheduledAt), this.timezone());
      taskState.last_cron_stamp = Math.max(taskState.last_cron_stamp ?? 0, stamp);
    }
    if (wakeReason.startsWith("at:")) {
      taskState.at_status = "fired";
      taskState.at_resolved_at = Math.max(taskState.at_resolved_at ?? 0, now);
    }
  }

  private async writeLedgerEntries(entries: ProactiveRunLedgerEntry[]) {
    for (const entry of entries) {
      await appendRunLedger(entry);
    }
  }

  private requireEnabled() {
    if (!this.config?.enabled) {
      throw new Error("proactive service is disabled");
    }
  }

  private async ensureLoaded() {
    if (this.workerConfig && this.config) return;
    await this.requestConfigReload(true);
  }

  private async requestConfigReload(force = false) {
    if (this.configReloadInFlight) {
      return await this.configReloadInFlight;
    }
    this.configReloadInFlight = this.reloadConfigIfChanged(force).finally(() => {
      this.configReloadInFlight = undefined;
    });
    return await this.configReloadInFlight;
  }

  private async reloadConfigIfChanged(force = false) {
    if (!force && this.workerConfig && this.config) {
      const mtimeMs = await this.readConfigMTimeMs();
      if (mtimeMs === undefined) return false;
      if (typeof this.configMTimeMs === "number" && mtimeMs <= this.configMTimeMs) {
        return false;
      }
    }

    const hadConfig = Boolean(this.workerConfig && this.config);
    const previousEnabled = this.config?.enabled ?? false;
    try {
      const workerConfig = await loadWorkerConfig();
      this.workerConfig = workerConfig;
      this.config = workerConfig.proactive;
      this.defaultModel = await this.loadDefaultModel();
      this.configMTimeMs = await this.readConfigMTimeMs();
    } catch (err) {
      if (!hadConfig) {
        throw err;
      }
      console.error("[proactive] failed to reload config; keeping last known good config", err);
      return false;
    }

    if (!this.config.enabled) {
      if (this.runtimePrepared || previousEnabled) {
        this.runtimePrepared = false;
        await this.clearDeliverySuppression();
        if (hadConfig && previousEnabled) {
          console.log("[proactive] disabled via config reload");
        }
      }
      return true;
    }

    if (!this.runtimePrepared) {
      await this.prepareEnabledRuntime();
      if (hadConfig && !previousEnabled) {
        console.log("[proactive] enabled via config reload");
      }
      return true;
    }

    await this.applyConfigRefresh();
    if (hadConfig) {
      console.log("[proactive] config reloaded");
    }
    return true;
  }

  private async prepareEnabledRuntime() {
    if (!this.config?.enabled) {
      this.runtimePrepared = false;
      return;
    }
    await mutateProactiveState(async (state) => {
      this.syncTaskDefinitions(state, true);
      this.rebaseRecoveredSchedules(state, Date.now());
      this.syncQueuedConfiguredItems(state);
    });
    await this.reconcileStartupState();
    await this.refreshAnchorSessions();
    await this.refreshAnchorUsage();
    await this.updateDeliverySuppression();
    this.runtimePrepared = true;
  }

  private async applyConfigRefresh() {
    if (!this.config?.enabled) return;
    await mutateProactiveState(async (state) => {
      this.syncTaskDefinitions(state, false);
      this.syncQueuedConfiguredItems(state);
    });
    await this.updateDeliverySuppression();
  }

  private syncTaskDefinitions(state: ProactiveState, startupSemantics: boolean) {
    if (!this.config) return;
    const now = Date.now();
    for (const taskID of Object.keys(state.anchors)) {
      if (taskID === "legacy-global-anchor" || !this.config.tasks.some((task) => task.id === taskID && task.mode === "anchor-session")) {
        this.orphanAnchorTask(state, taskID);
      }
    }
    for (const task of this.config.tasks) {
      const taskState = ensureTaskState(state, task.id);
      if (task.mode === "anchor-session" && task.enabled !== false) {
        ensureAnchorState(state, task.id);
      } else if (task.enabled === false || task.mode !== "anchor-session") {
        if (state.anchors[task.id]) {
          this.orphanAnchorTask(state, task.id);
        }
      }
      const signature = triggerSignature(task);
      if (taskState.trigger_signature !== signature) {
        resetTriggerState(taskState, task, now, startupSemantics);
        taskState.trigger_signature = signature;
      }
    }
  }

  private syncQueuedConfiguredItems(state: ProactiveState) {
    if (!this.config) return;
    for (const item of state.queue) {
      if (item.kind !== "configured-task" || !item.task_id) continue;
      const task = this.findTask(item.task_id);
      if (!task) continue;
      item.task_name = task.name;
      item.trigger_kind = task.trigger.kind;
      item.mode = task.mode;
      if (!item.anchor_action) {
        item.priority = task.priority;
      }
      if (!item.anchor_action || (item.anchor_action !== "rollover" && item.anchor_action !== "end")) {
        item.ttl_ms = task.policy.ttl_ms;
      }
      if (!item.anchor_action) {
        item.instructions = task.instructions;
      }
      if (task.mode === "anchor-session" && item.anchor_window_id) {
        const window = findAnchorWindow(ensureAnchorState(state, task.id), item.anchor_window_id);
        item.agent = task.agent ?? window?.agent;
        item.model = task.model ?? window?.model ?? this.resolveConfiguredTaskModel(task);
      } else {
        item.agent = task.agent;
        item.model = this.resolveConfiguredTaskModel(task);
      }
      item.command = task.command;
      item.context = {
        ...item.context,
        purpose: task.purpose,
      };
    }
    state.queue = sortQueue(state.queue);
  }

  private startConfigWatcher() {
    if (this.configWatcher) return;
    const configDir = dirname(workerConfigFile);
    const configName = basename(workerConfigFile);
    try {
      this.configWatcher = watch(configDir, (_eventType, filename) => {
        if (filename && filename !== configName) return;
        this.scheduleConfigReload();
      });
      this.configWatcher.on("error", (err) => {
        console.error("[proactive] config watcher failed", err);
      });
    } catch (err) {
      console.error("[proactive] failed to start config watcher", err);
    }
  }

  private scheduleConfigReload() {
    if (this.configReloadTimer) {
      clearTimeout(this.configReloadTimer);
    }
    this.configReloadTimer = setTimeout(() => {
      void this.requestConfigReload(true)
        .then(async (changed) => {
          if (changed) {
            await this.runTick();
          }
        })
        .catch((err) => {
          console.error("[proactive] config reload failed", err);
        });
    }, CONFIG_RELOAD_DEBOUNCE_MS);
  }

  private async readConfigMTimeMs() {
    try {
      return (await stat(workerConfigFile)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  private getTask(taskID: string) {
    const task = this.findTask(taskID);
    if (!task) throw new Error(`unknown proactive task: ${taskID}`);
    return task;
  }

  private findTask(taskID: string) {
    return this.config?.tasks.find((task) => task.id === taskID);
  }

  private timezone() {
    return this.config?.timezone;
  }

  private async loadDefaultModel() {
    try {
      const raw = parseJsonc(await readText(`${root}/opencode.json`));
      if (!record(raw) || typeof raw.model !== "string") return undefined;
      return parseModelString(raw.model);
    } catch {
      return undefined;
    }
  }

  private createScheduledAnchorWindow(state: ProactiveState, task: ProactiveTaskConfig, scheduledAt: number) {
    const anchor = ensureAnchorState(state, task.id);
    const window = createAnchorWindow({
      windowID: randomID("aw"),
      scheduledStartAt: scheduledAt,
      windowEndAt: scheduledAt + task.anchor!.duration_ms,
      renderedTitle: renderAnchorTitle(task, scheduledAt, this.timezone()),
      updatedAt: Date.now(),
    });
    anchor.open_windows.push(window);
    anchor.open_windows.sort((left, right) => left.scheduled_start_at - right.scheduled_start_at);
    anchor.updated_at = Date.now();
    return window;
  }

  private resolveConfiguredTaskModel(task: ProactiveTaskConfig) {
    return task.model ?? this.defaultModel;
  }

  private resolveAnchorDispatchAgent(task: ProactiveTaskConfig, window: ProactiveAnchorWindow | undefined) {
    return task.agent ?? window?.agent;
  }

  private resolveAnchorDispatchModel(task: ProactiveTaskConfig, window: ProactiveAnchorWindow | undefined) {
    return task.model ?? window?.model ?? this.defaultModel;
  }

  private async ensureAnchorStartModelLimit(task: ProactiveTaskConfig, window: ProactiveAnchorWindow) {
    await this.refreshProviders(false);
    const model = this.resolveAnchorDispatchModel(task, window);
    if (!model) {
      throw new Error(`anchor window ${window.window_id} cannot start: effective model is unknown`);
    }
    if (!this.providers.has(`${model.providerID}/${model.modelID}`)) {
      throw new Error(
        `anchor window ${window.window_id} cannot start: missing context limit for ${model.providerID}/${model.modelID}`,
      );
    }
    window.model = model;
    if (task.agent) {
      window.agent = task.agent;
    }
    return model;
  }

  private orphanAnchorTask(state: ProactiveState, taskID: string) {
    if (!state.anchors[taskID]) return;
    delete state.anchors[taskID];
  }

  private rebaseRecoveredSchedules(state: ProactiveState, now: number) {
    if (!this.config) return;
    for (const task of this.config.tasks) {
      const taskState = ensureTaskState(state, task.id);
      if (task.trigger.kind === "every") {
        const intervalMs = task.trigger.minutes * 60_000;
        if (typeof taskState.last_scheduled_at === "number" && now - taskState.last_scheduled_at > intervalMs) {
          taskState.last_scheduled_at = now;
        }
      }
      if (task.trigger.kind === "at" && !taskState.at_status) {
        taskState.at_status = Date.parse(task.trigger.timestamp) > now ? "pending" : "missed";
        taskState.at_resolved_at = taskState.at_status === "missed" ? now : undefined;
      }
    }
  }
}

function adHocTask(config: ProactiveConfig): ProactiveTaskConfig {
  return {
    id: "ad-hoc",
    name: "Ad-Hoc Proactive Queue Item",
    enabled: true,
    purpose: "Run isolated follow-up work queued explicitly.",
    trigger: { kind: "every", minutes: 99999999 },
    mode: "isolated-session",
    instructions: "",
    agent: undefined,
    model: undefined,
    priority: 0,
    policy: {
      no_overlap: false,
      max_runtime_ms: undefined,
      retry: config.defaults.retry,
      quiet_hours: config.defaults.quiet_hours,
      cooldown_ms: 0,
      budget: undefined,
      silence_ok: true,
      ttl_ms: config.defaults.ttl_ms,
    },
  };
}

function triggerSignature(task: ProactiveTaskConfig) {
  return JSON.stringify({
    trigger: task.trigger,
    mode: task.mode,
    anchor: task.anchor,
    policy: {
      ttl_ms: task.policy.ttl_ms,
      cooldown_ms: task.policy.cooldown_ms,
      no_overlap: task.policy.no_overlap,
      budget: task.policy.budget,
    },
  });
}

function resetTriggerState(
  taskState: ReturnType<typeof ensureTaskState>,
  task: ProactiveTaskConfig,
  now: number,
  startupSemantics: boolean,
) {
  delete taskState.last_cron_stamp;
  delete taskState.last_scheduled_at;
  delete taskState.last_retrigger_at;
  delete taskState.recent_event_at;
  taskState.event_window = [];

  if (task.trigger.kind === "at") {
    const ts = Date.parse(task.trigger.timestamp);
    if (Number.isNaN(ts)) {
      delete taskState.at_status;
      delete taskState.at_resolved_at;
      return;
    }
    if (startupSemantics) {
      taskState.at_status = ts > now ? "pending" : "missed";
      taskState.at_resolved_at = taskState.at_status === "missed" ? now : undefined;
      return;
    }
    taskState.at_status = ts > now ? "pending" : "missed";
    taskState.at_resolved_at = ts > now ? undefined : now;
    return;
  }

  delete taskState.at_status;
  delete taskState.at_resolved_at;
}

function lookup(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!record(current)) return undefined;
    current = current[part];
  }
  return current;
}

function getEventSessionID(event: BusEventPayload) {
  return typeof event.properties.sessionID === "string" ? event.properties.sessionID : undefined;
}

function eventSessionSourceType(event: BusEventPayload, state: ProactiveState): ProactiveQueueSource["type"] {
  const sessionID = getEventSessionID(event);
  if (!sessionID) return "trigger";
  if (findAnchorOwnerBySession(state, sessionID)) {
    return "anchor";
  }
  const active = Object.values(state.active).find(
    (run) => run.session_id === sessionID || run.root_session_id === sessionID,
  );
  if (!active) return "user-session";
  return active.mode === "isolated-session" ? "isolated" : active.mode === "anchor-session" ? "anchor" : "trigger";
}

function belongsToProactive(state: ProactiveState, sessionID: string) {
  if (findAnchorOwnerBySession(state, sessionID)) return true;
  return Object.values(state.active).some(
    (active) => active.session_id === sessionID || active.root_session_id === sessionID,
  );
}

function eventAdmissionBlocked(
  taskState: NonNullable<ReturnType<typeof ensureTaskState>>,
  trigger: Extract<ProactiveTrigger, { kind: "event" }>,
  now: number,
) {
  if (trigger.debounce_ms && taskState.recent_event_at && now - taskState.recent_event_at < trigger.debounce_ms) {
    return "event debounce blocked duplicate enqueue";
  }
  if (trigger.max_queue_per_window && trigger.window_ms) {
    taskState.event_window = pruneTimestamps(taskState.event_window, trigger.window_ms, now);
    if (taskState.event_window.length >= trigger.max_queue_per_window) {
      return "event window limit reached";
    }
  }
  return undefined;
}

function budgetExceeded(
  taskState: ReturnType<typeof ensureTaskState> | undefined,
  budget: ProactiveBudgetPolicy | undefined,
  now: number,
  mode: ProactiveExecutionMode,
) {
  if (!taskState || !budget) return undefined;
  taskState.recent_runs = pruneTimestamps(taskState.recent_runs, budget.window_ms, now);
  taskState.recent_isolated_llm_runs = pruneTimestamps(taskState.recent_isolated_llm_runs, budget.window_ms, now);
  if (budget.max_runs && taskState.recent_runs.length >= budget.max_runs) {
    return "run budget exceeded";
  }
  if (mode === "isolated-session" && budget.max_isolated_llm_runs && taskState.recent_isolated_llm_runs.length >= budget.max_isolated_llm_runs) {
    return "isolated llm budget exceeded";
  }
  return undefined;
}

function shouldRetry(task: ProactiveTaskConfig, attempt: number) {
  return attempt < (task.policy.retry?.max_attempts ?? 1);
}

function hasTaskInFlight(state: ProactiveState, taskID: string) {
  return (
    state.queue.some((item) => item.task_id === taskID) ||
    Object.values(state.active).some((active) => active.task_id === taskID)
  );
}

function hasDedupeCollision(state: ProactiveState, dedupeKey: string) {
  return (
    state.queue.some((item) => item.dedupe_key === dedupeKey) ||
    Object.values(state.active).some((active) => active.dedupe_key === dedupeKey)
  );
}

function hasDedupeCollisionExcluding(state: ProactiveState, dedupeKey: string, queueID: string) {
  return (
    state.queue.some((item) => item.queue_id !== queueID && item.dedupe_key === dedupeKey) ||
    Object.values(state.active).some((active) => active.dedupe_key === dedupeKey)
  );
}

function activeReasonIsScheduled(wakeReason: string) {
  return wakeReason.startsWith("cron:") || wakeReason.startsWith("interval:") || wakeReason.startsWith("at:");
}

function laneForMode(mode: ProactiveExecutionMode): ProactiveLane {
  if (mode === "anchor-session") return "anchor";
  if (mode === "exec") return "exec";
  return "isolated";
}

function laneAvailability(state: ProactiveState, maxConcurrentRuns: number) {
  const active = Object.values(state.active);
  return {
    anchor_windows: new Set(active.filter((run) => run.lane === "anchor" && run.anchor_window_id).map((run) => run.anchor_window_id!)),
    exec: active.some((run) => run.lane === "exec"),
    isolated: active.filter((run) => run.lane === "isolated").length,
    isolated_limit: maxConcurrentRuns,
  };
}

function laneAvailable(
  lanes: ReturnType<typeof laneAvailability>,
  lane: ProactiveLane,
  taskID?: string,
  anchorWindowID?: string,
) {
  if (lane === "anchor") return anchorWindowID ? !lanes.anchor_windows.has(anchorWindowID) : false;
  if (lane === "exec") return !lanes.exec;
  return lanes.isolated < lanes.isolated_limit;
}

function occupyLane(lanes: ReturnType<typeof laneAvailability>, lane: ProactiveLane, taskID?: string, anchorWindowID?: string) {
  if (lane === "anchor") {
    if (anchorWindowID) lanes.anchor_windows.add(anchorWindowID);
  }
  else if (lane === "exec") lanes.exec = true;
  else lanes.isolated += 1;
}

function renderTaskName(task: ProactiveTaskConfig, at: number, timezone?: string) {
  const date = zoned(new Date(at), timezone);
  const replacements: Record<string, string> = {
    YYYY: String(date.year),
    MM: pad(date.month),
    DD: pad(date.day),
    HH: pad(date.hour),
    mm: pad(date.minute),
    ss: pad(date.second),
  };
  return task.name.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => replacements[token] ?? token);
}

function renderAnchorTitle(task: ProactiveTaskConfig, at: number, timezone?: string) {
  return `Anchor: ${renderTaskName(task, at, timezone)}`;
}

function renderIsolatedTitle(task: ProactiveTaskConfig, at: number, timezone?: string) {
  return `Proactive: ${renderTaskName(task, at, timezone)}`;
}

function windowActionQueuedOrActive(state: ProactiveState, windowID: string, action: ProactiveAnchorAction) {
  return (
    state.queue.some((item) => item.anchor_window_id === windowID && item.anchor_action === action) ||
    Object.values(state.active).some((run) => run.anchor_window_id === windowID && run.anchor_action === action)
  );
}

function parseModelString(value: string): ModelRef | undefined {
  const [providerID, ...rest] = value.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

function buildRolloverContinuationPrompt(
  task: ProactiveTaskConfig,
  windowID: string,
  windowEndAt: number,
  continuationPrompt: string,
) {
  return [
    `Continue the same anchor window for task: ${task.id}`,
    `Window ID: ${windowID}`,
    `Window end at (ms): ${windowEndAt}`,
    `Keep the existing context and intent of this window. Do not restart the task from scratch.`,
    "",
    continuationPrompt.trim(),
  ]
    .join("\n")
    .trim();
}

function findAnchorOwnerBySession(state: ProactiveState, sessionID: string) {
  for (const anchor of Object.values(state.anchors)) {
    const window = anchor.open_windows.find(
      (candidate) =>
        candidate.current_session_id === sessionID ||
        candidate.root_session_id === sessionID ||
        candidate.lineage.includes(sessionID),
    );
    if (window) {
      return { task_id: anchor.task_id, window };
    }
  }
  return undefined;
}

function assistantTokenCount(tokens: { total?: number; input: number; output: number; reasoning: number; cache: { read: number; write: number } }) {
  if (typeof tokens.total === "number") return tokens.total;
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

async function runInternalPrecheck(name: string, claim: DispatchClaim): Promise<PrecheckResult> {
  if (name === "alwaysProceed") {
    return {
      decision: "proceed",
      reason: "alwaysProceed",
      context: claim.queueItem.context,
    };
  }
  if (name === "skipIfInstructionsEmpty") {
    return claim.queueItem.instructions.trim()
      ? {
          decision: "proceed",
          reason: "instructions present",
        }
      : {
          decision: "skip",
          reason: "instructions are empty",
        };
  }
  return {
    decision: "error",
    reason: `unknown internal precheck: ${name}`,
  };
}

async function waitForProcess(child: Bun.Subprocess, timeoutMs: number) {
  const timed = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`process timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    void child.exited.finally(() => clearTimeout(timer));
  });
  const completed = (async () => {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout: stdout.trim(), stderr: stderr.trim() };
  })();
  return await Promise.race([completed, timed]);
}

function withinQuietHours(quiet: QuietHoursConfig, now: number) {
  const timezone = quiet.timezone;
  const parts = zonedHourMinute(new Date(now), timezone);
  const current = parts.hour * 60 + parts.minute;
  const start = parseHourMinute(quiet.start);
  const end = parseHourMinute(quiet.end);
  if (start === undefined || end === undefined) return false;
  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

function parseHourMinute(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function matchesCron(expr: string, now: Date, timezone?: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const date = zoned(now, timezone);
  const minute = matchesField(parts[0], date.minute, 0);
  const hour = matchesField(parts[1], date.hour, 1);
  const day = matchesDayFields(parts[2], parts[4], date.day, date.weekday);
  const month = matchesField(parts[3], date.month, 3);
  return minute && hour && day && month;
}

function matchesDayFields(dayOfMonthExpr: string, dayOfWeekExpr: string, day: number, weekday: number) {
  const domWildcard = isWildcardField(dayOfMonthExpr);
  const dowWildcard = isWildcardField(dayOfWeekExpr);
  const domMatch = matchesField(dayOfMonthExpr, day, 2);
  const dowMatch = matchesField(dayOfWeekExpr, weekday, 4);
  if (domWildcard && dowWildcard) return true;
  if (domWildcard) return dowMatch;
  if (dowWildcard) return domMatch;
  return domMatch || dowMatch;
}

function isWildcardField(expr: string) {
  return expr.trim() === "*";
}

function matchesField(expr: string, value: number, idx: number) {
  return expr.split(",").some((part) => matchesPiece(part, value, idx));
}

function matchesPiece(expr: string, value: number, idx: number) {
  const [base, rawStep] = expr.split("/");
  const step = rawStep ? Number(rawStep) : 1;
  if (!Number.isInteger(step) || step < 1) return false;
  const [min] = cronRange(idx);
  if (base === "*") return (value - min) % step === 0;
  if (base.includes("-")) {
    const [from, to] = base.split("-").map(Number);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    if (value < from || value > to) return false;
    return (value - from) % step === 0;
  }
  const num = Number(base);
  return Number.isInteger(num) && value === num;
}

function cronRange(idx: number) {
  if (idx === 0) return [0, 59] as const;
  if (idx === 1) return [0, 23] as const;
  if (idx === 2) return [1, 31] as const;
  if (idx === 3) return [1, 12] as const;
  return [0, 6] as const;
}

function zoned(now: Date, timezone?: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  const weekday =
    parts.weekday === "Sun"
      ? 0
      : parts.weekday === "Mon"
        ? 1
        : parts.weekday === "Tue"
          ? 2
          : parts.weekday === "Wed"
            ? 3
            : parts.weekday === "Thu"
              ? 4
              : parts.weekday === "Fri"
                ? 5
                : 6;
  return {
    year: Number(parts.year),
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    second: Number(parts.second ?? "0"),
    weekday,
  };
}

function zonedHourMinute(now: Date, timezone?: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    minute: "numeric",
    hour: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function minuteStamp(now: Date, timezone?: string) {
  const date = zoned(now, timezone);
  return Number(`${date.year}${pad(date.month)}${pad(date.day)}${pad(date.hour)}${pad(date.minute)}`);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function truncateText(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}
