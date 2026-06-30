import { appendFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJsonc, record, stateDir, writeJsonFile, type ModelRef } from "./shared";

export type ProactiveExecutionMode = "anchor-session" | "isolated-session" | "exec";
export type ProactiveQueueKind = "configured-task" | "ad_hoc";
export type ProactiveSourceType = "trigger" | "manual" | "script" | "anchor" | "isolated" | "user-session";
export type ProactiveQueueStatus = "queued" | "dispatched" | "cancelled" | "expired" | "completed" | "failed";
export type ProactiveRunStatus = "running" | "completed" | "failed" | "suppressed" | "expired";
export type ProactiveLane = "anchor" | "isolated" | "exec";
export type ProactiveAnchorAction = "start" | "retrigger" | "rollover" | "end";

export type ProactiveAnchorWindowStatus = "open" | "closing" | "rolling-over";

export type ProactiveQueueSource = {
  type: ProactiveSourceType;
  session_id?: string;
  run_id?: string;
  event_name?: string;
};

export type ProactiveQueueItem = {
  queue_id: string;
  kind: ProactiveQueueKind;
  task_id?: string;
  task_name?: string;
  trigger_kind?: string;
  source: ProactiveQueueSource;
  created_at: number;
  scheduled_at?: number;
  not_before: number;
  priority: number;
  dedupe_key?: string;
  ttl_ms: number;
  mode: ProactiveExecutionMode;
  anchor_action?: ProactiveAnchorAction;
  anchor_window_id?: string;
  agent?: string;
  model?: ModelRef;
  title?: string;
  instructions: string;
  context: Record<string, unknown>;
  status: ProactiveQueueStatus;
  wake_reason: string;
  command?: string[];
  attempt?: number;
};

export type ProactiveActiveRun = {
  run_id: string;
  queue_id: string;
  task_id?: string;
  task_name?: string;
  mode: ProactiveExecutionMode;
  lane: ProactiveLane;
  status: "running";
  anchor_action?: ProactiveAnchorAction;
  anchor_window_id?: string;
  started_at: number;
  wake_reason: string;
  root_session_id?: string;
  session_id?: string;
  pid?: number;
  attempt: number;
  source: ProactiveQueueSource;
  trigger_kind?: string;
  instructions: string;
  command?: string[];
  context: Record<string, unknown>;
  dedupe_key?: string;
};

export type ProactiveTaskState = {
  trigger_signature?: string;
  last_cron_stamp?: number;
  last_scheduled_at?: number;
  last_retrigger_at?: number;
  last_started_at?: number;
  last_completed_at?: number;
  last_status?: string;
  active_run_id?: string;
  cooldown_until?: number;
  at_resolved_at?: number;
  at_status?: "pending" | "fired" | "missed";
  recent_event_at?: number;
  event_window: number[];
  recent_runs: number[];
  recent_isolated_llm_runs: number[];
  suppression_count: number;
  failure_count: number;
};

export type ProactiveAnchorState = {
  task_id: string;
  open_windows: ProactiveAnchorWindow[];
  updated_at?: number;
};

export type ProactiveAnchorWindow = {
  window_id: string;
  scheduled_start_at: number;
  window_end_at: number;
  status: ProactiveAnchorWindowStatus;
  current_session_id?: string;
  root_session_id?: string;
  lineage: string[];
  rendered_title: string;
  agent?: string;
  model?: ModelRef;
  last_retrigger_at?: number;
  last_usage_ratio?: number;
  last_tokens_total?: number;
  last_message_id?: string;
  pending_action?: ProactiveAnchorAction;
  last_error?: string;
  updated_at?: number;
};

export type ProactiveState = {
  version: 1;
  anchors: Record<string, ProactiveAnchorState>;
  tasks: Record<string, ProactiveTaskState>;
  queue: ProactiveQueueItem[];
  active: Record<string, ProactiveActiveRun>;
  suppression_counters: Record<string, number>;
  failure_counters: Record<string, number>;
};

