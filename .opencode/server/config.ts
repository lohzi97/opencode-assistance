import path from "node:path";
import { parseJsonc, readText, record, root } from "./shared";
import type { ModelRef } from "./shared";

export type CleanupPolicy = "keep" | "delete" | "archive";

export type CompactionConfig = {
  enabled: boolean;
  default_threshold: number;
  models: Record<
    string,
    {
      threshold?: number;
      context_limit?: number;
    }
  >;
  carryover: {
    max_recent_assistant_messages: number;
    max_recent_tool_parts: number;
    max_recent_text_chars: number;
  };
  summarizer?: ModelRef & {
    variant?: string;
    agent?: string;
  };
  rename_original: boolean;
  rename_delay_ms: number;
  temp_session_cleanup: CleanupPolicy;
  prevent_builtin_compaction: boolean;
  abort_wait_ms: number;
  history_retry_count: number;
  provider_refresh_ms: number;
};

export type ProactiveRetryPolicy = {
  max_attempts: number;
  delay_ms: number;
};

export type ProactiveBudgetPolicy = {
  window_ms: number;
  max_runs?: number;
  max_isolated_llm_runs?: number;
};

export type QuietHoursConfig = {
  start: string;
  end: string;
  timezone?: string;
  channels: string[];
};

export type ProactiveTaskPolicy = {
  no_overlap: boolean;
  max_runtime_ms?: number;
  retry?: ProactiveRetryPolicy;
  quiet_hours?: QuietHoursConfig;
  cooldown_ms?: number;
  budget?: ProactiveBudgetPolicy;
  silence_ok: boolean;
  ttl_ms: number;
};

export type ProactivePrecheck =
  | {
      kind: "exec";
      cmd: string[];
    }
  | {
      kind: "internal";
      name: string;
    };

export type ProactiveAnchorRetrigger =
  | {
      kind: "cron";
      expr: string;
    }
  | {
      kind: "every";
      minutes: number;
    };

export type ProactiveTaskAnchorConfig = {
  duration_ms: number;
  end_instructions: string;
  rollover_threshold: number;
  rollover_instructions: string;
  retrigger?: ProactiveAnchorRetrigger;
  retrigger_instructions?: string;
};

export type ProactiveTrigger =
  | {
      kind: "cron";
      expr: string;
    }
  | {
      kind: "every";
      minutes: number;
    }
  | {
      kind: "at";
      timestamp: string;
    }
  | {
      kind: "event";
      name: string;
      include_user_sessions: boolean;
      match: Record<string, string | number | boolean | null>;
      debounce_ms?: number;
      max_queue_per_window?: number;
      window_ms?: number;
    };

export type ProactiveTaskConfig = {
  id: string;
  name: string;
  enabled: boolean;
  purpose: string;
  trigger: ProactiveTrigger;
  mode: "anchor-session" | "isolated-session" | "exec";
  instructions: string;
  command?: string[];
  agent?: string;
  model?: ModelRef;
  anchor?: ProactiveTaskAnchorConfig;
  priority: number;
  precheck?: ProactivePrecheck;
  policy: ProactiveTaskPolicy;
};

export type ProactiveDispatcherConfig = {
  poll_interval_ms: number;
  max_concurrent_runs: number;
};

export type ProactiveDefaultsConfig = {
  no_overlap: boolean;
  max_runtime_ms?: number;
  silence_ok: boolean;
  retry?: ProactiveRetryPolicy;
  quiet_hours?: QuietHoursConfig;
  cooldown_ms?: number;
  budget?: ProactiveBudgetPolicy;
  ttl_ms: number;
};

export type ProactiveDeliveryConfig = {
  quiet_hours?: QuietHoursConfig;
};

export type ProactiveConfig = {
  enabled: boolean;
  timezone?: string;
  dispatcher: ProactiveDispatcherConfig;
  defaults: ProactiveDefaultsConfig;
  delivery: ProactiveDeliveryConfig;
  tasks: ProactiveTaskConfig[];
};

