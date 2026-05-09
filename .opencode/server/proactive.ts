import process from "node:process";
import {
  loadWorkerConfig,
  type ProactiveBudgetPolicy,
  type ProactiveConfig,
  type ProactivePrecheck,
  type ProactiveTaskConfig,
  type ProactiveTrigger,
  type QuietHoursConfig,
  type WorkerConfig,
} from "./config";
import {
  appendRunLedger,
  ensureTaskState,
  loadDeliveryRuntimeState,
  loadProactiveState,
  mutateProactiveState,
  randomID,
  pruneTimestamps,
  saveProactiveState,
  sortQueue,
  writeDeliveryRuntimeState,
  writeFailureArtifact,
  type DeliveryRuntimeState,
  type ProactiveActiveRun,
  type ProactiveExecutionMode,
  type ProactiveLane,
  type ProactiveQueueItem,
  type ProactiveQueueSource,
  type ProactiveRunLedgerEntry,
  type ProactiveRunStatus,
  type ProactiveState,
} from "./proactive-state";
import { readCompactionStateSafe, resolveCompaction, waitForSessionCompletion } from "./run-monitor";
import { OpenCodeClient, record, root, sleep, type BusEventPayload, type ModelRef } from "./shared";

type AdmissionInput = {
  task: ProactiveTaskConfig;
  source: ProactiveQueueSource;
  now: number;
  wakeReason?: string;
  kind: "configured-task" | "ad_hoc";
  taskID?: string;
  taskName?: string;
  triggerKind?: string;
  instructions: string;
  mode: ProactiveExecutionMode;
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
};

const DEFAULT_SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000;

export class ProactiveService {
  private readonly client: OpenCodeClient;
  private workerConfig?: WorkerConfig;
  private config?: ProactiveConfig;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(client: OpenCodeClient) {
    this.client = client;
  }

  async start() {
    await this.ensureLoaded();
    if (!this.config.enabled) {
      console.log("[proactive] disabled");
      await this.clearDeliverySuppression();
      return;
    }

    await mutateProactiveState(async (state) => {
      for (const task of this.config!.tasks) {
        ensureTaskState(state, task.id);
      }
      this.rebaseRecoveredSchedules(state, Date.now());
    });
    await this.reconcileStartupState();
    await this.ensureAnchorSession();
    await this.refreshAnchorFromCompaction();
    await this.updateDeliverySuppression();
    await this.tick();
    this.loop();
  }

  async handleEvent(event: BusEventPayload) {
    await this.ensureLoaded();
    if (!this.config?.enabled) return;
    if (event.type === "session.status" || event.type === "session.compacted") {
      await this.refreshAnchorFromCompaction().catch(() => undefined);
    }

    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const now = Date.now();
      for (const task of this.config!.tasks) {
        if (task.enabled === false || task.trigger.kind !== "event") continue;
        if (!this.matchesEvent(task, state, event)) continue;
        const outcome = this.admitConfiguredTask(state, task, {
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
  }) {
    await this.ensureLoaded();
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
        "instructions" | "priority" | "ttl_ms" | "not_before" | "agent" | "model" | "context" | "dedupe_key"
      >
    >,
  ) {
    await this.ensureLoaded();
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
      state.queue = sortQueue(state.queue);
      return item;
    });
    return result;
  }

  async runTaskNow(taskID: string, source?: ProactiveQueueSource) {
    await this.ensureLoaded();
    this.requireEnabled();
    const task = this.getTask(taskID);
    const now = Date.now();
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
    await this.ensureLoaded();
    const config = this.config!;
    const state = await loadProactiveState();
    return {
      enabled: config.enabled,
      anchor: state.anchor,
      configured_tasks: config.tasks.map((task) => ({
        ...task,
        queued_count: state.queue.filter((item) => item.task_id === task.id).length,
        active_count: Object.values(state.active).filter((item) => item.task_id === task.id).length,
      })),
      queue: sortQueue(state.queue),
      active_runs: Object.values(state.active),
    };
  }

