import path from "node:path";
import { parseJsonc, readText, record, root } from "./shared";
import type { ModelRef } from "./shared";

export type CronJob = {
  id: string;
  cron: string;
  enabled?: boolean;
  no_overlap?: boolean;
  title?: string;
  prompt?: string;
  exec?: string[];
  agent?: string;
  model?: ModelRef;
};

export type CronConfig = {
  timezone?: string;
  jobs: CronJob[];
};

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

export type WorkerConfig = {
  cron: CronConfig;
  compaction: CompactionConfig;
};

const file = path.resolve(root, ".opencode/server.jsonc");

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

export async function loadWorkerConfig() {
  const raw = parseJsonc(await readText(file));
  return parseWorkerConfig(raw);
}

function parseWorkerConfig(input: unknown): WorkerConfig {
  if (!record(input)) {
    throw new Error("server.jsonc must be an object");
  }

  const cronSource = resolveCronSource(input);
  const compactionSource = record(input.compaction) ? input.compaction : {};

  return {
    cron: parseCronConfig(cronSource),
    compaction: parseCompactionConfig(compactionSource),
  };
}

function resolveCronSource(input: Record<string, unknown>) {
  if (record(input.cron)) return input.cron;
  return input;
}

function parseCronConfig(input: unknown): CronConfig {
  if (!record(input)) {
    return { jobs: [] };
  }
  const jobs = Array.isArray(input.jobs) ? input.jobs.filter(isCronJob) : [];
  return {
    timezone: typeof input.timezone === "string" ? input.timezone : undefined,
    jobs,
  };
}

function isCronJob(input: unknown): input is CronJob {
  if (!record(input)) return false;
  if (typeof input.id !== "string") return false;
  if (typeof input.cron !== "string") return false;
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") return false;
  if (input.no_overlap !== undefined && typeof input.no_overlap !== "boolean") return false;

  const hasPrompt = typeof input.prompt === "string";
  let hasExec = false;
  if (Array.isArray(input.exec)) {
    if (input.exec.length === 0) return false;
    if (!input.exec.every((part) => typeof part === "string")) return false;
    hasExec = true;
  }
  if (hasPrompt === hasExec) return false;

  if (input.title !== undefined && typeof input.title !== "string") return false;
  if (input.agent !== undefined && typeof input.agent !== "string") return false;
  if (input.model !== undefined) {
    if (!record(input.model)) return false;
    if (typeof input.model.providerID !== "string") return false;
    if (typeof input.model.modelID !== "string") return false;
    if (input.model.variant !== undefined && typeof input.model.variant !== "string") return false;
  }
  return true;
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

function asPositiveInt(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) && input > 0 ? input : undefined;
}

function asNonNegativeInt(input: unknown) {
  return typeof input === "number" && Number.isInteger(input) && input >= 0 ? input : undefined;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_COMPACTION_CONFIG.default_threshold;
  if (value < 0.05) return 0.05;
  if (value > 0.99) return 0.99;
  return value;
}