export type WorkerConfig = {
  compaction: CompactionConfig;
  proactive: ProactiveConfig;
};

export const workerConfigFile = path.resolve(root, ".opencode/server.jsonc");

const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  default_threshold: 0.7,
  models: {},
  carryover: {
    max_recent_assistant_messages: 3,
    max_recent_tool_parts: 6,
    max_recent_text_chars: 12_000,
  },
  summarizer: {
    providerID: "zai-coding-plan",
    modelID: "glm-5.1",
  },
  rename_original: true,
  rename_delay_ms: 500,
  temp_session_cleanup: "archive",
  prevent_builtin_compaction: true,
  abort_wait_ms: 15_000,
  history_retry_count: 3,
  provider_refresh_ms: 300_000,
};

const DEFAULT_PROACTIVE_CONFIG: ProactiveConfig = {
  enabled: false,
  dispatcher: {
    poll_interval_ms: 60_000,
    max_concurrent_runs: 1,
  },
  defaults: {
    no_overlap: true,
    silence_ok: true,
    ttl_ms: 1_800_000,
    cooldown_ms: 0,
    retry: {
      max_attempts: 1,
      delay_ms: 60_000,
    },
  },
  delivery: {},
  tasks: [],
};

export async function loadWorkerConfig() {
  const raw = parseJsonc(await readText(workerConfigFile));
  return parseWorkerConfig(raw);
}

function parseWorkerConfig(input: unknown): WorkerConfig {
  if (!record(input)) {
    throw new Error("server.jsonc must be an object");
  }

  const compactionSource = record(input.compaction) ? input.compaction : {};
  const proactiveSource = record(input.proactive) ? input.proactive : {};

  return {
    compaction: parseCompactionConfig(compactionSource),
    proactive: parseProactiveConfig(proactiveSource),
  };
}

function parseCompactionConfig(input: unknown): CompactionConfig {
  if (!record(input)) return DEFAULT_COMPACTION_CONFIG;
  const rawModels = record(input.models) ? input.models : {};
  const models: CompactionConfig["models"] = {};
  for (const [key, value] of Object.entries(rawModels)) {
    if (!record(value)) continue;
    models[key] = {
      threshold: typeof value.threshold === "number" ? clampRatio(value.threshold) : undefined,
      context_limit:
        typeof value.context_limit === "number" && value.context_limit > 0 ? value.context_limit : undefined,
    };
  }

  const carryover = record(input.carryover) ? input.carryover : {};
  const summarizer =
    record(input.summarizer) &&
    typeof input.summarizer.providerID === "string" &&
    typeof input.summarizer.modelID === "string"
      ? {
          providerID: input.summarizer.providerID,
          modelID: input.summarizer.modelID,
          variant: typeof input.summarizer.variant === "string" ? input.summarizer.variant : undefined,
          agent: typeof input.summarizer.agent === "string" ? input.summarizer.agent : undefined,
        }
      : DEFAULT_COMPACTION_CONFIG.summarizer;

  return {
    enabled: input.enabled !== false,
    default_threshold:
      typeof input.default_threshold === "number"
        ? clampRatio(input.default_threshold)
        : DEFAULT_COMPACTION_CONFIG.default_threshold,
    models,
    carryover: {
      max_recent_assistant_messages:
        asPositiveInt(carryover.max_recent_assistant_messages) ??
        DEFAULT_COMPACTION_CONFIG.carryover.max_recent_assistant_messages,
      max_recent_tool_parts:
        asPositiveInt(carryover.max_recent_tool_parts) ??
        DEFAULT_COMPACTION_CONFIG.carryover.max_recent_tool_parts,
      max_recent_text_chars:
        asPositiveInt(carryover.max_recent_text_chars) ??
        DEFAULT_COMPACTION_CONFIG.carryover.max_recent_text_chars,
    },
    summarizer,
    rename_original:
      typeof input.rename_original === "boolean"
        ? input.rename_original
        : DEFAULT_COMPACTION_CONFIG.rename_original,
    rename_delay_ms:
      asNonNegativeInt(input.rename_delay_ms) ?? DEFAULT_COMPACTION_CONFIG.rename_delay_ms,
    temp_session_cleanup:
      input.temp_session_cleanup === "keep" ||
      input.temp_session_cleanup === "delete" ||
      input.temp_session_cleanup === "archive"
        ? input.temp_session_cleanup
        : DEFAULT_COMPACTION_CONFIG.temp_session_cleanup,
    prevent_builtin_compaction:
      typeof input.prevent_builtin_compaction === "boolean"
        ? input.prevent_builtin_compaction
        : DEFAULT_COMPACTION_CONFIG.prevent_builtin_compaction,
    abort_wait_ms:
      asPositiveInt(input.abort_wait_ms) ?? DEFAULT_COMPACTION_CONFIG.abort_wait_ms,
    history_retry_count:
      asPositiveInt(input.history_retry_count) ?? DEFAULT_COMPACTION_CONFIG.history_retry_count,
    provider_refresh_ms:
      asPositiveInt(input.provider_refresh_ms) ?? DEFAULT_COMPACTION_CONFIG.provider_refresh_ms,
  };
}