export type ProactiveRunLedgerEntry = {
  run_id: string;
  queue_id: string;
  task_id?: string;
  task_name?: string;
  trigger_kind?: string;
  wake_reason: string;
  mode: ProactiveExecutionMode;
  started_at?: number;
  ended_at: number;
  status: ProactiveRunStatus;
  summary?: string;
  error?: string;
  session_id?: string;
  pid?: number;
  suppressed?: boolean;
  suppression_reason?: string;
};

export type DeliveryChannelState = {
  suppressed: boolean;
  reason?: string;
  updated_at: number;
};

export type DeliveryRuntimeState = {
  version: 1;
  channels: Record<string, DeliveryChannelState>;
};

export const proactiveStateFile = path.join(stateDir, "proactive-state.json");
export const proactiveRunsFile = path.join(stateDir, "proactive-runs.jsonl");
export const proactiveFailureDir = path.join(stateDir, "proactive", "failures");
export const telegramPingStateFile = path.resolve(path.join(stateDir, "..", "..", "telegram-ping-state.json"));
export const proactiveAnchorRegistryFile = path.join(stateDir, "proactive-anchor-registry.json");
const proactiveStateLockDir = path.join(stateDir, "proactive-state.lock");

export async function loadProactiveState() {
  return await readJsonc(proactiveStateFile, parseProactiveState, emptyProactiveState());
}

const lockPidFile = path.join(proactiveStateLockDir, "owner.pid");
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const LOCK_OWNER_WRITE_GRACE_MS = 2_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (record(err) && err.code === "EPERM") return true;
    return false;
  }
}

function parseLockOwner(text: string) {
  const [pidText, token] = text.trim().split(":", 2);
  const pid = Number(pidText);
  return Number.isInteger(pid) && pid > 0 ? { pid, token } : undefined;
}

async function readLockOwner(): Promise<{ pid: number; token?: string } | undefined> {
  try {
    const text = await readFile(lockPidFile, "utf8");
    return parseLockOwner(text);
  } catch {
    return undefined;
  }
}

async function lockAgeMs() {
  try {
    return Date.now() - (await stat(proactiveStateLockDir)).mtimeMs;
  } catch {
    return 0;
  }
}

async function removeLockDir() {
  await rm(proactiveStateLockDir, { recursive: true, force: true });
}

async function stealStaleLock(): Promise<boolean> {
  const owner = await readLockOwner();
  if (owner === undefined) {
    // The owner file is written right after mkdir. Give a fresh lock a moment
    // before treating no-owner legacy locks as stale.
    if ((await lockAgeMs()) < LOCK_OWNER_WRITE_GRACE_MS) return false;
    await removeLockDir();
    return true;
  }
  if (!isProcessAlive(owner.pid)) {
    await removeLockDir();
    return true;
  }
  return false;
}

