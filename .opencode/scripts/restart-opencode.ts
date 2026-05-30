#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type Options = {
  sessionID?: string;
  reason?: string;
  help: boolean;
};

type RestartRecord = {
  request_id: string;
  session_id: string;
  status: "starting" | "completed" | "failed";
  requested_at: string;
  completed_at?: string;
  server_url: string;
  reason?: string;
  model?: ModelRef;
  helper_log_path?: string;
  error?: string;
};

type ModelRef = {
  providerID: string;
  modelID: string;
  variant?: string;
};

type MessageWithInfo = {
  info?: {
    role?: string;
    model?: ModelRef;
    providerID?: string;
    modelID?: string;
    variant?: string;
  };
};

const root = path.resolve(import.meta.dir, "../..");
const stateDir = path.join(root, ".opencode/server/state/restart");
const helperLogPath = process.env.OPENCODE_RESTART_LOG_PATH;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sessionID = await resolveSessionID(options.sessionID);
  const requestID = timestamp();
  const requestFile = path.join(stateDir, `request-${requestID}.json`);
  const serverURL = resolveServerURL();
  const model = await resolveLastModel(serverURL, sessionID);

  const record: RestartRecord = {
    request_id: requestID,
    session_id: sessionID,
    status: "starting",
    requested_at: requestID,
    server_url: serverURL,
    reason: options.reason,
    model,
    helper_log_path: helperLogPath,
  };

  await mkdir(stateDir, { recursive: true });
  await writeRecord(requestFile, record);

  try {
    runScript("stop.sh");
    runScript("start.sh", ["--no-webui"]);
    await sendCompletionPrompt({
      serverURL,
      sessionID,
      reason: options.reason,
      model,
    });

    record.status = "completed";
    record.completed_at = timestamp();
    await writeRecord(requestFile, record);
  } catch (error) {
    record.status = "failed";
    record.completed_at = timestamp();
    record.error = formatError(error);
    await writeRecord(requestFile, record);
    throw error;
  }
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    switch (arg) {
      case "--session-id":
        options.sessionID = requireValue(arg, args[++i]);
        break;
      case "--reason":
        options.reason = requireValue(arg, args[++i]);
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(flag: string, value?: string) {
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function printHelp() {
  console.log(`Usage: bun .opencode/scripts/restart-opencode.ts [options]

Options:
  --session-id <id>       Session to notify after restart. Required.
  --reason <text>         Optional restart reason included in the follow-up prompt.
  -h, --help              Show this help text.`);
}

async function resolveSessionID(input?: string) {
  if (!input) {
    throw new Error("Missing required --session-id for detached restart");
  }
  if (!input.startsWith("ses")) {
    throw new Error(`Invalid --session-id: ${input}`);
  }
  return input;
}

function resolveServerURL() {
  if (process.env.OPENCODE_SERVER_URL) return process.env.OPENCODE_SERVER_URL.replace(/\/$/, "");
  const host = process.env.OPENCODE_ASSISTANT_HOST || "127.0.0.1";
  const port = process.env.OPENCODE_ASSISTANT_PORT || "4096";
  return `http://${host}:${port}`;
}

function runScript(script: string, args: string[] = []) {
  const proc = Bun.spawnSync(["bash", path.join(root, script), ...args], {
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    const stdout = proc.stdout.toString().trim();
    const detail = stderr || stdout || `exit code ${proc.exitCode}`;
    throw new Error(`${script} failed: ${detail}`);
  }
}

async function sendCompletionPrompt(input: {
  serverURL: string;
  sessionID: string;
  reason?: string;
  model?: ModelRef;
}) {
  const lines = [
    "The requested OpenCode restart has completed successfully.",
    input.reason ? `Restart reason for context: ${input.reason}` : undefined,
  ].filter(Boolean);

  const headers = authHeaders({
    "content-type": "application/json",
  });

  const response = await fetch(`${input.serverURL}/session/${input.sessionID}/prompt_async`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model
        ? {
            providerID: input.model.providerID,
            modelID: input.model.modelID,
          }
        : undefined,
      variant: input.model?.variant,
      parts: [
        {
          type: "text",
          text: lines.join("\n\n"),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to post restart completion prompt: ${response.status} ${detail}`);
  }
}

async function resolveLastModel(serverURL: string, sessionID: string): Promise<ModelRef | undefined> {
  const messages = await request<MessageWithInfo[]>(serverURL, `/session/${encodeURIComponent(sessionID)}/message`).catch(
    (error) => {
      console.warn(`Unable to inspect session model before restart: ${formatError(error)}`);
      return [];
    },
  );

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const info = messages[i]?.info;
    if (!info) continue;
    if (info.role === "user" && info.model?.providerID && info.model.modelID) return info.model;
    if (info.role === "assistant" && info.providerID && info.modelID) {
      return {
        providerID: info.providerID,
        modelID: info.modelID,
        variant: info.variant,
      };
    }
  }
}

async function request<T>(serverURL: string, route: string): Promise<T> {
  const response = await fetch(`${serverURL}${route}`, {
    headers: authHeaders({ accept: "application/json" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenCode request failed: ${route} ${response.status} ${detail}`);
  }
  return await response.json();
}

function authHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (password) {
    headers.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  }
  return headers;
}

async function writeRecord(filePath: string, record: RestartRecord) {
  await writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf8");
}

function timestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

await main();