function parseProactiveConfig(input: unknown): ProactiveConfig {
  if (!record(input)) return DEFAULT_PROACTIVE_CONFIG;
  const dispatcher = record(input.dispatcher) ? input.dispatcher : {};
  const defaults = record(input.defaults) ? input.defaults : {};
  const delivery = record(input.delivery) ? input.delivery : {};
  const tasks = Array.isArray(input.tasks) ? input.tasks.flatMap((value) => parseProactiveTask(value, defaults)) : [];

  if (input.anchor !== undefined) {
    throw new Error("proactive.anchor is no longer supported; move anchor behavior into per-task settings");
  }

  return {
    enabled: input.enabled === true,
    timezone: typeof input.timezone === "string" ? input.timezone : undefined,
    dispatcher: {
      poll_interval_ms:
        asPositiveInt(dispatcher.poll_interval_ms) ?? DEFAULT_PROACTIVE_CONFIG.dispatcher.poll_interval_ms,
      max_concurrent_runs:
        asPositiveInt(dispatcher.max_concurrent_runs) ?? DEFAULT_PROACTIVE_CONFIG.dispatcher.max_concurrent_runs,
    },
    defaults: {
      no_overlap:
        typeof defaults.no_overlap === "boolean" ? defaults.no_overlap : DEFAULT_PROACTIVE_CONFIG.defaults.no_overlap,
      max_runtime_ms: asPositiveInt(defaults.max_runtime_ms),
      silence_ok:
        typeof defaults.silence_ok === "boolean" ? defaults.silence_ok : DEFAULT_PROACTIVE_CONFIG.defaults.silence_ok,
      retry: parseRetry(defaults.retry) ?? DEFAULT_PROACTIVE_CONFIG.defaults.retry,
      quiet_hours: parseQuietHours(defaults.quiet_hours),
      cooldown_ms: asNonNegativeInt(defaults.cooldown_ms) ?? DEFAULT_PROACTIVE_CONFIG.defaults.cooldown_ms,
      budget: parseBudget(defaults.budget),
      ttl_ms: asPositiveInt(defaults.ttl_ms) ?? DEFAULT_PROACTIVE_CONFIG.defaults.ttl_ms,
    },
    delivery: {
      quiet_hours: parseQuietHours(delivery.quiet_hours),
    },
    tasks,
  };
}

