import { appendFile, mkdir, rmdir } from "node:fs/promises";
import path from "node:path";
import { readJsonc, record, stateDir, writeJsonFile, type ModelRef } from "./shared";

export type ProactiveExecutionMode = "anchor-session" | "isolated-session" | "exec";
export type ProactiveQueueKind = "configured-task" | "ad_hoc";
export type ProactiveSourceType = "trigger" | "manual" | "script" | "anchor" | "isolated" | "user-session";
export type ProactiveQueueStatus = "queued" | "dispatched" | "cancelled" | "expired" | "completed" | "failed";
export type ProactiveRunStatus = "running" | "completed" | "failed" | "suppressed" | "expired";
export type ProactiveLane = "anchor" | "isolated" | "exec";

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
  agent?: string;
  model?: ModelRef;
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
  last_cron_stamp?: number;
  last_scheduled_at?: number;
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
  session_id?: string;
  root_session_id?: string;
  title?: string;
  agent?: string;
  model?: ModelRef;
  lineage: string[];
  updated_at?: number;
};

export type ProactiveState = {
  version: 1;
  anchor: ProactiveAnchorState;
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
const proactiveStateLockDir = path.join(stateDir, "proactive-state.lock");

export async function loadProactiveState() {
  return await readJsonc(proactiveStateFile, parseProactiveState, emptyProactiveState());
}

export async function withProactiveStateLock<T>(fn: () => Promise<T>): Promise<T> {
  while (true) {
    try {
      await mkdir(proactiveStateLockDir);
      break;
    } catch (err) {
      if (!record(err) || err.code !== "EEXIST") throw err;
      await Bun.sleep(50);
    }
  }

  try {
    return await fn();
  } finally {
    await rmdir(proactiveStateLockDir).catch(() => undefined);
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

export async function saveProactiveState(state: ProactiveState) {
  await writeJsonFile(proactiveStateFile, state);
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
    anchor: {
      lineage: [],
    },
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
  if (record(input.anchor)) {
    state.anchor = {
      session_id: asString(input.anchor.session_id),
      root_session_id: asString(input.anchor.root_session_id),
      title: asString(input.anchor.title),
      agent: asString(input.anchor.agent),
      model: parseModelRef(input.anchor.model),
      lineage: Array.isArray(input.anchor.lineage)
        ? input.anchor.lineage.filter((value): value is string => typeof value === "string")
        : [],
      updated_at: asNumber(input.anchor.updated_at),
    };
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
    last_cron_stamp: asNumber(input.last_cron_stamp),
    last_scheduled_at: asNumber(input.last_scheduled_at),
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
    agent: asString(input.agent),
    model: parseModelRef(input.model),
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