  private loop() {
    this.timer = setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        console.error("proactive tick failed", err);
      }
      this.loop();
    }, this.config?.dispatcher.poll_interval_ms ?? 60_000);
  }

  private async tick() {
    await this.ensureLoaded();
    if (!this.config?.enabled) return;
    await this.refreshAnchorFromCompaction();
    await this.updateDeliverySuppression();
    await this.scheduleDueTasks();
    await this.dispatchQueuedRuns();
  }

  private async reconcileStartupState() {
    if (!this.config) return;
    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const compaction = await readCompactionStateSafe();
      const statusMap = await this.client.sessionStatus().catch(() => ({}));
      for (const [runID, active] of Object.entries(state.active)) {
        let stillActive = false;
        let finalSessionID = active.session_id;
        if (active.mode === "exec") {
          stillActive = typeof active.pid === "number" ? isAlive(active.pid) : false;
        } else if (active.root_session_id) {
          const resolution = resolveCompaction(active.root_session_id, compaction);
          finalSessionID = resolution.currentSessionID;
          const status = finalSessionID ? statusMap[finalSessionID] : undefined;
          stillActive = status?.type === "busy" || status?.type === "retry";
        }

        if (stillActive) {
          if (finalSessionID && finalSessionID !== active.session_id) {
            active.session_id = finalSessionID;
            if (active.lane === "anchor") {
              state.anchor.session_id = finalSessionID;
              state.anchor.updated_at = Date.now();
              if (!state.anchor.lineage.includes(finalSessionID)) state.anchor.lineage.push(finalSessionID);
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

  private async scheduleDueTasks() {
    if (!this.config) return;
    const suppressions: ProactiveRunLedgerEntry[] = [];
    await mutateProactiveState(async (state) => {
      const now = Date.now();
      for (const task of this.config!.tasks) {
        if (!task.enabled || task.trigger.kind === "event") continue;
        const due = this.isTaskDue(state, task, now);
        if (!due) continue;
        const outcome = this.admitConfiguredTask(state, task, due);
        if (outcome.suppressed) {
          suppressions.push(
            this.buildLedgerEntry({
              queueID: outcome.suppressed.queueID,
              task,
              wakeReason: due.wakeReason,
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
        if (!laneAvailable(lanes, lane)) {
          keep.push(item);
          continue;
        }
        occupyLane(lanes, lane);
        const runID = randomID("run");
        const activeRun: ProactiveActiveRun = {
          run_id: runID,
          queue_id: item.queue_id,
          task_id: item.task_id,
          task_name: item.task_name,
          mode: item.mode,
          lane,
          status: "running",
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
          taskState.active_run_id = runID;
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
    if (claim.queueItem.mode === "anchor-session") {
      const anchor = await this.ensureAnchorSession();
      rootSessionID = anchor.session_id!;
      title = anchor.title ?? this.config!.anchor.title;
    } else {
      title = task?.name ? `Proactive: ${task.name}` : "Proactive Isolated Run";
      const session = await this.client.createSession(title);
      rootSessionID = session.id;
    }

    await mutateProactiveState(async (state) => {
      const active = state.active[claim.activeRun.run_id];
      if (!active) return;
      active.root_session_id = rootSessionID;
      active.session_id = rootSessionID;
    });

    const dispatchModel = claim.queueItem.model ?? (claim.queueItem.mode === "anchor-session" ? this.config!.anchor.model : undefined);
    const dispatchAgent = claim.queueItem.agent ?? (claim.queueItem.mode === "anchor-session" ? this.config!.anchor.agent : undefined);
    const prompt = buildPrompt(
      claim,
      context,
      precheckResult,
      claim.queueItem.mode === "anchor-session" ? this.config!.anchor.light_context : undefined,
    );
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
            if (active.lane === "anchor") {
              state.anchor.session_id = sessionID;
              state.anchor.updated_at = Date.now();
              if (!state.anchor.lineage.includes(sessionID)) state.anchor.lineage.push(sessionID);
            }
          });
        },
      });
      if (claim.queueItem.mode === "anchor-session") {
        await mutateProactiveState(async (state) => {
          state.anchor.session_id = outcome.finalSessionID;
          state.anchor.updated_at = Date.now();
          if (!state.anchor.lineage.includes(outcome.finalSessionID)) state.anchor.lineage.push(outcome.finalSessionID);
        });
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
        if (task && task.policy.cooldown_ms && input.status !== "failed") {
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

      if (task && input.status === "failed" && input.retryable && shouldRetry(task, claim.activeRun.attempt)) {
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

      if (active?.lane === "anchor" && input.finalSessionID) {
        state.anchor.session_id = input.finalSessionID;
        state.anchor.updated_at = endedAt;
        if (!state.anchor.lineage.includes(input.finalSessionID)) state.anchor.lineage.push(input.finalSessionID);
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
      instructions: task.instructions,
      mode: task.mode,
      priority: task.priority,
      ttlMs: task.policy.ttl_ms,
      notBefore: input.now,
      agent: task.agent ?? (task.mode === "anchor-session" ? this.config?.anchor.agent : undefined),
      model: task.model ?? (task.mode === "anchor-session" ? this.config?.anchor.model : undefined),
      context: {
        purpose: task.purpose,
        ...input.context,
      },
      command: task.command,
      scheduledAt: input.scheduledAt,
      attempt: 1,
      enforceEnabled: input.enforceEnabled,
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
    if (taskState && input.task.policy.no_overlap && hasTaskInFlight(state, input.task.id)) {
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

    const dedupeKey = input.dedupeKey ?? (input.task.policy.no_overlap && input.taskID ? `task:${input.taskID}` : undefined);
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
      agent: input.agent,
      model: input.model,
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
    if (!task) return undefined;
    const taskState = ensureTaskState(state, task.id);
    if (task.enabled === false) return "task disabled";
    if (task.policy.no_overlap) {
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

  private async ensureAnchorSession() {
    this.requireEnabled();
    const existing = await mutateProactiveState(async (state) => {
      const anchor = state.anchor;
      const resolved = anchor.root_session_id
        ? resolveCompaction(anchor.root_session_id, await readCompactionStateSafe())
        : undefined;
      const current = resolved?.currentSessionID ?? anchor.session_id;
      if (current) {
        try {
          const session = await this.client.getSession(current);
          anchor.session_id = session.id;
          anchor.root_session_id ??= session.id;
          anchor.title = session.title;
          anchor.agent = this.config!.anchor.agent;
          anchor.model = this.config!.anchor.model;
          anchor.updated_at = Date.now();
          if (!anchor.lineage.includes(session.id)) anchor.lineage.push(session.id);
          return anchor;
        } catch {
          // recreate below
        }
      }

      const session = await this.client.createSession(this.config!.anchor.title);
      anchor.session_id = session.id;
      anchor.root_session_id = session.id;
      anchor.title = session.title;
      anchor.agent = this.config!.anchor.agent;
      anchor.model = this.config!.anchor.model;
      anchor.updated_at = Date.now();
      if (!anchor.lineage.includes(session.id)) anchor.lineage.push(session.id);
      return anchor;
    });
    return existing.result;
  }

  private async refreshAnchorFromCompaction() {
    if (!this.config?.enabled) return;
    await mutateProactiveState(async (state) => {
      if (!state.anchor.root_session_id) return;
      const compaction = await readCompactionStateSafe();
      const resolution = resolveCompaction(state.anchor.root_session_id, compaction);
      if (resolution.currentSessionID && resolution.currentSessionID !== state.anchor.session_id) {
        state.anchor.session_id = resolution.currentSessionID;
        state.anchor.updated_at = Date.now();
        if (!state.anchor.lineage.includes(resolution.currentSessionID)) {
          state.anchor.lineage.push(resolution.currentSessionID);
        }
      }
    });
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
    this.workerConfig = await loadWorkerConfig();
    this.config = this.workerConfig.proactive;
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
    return this.config?.timezone ?? this.workerConfig?.cron.timezone;
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

function buildPrompt(
  claim: DispatchClaim,
  context: Record<string, unknown>,
  precheckResult?: PrecheckResult,
  anchorLightContext?: string,
) {
  const contextText = Object.keys(context).length > 0 ? JSON.stringify(context, null, 2) : "{}";
  const lines = [claim.queueItem.instructions.trim()];
  if (anchorLightContext?.trim()) {
    lines.push("");
    lines.push("Anchor light context:");
    lines.push(anchorLightContext.trim());
  }
  lines.push("");
  lines.push("Proactive runtime context:");
  lines.push(`- Wake reason: ${claim.queueItem.wake_reason}`);
  if (claim.queueItem.task_name) lines.push(`- Task: ${claim.queueItem.task_name}`);
  if (claim.queueItem.source.type) lines.push(`- Source type: ${claim.queueItem.source.type}`);
  if (precheckResult?.reason) lines.push(`- Precheck: ${precheckResult.reason}`);
  lines.push("");
  lines.push("Structured context:");
  lines.push("```json");
  lines.push(contextText);
  lines.push("```");
  return lines.join("\n").trim();
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
  if (state.anchor.session_id === sessionID || state.anchor.root_session_id === sessionID) {
    return "anchor";
  }
  const active = Object.values(state.active).find(
    (run) => run.session_id === sessionID || run.root_session_id === sessionID,
  );
  if (!active) return "user-session";
  return active.mode === "isolated-session" ? "isolated" : active.mode === "anchor-session" ? "anchor" : "trigger";
}

function belongsToProactive(state: ProactiveState, sessionID: string) {
  if (state.anchor.session_id === sessionID || state.anchor.root_session_id === sessionID) return true;
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
    anchor: active.some((run) => run.lane === "anchor"),
    exec: active.some((run) => run.lane === "exec"),
    isolated: active.filter((run) => run.lane === "isolated").length,
    isolated_limit: maxConcurrentRuns,
  };
}

function laneAvailable(
  lanes: ReturnType<typeof laneAvailability>,
  lane: ProactiveLane,
) {
  if (lane === "anchor") return !lanes.anchor;
  if (lane === "exec") return !lanes.exec;
  return lanes.isolated < lanes.isolated_limit;
}

function occupyLane(lanes: ReturnType<typeof laneAvailability>, lane: ProactiveLane) {
  if (lane === "anchor") lanes.anchor = true;
  else if (lane === "exec") lanes.exec = true;
  else lanes.isolated += 1;
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
