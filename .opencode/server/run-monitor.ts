import path from "node:path";
import {
  OpenCodeClient,
  readText,
  record,
  sleep,
  stateDir,
  type MessageWithParts,
  type SessionStatusInfo,
} from "./shared";

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

export type CompactionResolution = {
  currentSessionID: string;
  pendingTransition: boolean;
  failed?: {
    sessionID: string;
    error?: string;
  };
};

export type SessionCompletionResult = {
  finalSessionID: string;
  lastAssistantText?: string;
};

const compactionStateFile = path.join(stateDir, "compaction-state.json");
const REQUIRED_STABLE_IDLE_POLLS = 2;

export async function waitForSessionCompletion(
  client: OpenCodeClient,
  rootSessionID: string,
  input: {
    timeoutMs: number;
    pollMs: number;
    onSessionChange?: (sessionID: string) => void | Promise<void>;
  },
): Promise<SessionCompletionResult> {
  const deadline = Date.now() + input.timeoutMs;
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
      currentSessionID = resolution.currentSessionID;
      observedActivity = false;
      stableIdlePolls = 0;
      await input.onSessionChange?.(currentSessionID);
    }

    const statusMap = await client.sessionStatus().catch(() => ({}));
    const status = statusMap[currentSessionID];
    if (isActiveStatus(status)) {
      observedActivity = true;
      stableIdlePolls = 0;
    }

    if (!observedActivity) {
      observedActivity = (await inspectOutcome(client, currentSessionID)).hasAssistant;
    }

    if (observedActivity && !isActiveStatus(status) && !resolution.pendingTransition) {
      const outcome = await inspectOutcome(client, currentSessionID);
      if (!outcome.hasAssistant) {
        stableIdlePolls = 0;
        await sleep(input.pollMs);
        continue;
      }
      if (outcome.error) {
        throw new Error(`session ${currentSessionID} failed: ${outcome.error}`);
      }
      stableIdlePolls += 1;
      if (stableIdlePolls >= REQUIRED_STABLE_IDLE_POLLS) {
        return {
          finalSessionID: currentSessionID,
          lastAssistantText: outcome.lastAssistantText,
        };
      }
    } else {
      stableIdlePolls = 0;
    }

    await sleep(input.pollMs);
  }

  throw new Error(`timed out waiting for workflow rooted at ${rootSessionID}`);
}

export async function inspectOutcome(client: OpenCodeClient, sessionID: string) {
  const messages = await client.sessionMessages(sessionID);
  const assistants = messages.filter(
    (message): message is MessageWithParts & { info: Extract<MessageWithParts["info"], { role: "assistant" }> } =>
      message.info.role === "assistant",
  );

  if (assistants.length === 0) {
    return {
      hasAssistant: false,
      error: undefined as string | undefined,
      lastAssistantText: undefined as string | undefined,
    };
  }

  const last = assistants[assistants.length - 1];
  return {
    hasAssistant: true,
    error: readAssistantError(last),
    lastAssistantText: extractAssistantText(last),
  };
}

export async function readCompactionStateSafe(): Promise<CompactionState | undefined> {
  try {
    const text = await readText(compactionStateFile);
    return parseCompactionState(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export function resolveCompaction(rootSessionID: string, state: CompactionState | undefined): CompactionResolution {
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

function parseCompactionState(input: unknown): CompactionState | undefined {
  if (!record(input)) return undefined;
  const sessions = record(input.sessions) ? input.sessions : {};
  const groups = record(input.groups) ? input.groups : {};

  return {
    sessions: Object.fromEntries(
      Object.entries(sessions)
        .map(([sessionID, value]) => [sessionID, parseManaged(value)] as const)
        .filter((entry): entry is readonly [string, CompactionManaged] => Boolean(entry[1])),
    ),
    groups: Object.fromEntries(
      Object.entries(groups)
        .map(([groupID, value]) => [groupID, parseGroup(value)] as const)
        .filter((entry): entry is readonly [string, CompactionGroup] => Boolean(entry[1])),
    ),
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

function isPendingCompactionStatus(status: string | undefined) {
  return (
    status === "threshold_reached" ||
    status === "aborting" ||
    status === "aborted" ||
    status === "summarizing" ||
    status === "creating_continuation"
  );
}

function isActiveStatus(status: SessionStatusInfo | undefined) {
  return status?.type === "busy" || status?.type === "retry";
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

function extractAssistantText(message: MessageWithParts) {
  return message.parts
    .filter((part): part is Extract<MessageWithParts["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