export async function withProactiveStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  const lockOwner = `${process.pid}:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  while (true) {
    try {
      await mkdir(proactiveStateLockDir);
      try {
        await writeFile(lockPidFile, lockOwner);
      } catch (err) {
        await removeLockDir().catch(() => undefined);
        throw err;
      }
      break;
    } catch (err) {
      if (!record(err) || err.code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        const owner = await readLockOwner();
        throw new Error(
          `proactive state lock acquisition timed out after ${LOCK_ACQUIRE_TIMEOUT_MS}ms (holder PID ${owner?.pid ?? "unknown"})`,
        );
      }
      if (await stealStaleLock()) continue;
      await Bun.sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    const owner = await readFile(lockPidFile, "utf8").catch(() => undefined);
    if (owner?.trim() === lockOwner) {
      await removeLockDir().catch(() => undefined);
    }
  }
}

export async function mutateProactiveState<T>(
  mutator: (state: ProactiveState) => Promise<T> | T,
): Promise<{ state: ProactiveState; result: T }> {
  return await withProactiveStateLock(async () => {
    const state = await loadProactiveState();
    const result = await mutator(state);
    await saveProactiveState(state);
    return { state, result };
  });
}

const ANCHOR_REGISTRY_MAX_SESSIONS = 10_000;

export async function saveProactiveState(state: ProactiveState) {
  const existingRegistry = await loadProactiveAnchorRegistry();
  const currentSessions = Object.values(state.anchors).flatMap((anchor) =>
    anchor.open_windows.flatMap((window) =>
      [window.current_session_id, window.root_session_id, ...window.lineage].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  const merged = [...new Set([...existingRegistry, ...currentSessions])].sort();
  // Safety cap: contract point 20 requires permanent compaction exemption for all lineage
  // sessions, so this only trims when the registry grows far beyond any reasonable deployment.
  const capped = merged.length > ANCHOR_REGISTRY_MAX_SESSIONS ? merged.slice(merged.length - ANCHOR_REGISTRY_MAX_SESSIONS) : merged;
  await writeJsonFile(proactiveStateFile, state);
  await writeJsonFile(proactiveAnchorRegistryFile, {
    version: 1,
    sessions: capped,
  });
}

export async function loadProactiveAnchorRegistry() {
  try {
    const parsed = JSON.parse(await readFile(proactiveAnchorRegistryFile, "utf8")) as {
      sessions?: unknown;
    };
    return Array.isArray(parsed.sessions)
      ? parsed.sessions.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export async function appendRunLedger(entry: ProactiveRunLedgerEntry) {
  await mkdir(path.dirname(proactiveRunsFile), { recursive: true });
  await appendFile(proactiveRunsFile, JSON.stringify(entry) + "\n", "utf8");
}

export async function writeFailureArtifact(taskID: string, runID: string, artifact: unknown) {
  const dir = path.join(proactiveFailureDir, sanitizeSegment(taskID || "ad-hoc"));
  await mkdir(dir, { recursive: true });
  await writeJsonFile(path.join(dir, `${sanitizeSegment(runID)}.json`), artifact);
}

export async function writeDeliveryRuntimeState(state: DeliveryRuntimeState) {
  await mkdir(path.dirname(telegramPingStateFile), { recursive: true });
  await writeJsonFile(telegramPingStateFile, state);
}

export async function loadDeliveryRuntimeState() {
  return await readJsonc(telegramPingStateFile, parseDeliveryRuntimeState, emptyDeliveryRuntimeState());
}

export function emptyProactiveState(): ProactiveState {
  return {
    version: 1,
    anchors: {},
    tasks: {},
    queue: [],
    active: {},
    suppression_counters: {},
    failure_counters: {},
  };
}

export function emptyTaskState(): ProactiveTaskState {
  return {
    event_window: [],
    recent_runs: [],
    recent_isolated_llm_runs: [],
    suppression_count: 0,
    failure_count: 0,
  };
}

export function emptyDeliveryRuntimeState(): DeliveryRuntimeState {
  return {
    version: 1,
    channels: {},
  };
}

export function ensureTaskState(state: ProactiveState, taskID: string) {
  state.tasks[taskID] ??= emptyTaskState();
  return state.tasks[taskID];
}

export function ensureAnchorState(state: ProactiveState, taskID: string) {
  state.anchors[taskID] ??= {
    task_id: taskID,
    open_windows: [],
  };
  return state.anchors[taskID];
}

export function createAnchorWindow(input: {
  windowID: string;
  scheduledStartAt: number;
  windowEndAt: number;
  renderedTitle: string;
  updatedAt: number;
}): ProactiveAnchorWindow {
  return {
    window_id: input.windowID,
    scheduled_start_at: input.scheduledStartAt,
    window_end_at: input.windowEndAt,
    status: "open",
    lineage: [],
    rendered_title: input.renderedTitle,
    updated_at: input.updatedAt,
  };
}

export function findAnchorWindow(anchor: ProactiveAnchorState, windowID: string) {
  return anchor.open_windows.find((window) => window.window_id === windowID);
}

export function removeAnchorWindow(anchor: ProactiveAnchorState, windowID: string) {
  const index = anchor.open_windows.findIndex((window) => window.window_id === windowID);
  if (index >= 0) {
    anchor.open_windows.splice(index, 1);
  }
}

export function sortQueue(queue: ProactiveQueueItem[]) {
  return [...queue].sort((left, right) => {
    if (left.priority !== right.priority) return right.priority - left.priority;
    if (left.created_at !== right.created_at) return left.created_at - right.created_at;
    return left.queue_id.localeCompare(right.queue_id);
  });
}

export function randomID(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function pruneTimestamps(values: number[], windowMs: number, now: number) {
  return values.filter((value) => now - value <= windowMs);
}

export function parseProactiveState(input: unknown): ProactiveState {
  if (!record(input)) return emptyProactiveState();
  const state = emptyProactiveState();
  if (record(input.anchors)) {
    for (const [taskID, value] of Object.entries(input.anchors)) {
      const anchor = parseAnchorState(value, taskID);
      if (anchor) state.anchors[taskID] = anchor;
    }
  } else if (record(input.anchor)) {
    const legacy = parseLegacyAnchorState(input.anchor, "legacy-global-anchor");
    if (legacy) state.anchors[legacy.task_id] = legacy;
  }
  if (record(input.tasks)) {
    for (const [taskID, value] of Object.entries(input.tasks)) {
      const task = parseTaskState(value);
      if (task) state.tasks[taskID] = task;
    }
  }
  if (Array.isArray(input.queue)) {
    state.queue = input.queue.flatMap((value) => {
      const item = parseQueueItem(value);
      return item ? [item] : [];
    });
  }
  if (record(input.active)) {
    for (const [runID, value] of Object.entries(input.active)) {
      const run = parseActiveRun(value);
      if (run) state.active[runID] = run;
    }
  }
  state.suppression_counters = parseNumberMap(input.suppression_counters);
  state.failure_counters = parseNumberMap(input.failure_counters);
  return state;
}

export function parseDeliveryRuntimeState(input: unknown): DeliveryRuntimeState {
  if (!record(input)) return emptyDeliveryRuntimeState();
  const out = emptyDeliveryRuntimeState();
  if (!record(input.channels)) return out;
  for (const [key, value] of Object.entries(input.channels)) {
    if (!record(value) || typeof value.suppressed !== "boolean" || typeof value.updated_at !== "number") continue;
    out.channels[key] = {
      suppressed: value.suppressed,
      reason: asString(value.reason),
      updated_at: value.updated_at,
    };
  }
  return out;
}

function parseTaskState(input: unknown): ProactiveTaskState | undefined {
  if (!record(input)) return undefined;
  return {
    trigger_signature: asString(input.trigger_signature),
    last_cron_stamp: asNumber(input.last_cron_stamp),
    last_scheduled_at: asNumber(input.last_scheduled_at),
    last_retrigger_at: asNumber(input.last_retrigger_at),
    last_started_at: asNumber(input.last_started_at),
    last_completed_at: asNumber(input.last_completed_at),
    last_status: asString(input.last_status),
    active_run_id: asString(input.active_run_id),
    cooldown_until: asNumber(input.cooldown_until),
    at_resolved_at: asNumber(input.at_resolved_at),
    at_status:
      input.at_status === "pending" || input.at_status === "fired" || input.at_status === "missed"
        ? input.at_status
        : undefined,
    recent_event_at: asNumber(input.recent_event_at),
    event_window: parseNumberArray(input.event_window),
    recent_runs: parseNumberArray(input.recent_runs),
    recent_isolated_llm_runs: parseNumberArray(input.recent_isolated_llm_runs),
    suppression_count: asNumber(input.suppression_count) ?? 0,
    failure_count: asNumber(input.failure_count) ?? 0,
  };
}

function parseAnchorState(input: unknown, taskID: string): ProactiveAnchorState | undefined {
  if (!record(input)) return undefined;
  return {
    task_id: asString(input.task_id) ?? taskID,
    open_windows: Array.isArray(input.open_windows)
      ? input.open_windows.flatMap((value) => {
          const parsed = parseAnchorWindow(value);
          return parsed ? [parsed] : [];
        })
      : [],
    updated_at: asNumber(input.updated_at),
  };
}

function parseLegacyAnchorState(input: unknown, taskID: string): ProactiveAnchorState | undefined {
  if (!record(input)) return undefined;
  const currentSessionID = asString(input.session_id);
  const rootSessionID = asString(input.root_session_id);
  const title = asString(input.title);
  const windowStartedAt = asNumber(input.window_started_at);
  const windowEndsAt = asNumber(input.window_ends_at);
  const updatedAt = asNumber(input.updated_at) ?? Date.now();
  const active = input.active === true;

  const anchor: ProactiveAnchorState = {
    task_id: asString(input.task_id) ?? taskID,
    open_windows: [],
    updated_at: updatedAt,
  };

  if (active && currentSessionID && windowStartedAt && windowEndsAt) {
    anchor.open_windows.push({
      window_id: `legacy_${windowStartedAt}`,
      scheduled_start_at: windowStartedAt,
      window_end_at: windowEndsAt,
      status: "open",
      current_session_id: currentSessionID,
      root_session_id: rootSessionID ?? currentSessionID,
      lineage: Array.isArray(input.lineage)
        ? input.lineage.filter((value): value is string => typeof value === "string")
        : [currentSessionID],
      rendered_title: title ?? "Anchor",
      agent: asString(input.agent),
      model: parseModelRef(input.model),
      last_retrigger_at: asNumber(input.last_retrigger_at),
      last_usage_ratio: asNumber(input.last_usage_ratio),
      last_tokens_total: asNumber(input.last_tokens_total),
      last_message_id: asString(input.last_message_id),
      updated_at: updatedAt,
    });
  }

  return anchor;
}

function parseAnchorWindow(input: unknown): ProactiveAnchorWindow | undefined {
  if (!record(input)) return undefined;
  if (typeof input.window_id !== "string") return undefined;
  if (typeof input.scheduled_start_at !== "number") return undefined;
  if (typeof input.window_end_at !== "number") return undefined;
  if (typeof input.rendered_title !== "string") return undefined;
  return {
    window_id: input.window_id,
    scheduled_start_at: input.scheduled_start_at,
    window_end_at: input.window_end_at,
    status:
      input.status === "open" || input.status === "closing" || input.status === "rolling-over"
        ? input.status
        : "open",
    current_session_id: asString(input.current_session_id),
    root_session_id: asString(input.root_session_id),
    lineage: Array.isArray(input.lineage)
      ? input.lineage.filter((value): value is string => typeof value === "string")
      : [],
    rendered_title: input.rendered_title,
    agent: asString(input.agent),
    model: parseModelRef(input.model),
    last_retrigger_at: asNumber(input.last_retrigger_at),
    last_usage_ratio: asNumber(input.last_usage_ratio),
    last_tokens_total: asNumber(input.last_tokens_total),
    last_message_id: asString(input.last_message_id),
    pending_action:
      input.pending_action === "start" ||
      input.pending_action === "retrigger" ||
      input.pending_action === "rollover" ||
      input.pending_action === "end"
        ? input.pending_action
        : undefined,
    last_error: asString(input.last_error),
    updated_at: asNumber(input.updated_at),
  };
}

function parseQueueItem(input: unknown): ProactiveQueueItem | undefined {
  if (!record(input)) return undefined;
  if (typeof input.queue_id !== "string") return undefined;
  if (input.kind !== "configured-task" && input.kind !== "ad_hoc") return undefined;
  if (typeof input.created_at !== "number") return undefined;
  if (typeof input.not_before !== "number") return undefined;
  if (typeof input.priority !== "number") return undefined;
  if (typeof input.ttl_ms !== "number") return undefined;
  if (input.mode !== "anchor-session" && input.mode !== "isolated-session" && input.mode !== "exec") return undefined;
  if (typeof input.instructions !== "string") return undefined;
  if (typeof input.wake_reason !== "string") return undefined;
  if (
    input.status !== "queued" &&
    input.status !== "dispatched" &&
    input.status !== "cancelled" &&
    input.status !== "expired" &&
    input.status !== "completed" &&
    input.status !== "failed"
  ) {
    return undefined;
  }
  return {
    queue_id: input.queue_id,
    kind: input.kind,
    task_id: asString(input.task_id),
    task_name: asString(input.task_name),
    trigger_kind: asString(input.trigger_kind),
    source: parseSource(input.source),
    created_at: input.created_at,
    scheduled_at: asNumber(input.scheduled_at),
    not_before: input.not_before,
    priority: input.priority,
    dedupe_key: asString(input.dedupe_key),
    ttl_ms: input.ttl_ms,
    mode: input.mode,
    anchor_action:
      input.anchor_action === "start" ||
      input.anchor_action === "retrigger" ||
      input.anchor_action === "rollover" ||
      input.anchor_action === "end"
        ? input.anchor_action
        : undefined,
    anchor_window_id: asString(input.anchor_window_id),
    agent: asString(input.agent),
    model: parseModelRef(input.model),
    title: asString(input.title),
    instructions: input.instructions,
    context: record(input.context) ? input.context : {},
    status: input.status,
    wake_reason: input.wake_reason,
    command: Array.isArray(input.command)
      ? input.command.filter((value): value is string => typeof value === "string")
      : undefined,
    attempt: asNumber(input.attempt),
  };
}

function parseActiveRun(input: unknown): ProactiveActiveRun | undefined {
  if (!record(input)) return undefined;
  if (typeof input.run_id !== "string") return undefined;
  if (typeof input.queue_id !== "string") return undefined;
  if (typeof input.started_at !== "number") return undefined;
  if (typeof input.wake_reason !== "string") return undefined;
  if (typeof input.instructions !== "string") return undefined;
  if (typeof input.attempt !== "number") return undefined;
  if (input.mode !== "anchor-session" && input.mode !== "isolated-session" && input.mode !== "exec") return undefined;
  if (input.lane !== "anchor" && input.lane !== "isolated" && input.lane !== "exec") return undefined;
  return {
    run_id: input.run_id,
    queue_id: input.queue_id,
    task_id: asString(input.task_id),
    task_name: asString(input.task_name),
    mode: input.mode,
    lane: input.lane,
    status: "running",
    anchor_action:
      input.anchor_action === "start" ||
      input.anchor_action === "retrigger" ||
      input.anchor_action === "rollover" ||
      input.anchor_action === "end"
        ? input.anchor_action
        : undefined,
    anchor_window_id: asString(input.anchor_window_id),
    started_at: input.started_at,
    wake_reason: input.wake_reason,
    root_session_id: asString(input.root_session_id),
    session_id: asString(input.session_id),
    pid: asNumber(input.pid),
    attempt: input.attempt,
    source: parseSource(input.source),
    trigger_kind: asString(input.trigger_kind),
    instructions: input.instructions,
    command: Array.isArray(input.command)
      ? input.command.filter((value): value is string => typeof value === "string")
      : undefined,
    context: record(input.context) ? input.context : {},
    dedupe_key: asString(input.dedupe_key),
  };
}

function parseSource(input: unknown): ProactiveQueueSource {
  if (!record(input)) {
    return { type: "trigger" };
  }
  return {
    type:
      input.type === "trigger" ||
      input.type === "manual" ||
      input.type === "script" ||
      input.type === "anchor" ||
      input.type === "isolated" ||
      input.type === "user-session"
        ? input.type
        : "trigger",
    session_id: asString(input.session_id),
    run_id: asString(input.run_id),
    event_name: asString(input.event_name),
  };
}

function parseModelRef(input: unknown) {
  if (!record(input)) return undefined;
  if (typeof input.providerID !== "string" || typeof input.modelID !== "string") return undefined;
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    variant: asString(input.variant),
  } satisfies ModelRef;
}

function parseNumberMap(input: unknown) {
  if (!record(input)) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) => (typeof value === "number" ? [[key, value]] : [])),
  );
}

function parseNumberArray(input: unknown) {
  return Array.isArray(input) ? input.filter((value): value is number => typeof value === "number") : [];
}

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function asString(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function asNumber(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}
