#!/usr/bin/env bun

/**
 * Run yesterday's session summarization sequentially, then invoke /write-diary.
 *
 * Usage:
 *   bun .opencode/scripts/daily-diary-workflow.ts
 *   bun .opencode/scripts/daily-diary-workflow.ts 20260425
 *   bun .opencode/scripts/daily-diary-workflow.ts --date 20260425 --dry-run
 *   bun .opencode/scripts/daily-diary-workflow.ts --skip-existing
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { loadWorkerConfig } from "../server/config.ts";
import {
  OpenCodeClient,
  readText,
  record,
  root,
  sleep,
  stateDir,
  type MessageWithParts,
  type SessionStatusInfo,
} from "../server/shared.ts";

type Options = {
  date?: string;
  timezone?: string;
  dryRun: boolean;
  skipExisting: boolean;
  pollMs: number;
  timeoutMs: number;
  help: boolean;
};

type SessionTask = {
  rawFile: string;
  rawPath: string;
  summaryPath: string;
  sessionID: string;
};

type CommandRun = {
  rootSessionID: string;
  finalSessionID: string;
};

type CompactionManaged = {
  group_id?: string;
  status?: string;
  superseded_by_session_id?: string;
  error?: string;
};

type CompactionGroup = {
  latest_session_id?: string;
};

type CompactionState = {
  groups: Record<string, CompactionGroup>;
  sessions: Record<string, CompactionManaged>;
};

type CompactionResolution = {
  currentSessionID: string;
  pendingTransition: boolean;
  failed?: {
    sessionID: string;
    error?: string;
  };
};

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const REQUIRED_STABLE_IDLE_POLLS = 2;
const COMMAND_SUMMARIZE = "summarize-session";
const COMMAND_DIARY = "write-diary";
const compactionStateFile = path.join(stateDir, "compaction-state.json");

if (import.meta.main) {
  main().catch((err) => {
    console.error(errorMessage(err));
    process.exit(1);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const timezone = options.timezone ?? (await loadTimezone());
  const targetDate = options.date ?? yesterday(timezone);
  const tasks = await listSessionTasks(targetDate, options.skipExisting);

  console.log(`[workflow] timezone: ${timezone ?? "machine-local"}`);
  console.log(`[workflow] target date: ${targetDate}`);
  console.log(`[workflow] sessions to summarize: ${tasks.length}`);

  if (tasks.length > 0) {
    for (const [index, task] of tasks.entries()) {
      console.log(
        `[workflow] ${String(index + 1).padStart(2, "0")}/${String(tasks.length).padStart(2, "0")} ${task.rawPath}`,
      );
    }
  }

  if (options.dryRun) {
    console.log(`[workflow] dry-run only; final command would be /${COMMAND_DIARY} ${targetDate}`);
    return;
  }

  const client = new OpenCodeClient();
  await client.health();
  await assertCommands(client, [COMMAND_SUMMARIZE, COMMAND_DIARY]);

  for (const [index, task] of tasks.entries()) {
    console.log(
      `[workflow] start summarize ${String(index + 1).padStart(2, "0")}/${String(tasks.length).padStart(2, "0")} ${task.rawPath}`,
    );
    const run = await runCommand(client, {
      title: `Summarize session ${targetDate} (${index + 1}/${tasks.length})`,
      command: COMMAND_SUMMARIZE,
      arguments: task.rawPath,
      pollMs: options.pollMs,
      timeoutMs: options.timeoutMs,
    });
    console.log(
      `[workflow] summarize complete ${task.rawPath} (root ${run.rootSessionID}, final ${run.finalSessionID})`,
    );
  }

  console.log(`[workflow] start diary /${COMMAND_DIARY} ${targetDate}`);
  const diary = await runCommand(client, {
    title: `Write diary ${targetDate}`,
    command: COMMAND_DIARY,
    arguments: targetDate,
    pollMs: options.pollMs,
    timeoutMs: options.timeoutMs,
  });
  console.log(`[workflow] diary complete (root ${diary.rootSessionID}, final ${diary.finalSessionID})`);
}

function printUsage() {
  console.log(`Usage:
  bun .opencode/scripts/daily-diary-workflow.ts [YYYYMMDD]
  bun .opencode/scripts/daily-diary-workflow.ts --date YYYYMMDD [options]

Options:
  --date YYYYMMDD     Explicit target date. Defaults to yesterday in cron timezone.
  --timezone IANA     Override timezone used to derive yesterday.
  --dry-run           Print planned work without creating OpenCode sessions.
  --skip-existing     Skip raw sessions whose summary file already exists.
  --poll-ms N         Poll interval while waiting for command completion. Default: ${DEFAULT_POLL_MS}.
  --timeout-ms N      Per-command timeout in milliseconds. Default: ${DEFAULT_TIMEOUT_MS}.
  --help, -h          Show this help.
`);
}

function parseArgs(args: string[]): Options {
  const out: Options = {
    dryRun: false,
    skipExisting: false,
    pollMs: DEFAULT_POLL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--skip-existing") {
      out.skipExisting = true;
      continue;
    }
    if (arg === "--date") {
      out.date = requireDate(args[++i], "--date");
      continue;
    }
    if (arg === "--timezone") {
      out.timezone = requireValue(args[++i], "--timezone");
      continue;
    }
    if (arg === "--poll-ms") {
      out.pollMs = requireInteger(args[++i], "--poll-ms");
      continue;
    }
    if (arg === "--timeout-ms") {
      out.timeoutMs = requireInteger(args[++i], "--timeout-ms");
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    }
    if (out.date) {
      throw new Error(`unexpected extra argument: ${arg}`);
    }
    out.date = requireDate(arg, "date");
  }

  return out;
}

function requireValue(input: string | undefined, label: string) {
  if (!input) {
    throw new Error(`missing value for ${label}`);
  }
  return input;
}

function requireDate(input: string | undefined, label: string) {
  const value = requireValue(input, label);
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`${label} must be YYYYMMDD`);
  }
  return value;
}

function requireInteger(input: string | undefined, label: string) {
  const value = Number(requireValue(input, label));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

async function loadTimezone() {
  const config = await loadWorkerConfig().catch(() => undefined);
  return config?.cron.timezone;
}

function yesterday(timezone?: string) {
  const parts = zonedDate(new Date(), timezone);
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() - 1);
  return [
    String(base.getUTCFullYear()),
    pad(base.getUTCMonth() + 1),
    pad(base.getUTCDate()),
  ].join("");
}

function zonedDate(now: Date, timezone?: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

async function listSessionTasks(date: string, skipExisting: boolean) {
  const sessionDir = path.join(root, "journals", "session");
  const entries = await readdir(sessionDir, { withFileTypes: true }).catch((err: unknown) => {
    if (isErrno(err, "ENOENT")) return [];
    throw err;
  });

  const tasks: SessionTask[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(date) || !entry.name.endsWith(".md")) continue;
    const sessionID = parseSessionID(entry.name);
    const rawPath = path.posix.join("journals", "session", entry.name);
    const summaryPath = path.join(root, "journals", "session-summary", `${date}_${sessionID}.md`);
    if (skipExisting && (await Bun.file(summaryPath).exists())) continue;
    tasks.push({
      rawFile: entry.name,
      rawPath,
      summaryPath,
      sessionID,
    });
  }

  tasks.sort((left, right) => left.rawFile.localeCompare(right.rawFile));
  return tasks;
}

function parseSessionID(fileName: string) {
  const match = fileName.match(/(ses_[^.]+)\.md$/);
  if (!match) {
    throw new Error(`cannot parse session id from ${fileName}`);
  }
  return match[1];
}

async function assertCommands(client: OpenCodeClient, names: string[]) {
  const commands = await client.req<Array<{ name?: string }>>("/command");
  const available = new Set(commands.flatMap((item) => (typeof item.name === "string" ? [item.name] : [])));
  const missing = names.filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`missing OpenCode commands: ${missing.join(", ")}`);
  }
}

async function runCommand(
  client: OpenCodeClient,
  input: {
    title: string;
    command: string;
    arguments: string;
    pollMs: number;
    timeoutMs: number;
  },
): Promise<CommandRun> {
  const session = await client.createSession(input.title);
  console.log(`[workflow] created session ${session.id}: ${input.title}`);

  await client.command(session.id, {
    command: input.command,
    arguments: input.arguments,
  });

  const finalSessionID = await waitForCompletion(client, session.id, input.timeoutMs, input.pollMs);
  return {
    rootSessionID: session.id,
    finalSessionID,
  };
}

async function waitForCompletion(
  client: OpenCodeClient,
  rootSessionID: string,
  timeoutMs: number,
  pollMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  let currentSessionID = rootSessionID;
  let observedActivity = false;
  let stableIdlePolls = 0;

  while (Date.now() < deadline) {
    const compaction = await readCompactionStateSafe();
    const resolution = resolveCompaction(rootSessionID, compaction);
    if (resolution.failed) {
      throw new Error(
        `compaction failed for ${resolution.failed.sessionID}${
          resolution.failed.error ? `: ${resolution.failed.error}` : ""
        }`,
      );
    }

    if (resolution.currentSessionID !== currentSessionID) {
      console.log(`[workflow] compaction handoff ${currentSessionID} -> ${resolution.currentSessionID}`);
      currentSessionID = resolution.currentSessionID;
      observedActivity = false;
      stableIdlePolls = 0;
    }

    const statusMap = await client.sessionStatus().catch(() => ({}));
    const status = statusMap[currentSessionID];
    if (isActiveStatus(status)) {
      observedActivity = true;
      stableIdlePolls = 0;
    }

    if (!observedActivity) {
      observedActivity = await hasAssistantMessage(client, currentSessionID);
    }

    if (observedActivity && !isActiveStatus(status) && !resolution.pendingTransition) {
      const outcome = await inspectOutcome(client, currentSessionID);
      if (!outcome.hasAssistant) {
        stableIdlePolls = 0;
        await sleep(pollMs);
        continue;
      }
      if (outcome.error) {
        throw new Error(`session ${currentSessionID} failed: ${outcome.error}`);
      }
      stableIdlePolls += 1;
      if (stableIdlePolls >= REQUIRED_STABLE_IDLE_POLLS) {
        return currentSessionID;
      }
    } else {
      stableIdlePolls = 0;
    }

    await sleep(pollMs);
  }

  throw new Error(`timed out waiting for workflow rooted at ${rootSessionID}`);
}

function isActiveStatus(status: SessionStatusInfo | undefined) {
  return status?.type === "busy" || status?.type === "retry";
}

async function hasAssistantMessage(client: OpenCodeClient, sessionID: string) {
  const outcome = await inspectOutcome(client, sessionID);
  return outcome.hasAssistant;
}

async function inspectOutcome(client: OpenCodeClient, sessionID: string) {
  const messages = await client.sessionMessages(sessionID);
  const assistants = messages.filter(
    (message): message is MessageWithParts & { info: Extract<MessageWithParts["info"], { role: "assistant" }> } =>
      message.info.role === "assistant",
  );

  if (assistants.length === 0) {
    return { hasAssistant: false, error: undefined as string | undefined };
  }

  const last = assistants[assistants.length - 1];
  return {
    hasAssistant: true,
    error: readAssistantError(last),
  };
}

function readAssistantError(message: MessageWithParts & { info: { role: "assistant"; error?: unknown } }) {
  const error = message.info.error;
  if (!record(error)) return undefined;
  if (record(error.data) && typeof error.data.message === "string" && error.data.message.trim()) {
    return error.data.message;
  }
  if (typeof error.name === "string" && error.name.trim()) {
    return error.name;
  }
  return "assistant reported an unknown error";
}

async function readCompactionStateSafe(): Promise<CompactionState | undefined> {
  try {
    const text = await readText(compactionStateFile);
    return parseCompactionState(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function parseCompactionState(input: unknown): CompactionState | undefined {
  if (!record(input)) return undefined;
  const sessions = record(input.sessions) ? input.sessions : {};
  const groups = record(input.groups) ? input.groups : {};

  return {
    sessions: Object.fromEntries(
      Object.entries(sessions).map(([sessionID, value]) => [sessionID, parseManaged(value)]).filter((entry) => entry[1]),
    ) as Record<string, CompactionManaged>,
    groups: Object.fromEntries(
      Object.entries(groups).map(([groupID, value]) => [groupID, parseGroup(value)]).filter((entry) => entry[1]),
    ) as Record<string, CompactionGroup>,
  };
}

function parseManaged(input: unknown): CompactionManaged | undefined {
  if (!record(input)) return undefined;
  return {
    group_id: typeof input.group_id === "string" ? input.group_id : undefined,
    status: typeof input.status === "string" ? input.status : undefined,
    superseded_by_session_id:
      typeof input.superseded_by_session_id === "string" ? input.superseded_by_session_id : undefined,
    error: typeof input.error === "string" ? input.error : undefined,
  };
}

function parseGroup(input: unknown): CompactionGroup | undefined {
  if (!record(input)) return undefined;
  return {
    latest_session_id: typeof input.latest_session_id === "string" ? input.latest_session_id : undefined,
  };
}

function resolveCompaction(rootSessionID: string, state: CompactionState | undefined): CompactionResolution {
  if (!state) {
    return {
      currentSessionID: rootSessionID,
      pendingTransition: false,
    };
  }

  const seen = new Set<string>();
  let currentSessionID = rootSessionID;
  let pendingTransition = false;
  let failed: CompactionResolution["failed"];

  while (!seen.has(currentSessionID)) {
    seen.add(currentSessionID);
    const managed = state.sessions[currentSessionID];
    if (!managed) break;

    if (isPendingCompactionStatus(managed.status)) {
      pendingTransition = true;
    }
    if (!failed && managed.status === "failed") {
      failed = {
        sessionID: currentSessionID,
        error: managed.error,
      };
    }

    const direct = managed.superseded_by_session_id;
    if (direct && !seen.has(direct)) {
      currentSessionID = direct;
      continue;
    }

    const latest = managed.group_id ? state.groups[managed.group_id]?.latest_session_id : undefined;
    if (latest && latest !== currentSessionID && !seen.has(latest)) {
      currentSessionID = latest;
      continue;
    }

    break;
  }

  return {
    currentSessionID,
    pendingTransition,
    failed,
  };
}

function isPendingCompactionStatus(status: string | undefined) {
  return (
    status === "threshold_reached" ||
    status === "aborting" ||
    status === "aborted" ||
    status === "summarizing" ||
    status === "creating_continuation"
  );
}

function isErrno(err: unknown, code: string) {
  return record(err) && typeof err.code === "string" && err.code === code;
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}