function parseProactiveTask(
  input: unknown,
  defaults: Record<string, unknown>,
): ProactiveTaskConfig[] {
  if (!record(input)) return [];
  if (typeof input.id !== "string") return [];
  if (typeof input.name !== "string") return [];
  if (typeof input.purpose !== "string") return [];
  if (typeof input.instructions !== "string") return [];
  if (input.mode !== "anchor-session" && input.mode !== "isolated-session" && input.mode !== "exec") return [];
  const trigger = parseTrigger(input.trigger);
  if (!trigger) return [];
  const anchor = input.mode === "anchor-session" ? parseTaskAnchor(input.anchor) : undefined;
  if (input.mode === "anchor-session" && !anchor) return [];
  const precheck = parsePrecheck(input.precheck);
  const policy = parseTaskPolicy(input.policy, defaults);
  const command = Array.isArray(input.command)
    ? input.command.filter((value): value is string => typeof value === "string")
    : undefined;
  if (input.mode === "exec" && (!command || command.length === 0)) return [];
  return [
    {
      id: input.id,
      name: input.name,
      enabled: input.enabled !== false,
      purpose: input.purpose,
      trigger,
      mode: input.mode,
      instructions: input.instructions,
      command,
      agent: typeof input.agent === "string" ? input.agent : undefined,
      model: parseModelRef(input.model),
      anchor,
      priority: typeof input.priority === "number" ? input.priority : 0,
      precheck,
      policy,
    },
  ];
}

function parseTaskPolicy(input: unknown, defaults: Record<string, unknown>): ProactiveTaskPolicy {
  const source = record(input) ? input : {};
  const retry = parseRetry(source.retry) ?? parseRetry(defaults.retry) ?? DEFAULT_PROACTIVE_CONFIG.defaults.retry;
  return {
    no_overlap: typeof source.no_overlap === "boolean" ? source.no_overlap : defaultBoolean(defaults.no_overlap, true),
    max_runtime_ms: asPositiveInt(source.max_runtime_ms) ?? asPositiveInt(defaults.max_runtime_ms),
    retry,
    quiet_hours: parseQuietHours(source.quiet_hours) ?? parseQuietHours(defaults.quiet_hours),
    cooldown_ms: asNonNegativeInt(source.cooldown_ms) ?? asNonNegativeInt(defaults.cooldown_ms) ?? 0,
    budget: parseBudget(source.budget) ?? parseBudget(defaults.budget),
    silence_ok: typeof source.silence_ok === "boolean" ? source.silence_ok : defaultBoolean(defaults.silence_ok, true),
    ttl_ms: asPositiveInt(source.ttl_ms) ?? asPositiveInt(defaults.ttl_ms) ?? DEFAULT_PROACTIVE_CONFIG.defaults.ttl_ms,
  };
}

function parseTaskAnchor(input: unknown): ProactiveTaskAnchorConfig | undefined {
  if (!record(input)) return undefined;
  const duration_ms = asPositiveInt(input.duration_ms);
  const end_instructions = typeof input.end_instructions === "string" ? input.end_instructions : undefined;
  const rollover_instructions =
    typeof input.rollover_instructions === "string" ? input.rollover_instructions : undefined;
  const rollover_threshold = asRatio(input.rollover_threshold);
  const retrigger = parseAnchorRetrigger(input.retrigger);
  const retrigger_instructions =
    typeof input.retrigger_instructions === "string" ? input.retrigger_instructions : undefined;

  if (!duration_ms || !end_instructions || !rollover_instructions || rollover_threshold === undefined) {
    return undefined;
  }
  if (retrigger && !retrigger_instructions) return undefined;

  return {
    duration_ms,
    end_instructions,
    rollover_threshold,
    rollover_instructions,
    retrigger,
    retrigger_instructions,
  };
}

