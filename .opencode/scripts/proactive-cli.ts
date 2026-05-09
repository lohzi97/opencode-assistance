#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProactiveService } from "../server/proactive.ts";
import { OpenCodeClient, record, root, type ModelRef } from "../server/shared.ts";

type AddPayload = {
  instructions: string;
  priority?: number;
  ttl_ms?: number;
  agent?: string;
  model?: ModelRef;
  context?: Record<string, unknown>;
  dedupe_key?: string;
  not_before?: number;
  source?: {
    type?: "trigger" | "manual" | "script" | "anchor" | "isolated" | "user-session";
    session_id?: string;
    run_id?: string;
  };
};

type EditPayload = Partial<{
  instructions: string;
  priority: number;
  ttl_ms: number;
  agent: string;
  model: ModelRef;
  context: Record<string, unknown>;
  dedupe_key: string;
  not_before: number;
}>;

if (import.meta.main) {
  main().catch((err) => {
    console.error(errorMessage(err));
    process.exit(1);
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const service = new ProactiveService(new OpenCodeClient());

  if (command === "get-all-tasks") {
    print(await service.getAllTasks());
    return;
  }

  if (command === "run-task-now") {
    const taskID = requireValue(rest[0], "task id");
    print(await service.runTaskNow(taskID, sourceFromEnv("manual")));
    return;
  }

  if (command === "remove-queued-task") {
    const queueID = requireValue(rest[0], "queue id");
    print(await service.removeQueuedItem(queueID));
    return;
  }

  if (command === "add-task-to-queue") {
    const payload = parseAddPayload(await readJsonPayload(rest));
    print(
      await service.enqueueAdHoc({
        ...payload,
        source: mergeSource(payload.source),
      }),
    );
    return;
  }

  if (command === "edit-queued-task") {
    const queueID = requireValue(rest[0], "queue id");
    const payload = parseEditPayload(await readJsonPayload(rest.slice(1)));
    print(await service.editQueuedItem(queueID, payload));
    return;
  }

  throw new Error(`unknown proactive command: ${command}`);
}

function printUsage() {
  console.log(`Usage:
  bun .opencode/scripts/proactive-cli.ts get-all-tasks
  bun .opencode/scripts/proactive-cli.ts run-task-now <task-id>
  bun .opencode/scripts/proactive-cli.ts remove-queued-task <queue-id>
  bun .opencode/scripts/proactive-cli.ts add-task-to-queue [--file path | --stdin]
  bun .opencode/scripts/proactive-cli.ts edit-queued-task <queue-id> [--file path | --stdin]`);
}

async function readJsonPayload(args: string[]) {
  if (args[0] === "--file") {
    const file = requireValue(args[1], "file path");
    return JSON.parse(await readFile(resolvePath(file), "utf8"));
  }
  if (args[0] && args[0] !== "--stdin") {
    return JSON.parse(await readFile(resolvePath(args[0]), "utf8"));
  }
  const text = await Bun.stdin.text();
  if (!text.trim()) {
    throw new Error("expected JSON payload via stdin or file");
  }
  return JSON.parse(text);
}

function parseAddPayload(input: unknown): AddPayload {
  if (!record(input) || typeof input.instructions !== "string") {
    throw new Error("payload must include string field 'instructions'");
  }
  return {
    instructions: input.instructions,
    priority: asNumber(input.priority),
    ttl_ms: asNumber(input.ttl_ms),
    agent: asString(input.agent),
    model: parseModel(input.model),
    context: record(input.context) ? input.context : undefined,
    dedupe_key: asString(input.dedupe_key),
    not_before: asNumber(input.not_before),
    source: record(input.source)
      ? {
          type: asSourceType(input.source.type),
          session_id: asString(input.source.session_id),
          run_id: asString(input.source.run_id),
        }
      : undefined,
  };
}

function parseEditPayload(input: unknown): EditPayload {
  if (!record(input)) {
    throw new Error("edit payload must be a JSON object");
  }
  return {
    instructions: asString(input.instructions),
    priority: asNumber(input.priority),
    ttl_ms: asNumber(input.ttl_ms),
    agent: asString(input.agent),
    model: parseModel(input.model),
    context: record(input.context) ? input.context : undefined,
    dedupe_key: asString(input.dedupe_key),
    not_before: asNumber(input.not_before),
  };
}

function mergeSource(source: AddPayload["source"]) {
  const fallback = sourceFromEnv(source?.session_id ? "user-session" : "script");
  return {
    type: source?.type ?? fallback.type,
    session_id: source?.session_id ?? fallback.session_id,
    run_id: source?.run_id ?? fallback.run_id,
  };
}

function sourceFromEnv(fallbackType: "manual" | "script" | "user-session") {
  const sessionID = process.env.OPENCODE_SESSION_ID;
  const runID = process.env.OPENCODE_PROACTIVE_RUN_ID;
  const activeMode = process.env.OPENCODE_PROACTIVE_MODE;
  const proactiveSourceType = activeMode === "anchor-session" ? "anchor" : activeMode === "isolated-session" ? "isolated" : undefined;
  return {
    type: proactiveSourceType ?? (sessionID ? "user-session" : fallbackType),
    session_id: sessionID,
    run_id: runID,
  } as const;
}

function parseModel(input: unknown) {
  if (!record(input)) return undefined;
  if (typeof input.providerID !== "string" || typeof input.modelID !== "string") return undefined;
  return {
    providerID: input.providerID,
    modelID: input.modelID,
    variant: asString(input.variant),
  } satisfies ModelRef;
}

function asSourceType(input: unknown) {
  return input === "trigger" ||
    input === "manual" ||
    input === "script" ||
    input === "anchor" ||
    input === "isolated" ||
    input === "user-session"
    ? input
    : undefined;
}

function resolvePath(value: string) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function requireValue(input: string | undefined, label: string) {
  if (!input) throw new Error(`missing ${label}`);
  return input;
}

function asString(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function asNumber(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}