function parseTrigger(input: unknown): ProactiveTrigger | undefined {
  if (!record(input) || typeof input.kind !== "string") return undefined;
  if (input.kind === "cron" && typeof input.expr === "string") {
    return { kind: "cron", expr: input.expr };
  }
  if (input.kind === "every") {
    const minutes = asPositiveInt(input.minutes);
    if (!minutes) return undefined;
    return { kind: "every", minutes };
  }
  if (input.kind === "at" && typeof input.timestamp === "string" && !Number.isNaN(Date.parse(input.timestamp))) {
    return { kind: "at", timestamp: input.timestamp };
  }
  if (input.kind === "event" && typeof input.name === "string") {
    return {
      kind: "event",
      name: input.name,
      include_user_sessions: input.include_user_sessions === true,
      match: parsePrimitiveRecord(input.match),
      debounce_ms: asNonNegativeInt(input.debounce_ms),
      max_queue_per_window: asPositiveInt(input.max_queue_per_window),
      window_ms: asPositiveInt(input.window_ms),
    };
  }
  return undefined;
}

function parseAnchorRetrigger(input: unknown): ProactiveAnchorRetrigger | undefined {
  if (!record(input) || typeof input.kind !== "string") return undefined;
  if (input.kind === "cron" && typeof input.expr === "string") {
    return { kind: "cron", expr: input.expr };
  }
  if (input.kind === "every") {
    const minutes = asPositiveInt(input.minutes);
    if (!minutes) return undefined;
    return { kind: "every", minutes };
  }
  return undefined;
}

function parsePrecheck(input: unknown): ProactivePrecheck | undefined {
  if (!record(input) || typeof input.kind !== "string") return undefined;
  if (input.kind === "exec" && Array.isArray(input.cmd)) {
    const cmd = input.cmd.filter((value): value is string => typeof value === "string");
    return cmd.length > 0 ? { kind: "exec", cmd } : undefined;
  }
  if (input.kind === "internal" && typeof input.name === "string") {
    return { kind: "internal", name: input.name };
  }
  return undefined;
}

function parseRetry(input: unknown): ProactiveRetryPolicy | undefined {
  if (!record(input)) return undefined;
  const max_attempts = asPositiveInt(input.max_attempts);
  const delay_ms = asPositiveInt(input.delay_ms);
  if (!max_attempts || !delay_ms) return undefined;
  return { max_attempts, delay_ms };
}

function parseBudget(input: unknown): ProactiveBudgetPolicy | undefined {
  if (!record(input)) return undefined;
  const window_ms = asPositiveInt(input.window_ms);
  if (!window_ms) return undefined;
  const max_runs = asPositiveInt(input.max_runs);
  const max_isolated_llm_runs = asPositiveInt(input.max_isolated_llm_runs);
  if (!max_runs && !max_isolated_llm_runs) return undefined;
  return {
    window_ms,
    max_runs,
    max_isolated_llm_runs,
  };
}

function parseQuietHours(input: unknown): QuietHoursConfig | undefined {
  if (!record(input)) return undefined;
  if (typeof input.start !== "string" || typeof input.end !== "string") return undefined;
  const channels = Array.isArray(input.channels)
    ? input.channels.filter((value): value is string => typeof value === "string")
    : [];
  return {
    start: input.start,
    end: input.end,
    timezone: typeof input.timezone === "string" ? input.timezone : undefined,
    channels,
  };
}

function parsePrimitiveRecord(input: unknown) {
  if (!record(input)) return {};
  return Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      value === null || ["string", "number", "boolean"].includes(typeof value) ? [[key, value]] : [],
    ),
  ) as Record<string, string | number | boolean | null>;
}

function parseModelRef(input: unknown) {
  if (!record(input)) return undefined;
  if (typeof input.providerID !== "string" || typeof input.modelID !== "string") return undefined;
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    variant: typeof input.variant === "string" ? input.variant : undefined,
  } satisfies ModelRef;
}

function defaultBoolean(input: unknown, fallback: boolean) {
  return typeof input === "boolean" ? input : fallback;
}

function asPositiveInt(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) && input > 0 ? input : undefined;
}

function asNonNegativeInt(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) && input >= 0 ? input : undefined;
}

function asRatio(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? clampRatio(input) : undefined;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_COMPACTION_CONFIG.default_threshold;
  if (value < 0.05) return 0.05;
  if (value > 0.99) return 0.99;
  return value;
}
