#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Options = {
  sessionID?: string;
  directory: string;
  json: boolean;
  help: boolean;
};

type SessionInfo = {
  id: string;
  projectID?: string;
  workspaceID?: string;
  directory?: string;
  parentID?: string;
  title?: string;
  version?: string;
  time?: {
    created?: number;
    updated?: number;
    compacting?: number;
    archived?: number;
  };
};

type ProjectInfo = {
  id: string;
  worktree: string;
  vcs?: string;
  time?: {
    created?: number;
    updated?: number;
    initialized?: number;
  };
};

type MessageInfo = {
  role: "user" | "assistant";
  model?: {
    providerID: string;
    modelID: string;
    variant?: string;
  };
  providerID?: string;
  modelID?: string;
  variant?: string;
  agent?: string;
};

type MessageWithParts = {
  info: MessageInfo;
};

type ProviderInfo = {
  id: string;
  models?: Record<string, RuntimeModel>;
};

type RuntimeModel = {
  id: string;
  providerID: string;
  api?: {
    id?: string;
    url?: string;
    npm?: string;
  };
  name?: string;
  family?: string;
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: RuntimeModalities;
    output?: RuntimeModalities;
    interleaved?: unknown;
  };
  cost?: {
    input?: number;
    output?: number;
    cache?: {
      read?: number;
      write?: number;
    };
    experimentalOver200K?: {
      input?: number;
      output?: number;
      cache?: {
        read?: number;
        write?: number;
      };
    };
  };
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  status?: string;
  release_date?: string;
};

type RuntimeModalities = {
  text?: boolean;
  audio?: boolean;
  image?: boolean;
  video?: boolean;
  pdf?: boolean;
};

type RuntimeInfoOutput = {
  session: Record<string, unknown>;
  workspace: Record<string, unknown>;
  model?: ReturnType<typeof modelInfo> | ReturnType<typeof modelRefInfo>;
};

const root = path.resolve(import.meta.dir, "../..");
const configEnvPath = path.join(root, ".opencode/config.env");

async function main() {
  loadConfigEnv();

  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const serverURL = resolveServerURL();
  const sessionID = options.sessionID || resolveEnvSessionID();
  const session = sessionID
    ? await request<SessionInfo>(serverURL, `/session/${encodeURIComponent(sessionID)}`)
    : await resolveLatestSession(serverURL, options.directory);
  const project = await request<ProjectInfo>(serverURL, "/project/current").catch(() => undefined);
  const messages = await request<MessageWithParts[]>(serverURL, `/session/${encodeURIComponent(session.id)}/message`).catch(() => []);
  const modelRef = resolveModelRef(messages);
  const model = modelRef ? await resolveModel(serverURL, modelRef.providerID, modelRef.modelID) : undefined;
  const now = new Date();
  const directory = session.directory || options.directory;
  const worktree = project?.worktree || gitTopLevel(directory) || directory;
  const vcsDir = project?.vcs === "git" || gitTopLevel(directory) ? gitDir(directory) : "";

  const info = {
    session: {
      currentDate: formatDate(now),
      currentDatetime: formatDateTime(now),
      id: session.id,
      title: session.title,
      parentID: session.parentID,
      serverURL,
      createdAt: formatTimestamp(session.time?.created),
      updatedAt: formatTimestamp(session.time?.updated),
      compactingAt: formatTimestamp(session.time?.compacting),
      archivedAt: formatTimestamp(session.time?.archived),
    },
    workspace: {
      directory,
      worktree,
      projectID: project?.id || session.projectID,
      projectWorktree: project?.worktree || "",
      projectVcs: project?.vcs || "",
      projectVcsDir: vcsDir,
      projectCreatedAt: formatTimestamp(project?.time?.created),
      projectInitializedAt: formatTimestamp(project?.time?.initialized),
    },
    model: model ? modelInfo(modelRef!, model) : modelRef ? modelRefInfo(modelRef) : undefined,
  };

  if (options.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log(renderMarkdown(info));
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    directory: process.cwd(),
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    switch (arg) {
      case "--session-id":
        options.sessionID = requireValue(arg, args[++i]);
        break;
      case "--directory":
        options.directory = path.resolve(requireValue(arg, args[++i]));
        break;
      case "--json":
        options.json = true;
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
  console.log(`Usage: bun .opencode/scripts/session-info.ts [options]

Options:
  --session-id <id>    Return information for a specific session.
  --directory <path>   Directory used when auto-selecting the latest session.
  --json               Emit structured JSON instead of Markdown.
  -h, --help           Show this help text.`);
}

function resolveEnvSessionID() {
  const sessionID = process.env.OPENCODE_SESSION_ID?.trim();
  if (!sessionID || sessionID === "unknown-session" || sessionID.includes("{{")) return;
  if (!sessionID.startsWith("ses_")) return;
  return sessionID;
}

async function resolveLatestSession(serverURL: string, directory: string) {
  const sessions = await request<SessionInfo[]>(
    serverURL,
    `/session?directory=${encodeURIComponent(directory)}&limit=1`,
  );
  const session = sessions[0];
  if (!session) throw new Error(`No OpenCode session found for directory: ${directory}`);
  return session;
}

async function request<T>(serverURL: string, route: string): Promise<T> {
  const response = await fetch(`${serverURL}${route}`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`OpenCode request failed: ${route} ${response.status} ${detail}`);
  }
  return await response.json();
}

function authHeaders() {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (password) {
    const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  return headers;
}

function resolveServerURL() {
  if (process.env.OPENCODE_SERVER_URL) return process.env.OPENCODE_SERVER_URL.replace(/\/$/, "");
  const host = process.env.OPENCODE_ASSISTANT_HOST || "127.0.0.1";
  const port = process.env.OPENCODE_ASSISTANT_PORT || "4096";
  return `http://${host}:${port}`;
}

function loadConfigEnv() {
  if (!existsSync(configEnvPath)) return;
  for (const rawLine of readFileSync(configEnvPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveModelRef(messages: MessageWithParts[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!.info;
    if (message.role === "user" && message.model) return message.model;
    if (message.role === "assistant" && message.providerID && message.modelID) {
      return {
        providerID: message.providerID,
        modelID: message.modelID,
        variant: message.variant,
      };
    }
  }
}

async function resolveModel(serverURL: string, providerID: string, modelID: string) {
  const providers = await request<{ all?: ProviderInfo[] }>(serverURL, "/provider");
  const provider = providers.all?.find((item) => item.id === providerID);
  return provider?.models?.[modelID];
}

function modelRefInfo(modelRef: { providerID: string; modelID: string; variant?: string }) {
  return {
    providerID: modelRef.providerID,
    id: modelRef.modelID,
    variant: modelRef.variant,
  };
}

function modelInfo(modelRef: { providerID: string; modelID: string; variant?: string }, model: RuntimeModel) {
  const over200k = model.cost?.experimentalOver200K;
  return {
    providerID: model.providerID || modelRef.providerID,
    id: model.id || modelRef.modelID,
    variant: modelRef.variant,
    name: model.name,
    family: model.family,
    status: model.status,
    releaseDate: model.release_date,
    apiID: model.api?.id,
    apiURL: model.api?.url,
    apiNpm: model.api?.npm,
    limitContext: model.limit?.context,
    limitInput: model.limit?.input,
    limitOutput: model.limit?.output,
    costInput: model.cost?.input,
    costOutput: model.cost?.output,
    costCacheRead: model.cost?.cache?.read,
    costCacheWrite: model.cost?.cache?.write,
    costOver200kInput: over200k?.input,
    costOver200kOutput: over200k?.output,
    costOver200kCacheRead: over200k?.cache?.read,
    costOver200kCacheWrite: over200k?.cache?.write,
    capabilityTemperature: model.capabilities?.temperature,
    capabilityReasoning: model.capabilities?.reasoning,
    capabilityAttachment: model.capabilities?.attachment,
    capabilityToolcall: model.capabilities?.toolcall,
    capabilityInterleaved: model.capabilities?.interleaved,
    capabilityInputText: model.capabilities?.input?.text,
    capabilityInputAudio: model.capabilities?.input?.audio,
    capabilityInputImage: model.capabilities?.input?.image,
    capabilityInputVideo: model.capabilities?.input?.video,
    capabilityInputPdf: model.capabilities?.input?.pdf,
    capabilityOutputText: model.capabilities?.output?.text,
    capabilityOutputAudio: model.capabilities?.output?.audio,
    capabilityOutputImage: model.capabilities?.output?.image,
    capabilityOutputVideo: model.capabilities?.output?.video,
    capabilityOutputPdf: model.capabilities?.output?.pdf,
  };
}

function gitTopLevel(directory: string) {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return "";
  return result.stdout.toString().trim();
}

function gitDir(directory: string) {
  const result = Bun.spawnSync(["git", "rev-parse", "--git-dir"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return "";
  const value = result.stdout.toString().trim();
  if (!value) return "";
  return path.isAbsolute(value) ? value : path.resolve(directory, value);
}

function renderMarkdown(info: RuntimeInfoOutput) {
  const model = info.model;
  return [
    "### Runtime Session Info",
    "",
    "## Session",
    "",
    line("Current date", info.session.currentDate),
    line("Current datetime", info.session.currentDatetime),
    line("Current session id", info.session.id),
    line("Current session title", info.session.title),
    line("Parent session id", info.session.parentID),
    line("Server URL", info.session.serverURL),
    line("Session created at", info.session.createdAt),
    line("Session updated at", info.session.updatedAt),
    line("Session compacting at", info.session.compactingAt),
    line("Session archived at", info.session.archivedAt),
    "",
    "## Workspace",
    "",
    line("Directory", info.workspace.directory),
    line("Worktree", info.workspace.worktree),
    line("Project id", info.workspace.projectID),
    line("Project worktree", info.workspace.projectWorktree),
    line("Project VCS", info.workspace.projectVcs),
    line("Project VCS dir", info.workspace.projectVcsDir),
    line("Project created at", info.workspace.projectCreatedAt),
    line("Project initialized at", info.workspace.projectInitializedAt),
    "",
    "## Model Identity",
    "",
    line("Provider id", model?.providerID),
    line("Model id", model?.id),
    line("Model variant", model?.variant),
    line("Model name", model?.name),
    line("Model family", model?.family),
    line("Model status", model?.status),
    line("Model release date", model?.releaseDate),
    line("Model API id", model?.apiID),
    line("Model API URL", model?.apiURL),
    line("Model API npm package", model?.apiNpm),
    "",
    "## Model Limits",
    "",
    line("Context limit", model?.limitContext),
    line("Input limit", model?.limitInput),
    line("Output limit", model?.limitOutput),
    "",
    "## Model Cost",
    "",
    line("Input cost", model?.costInput),
    line("Output cost", model?.costOutput),
    line("Cache read cost", model?.costCacheRead),
    line("Cache write cost", model?.costCacheWrite),
    line("Over-200k input cost", model?.costOver200kInput),
    line("Over-200k output cost", model?.costOver200kOutput),
    line("Over-200k cache read cost", model?.costOver200kCacheRead),
    line("Over-200k cache write cost", model?.costOver200kCacheWrite),
    "",
    "## Model Capabilities",
    "",
    line("Supports temperature", model?.capabilityTemperature),
    line("Supports reasoning", model?.capabilityReasoning),
    line("Supports attachments", model?.capabilityAttachment),
    line("Supports tool calls", model?.capabilityToolcall),
    line("Interleaved mode", model?.capabilityInterleaved),
    line("Input text", model?.capabilityInputText),
    line("Input audio", model?.capabilityInputAudio),
    line("Input image", model?.capabilityInputImage),
    line("Input video", model?.capabilityInputVideo),
    line("Input PDF", model?.capabilityInputPdf),
    line("Output text", model?.capabilityOutputText),
    line("Output audio", model?.capabilityOutputAudio),
    line("Output image", model?.capabilityOutputImage),
    line("Output video", model?.capabilityOutputVideo),
    line("Output PDF", model?.capabilityOutputPdf),
  ].join("\n");
}

function line(label: string, value: unknown) {
  return `- ${label}: \`${stringify(value)}\``;
}

function stringify(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatDate(value: Date) {
  return [String(value.getFullYear()), pad(value.getMonth() + 1), pad(value.getDate())].join("");
}

function formatDateTime(value: Date) {
  return [formatDate(value), pad(value.getHours()), pad(value.getMinutes()), pad(value.getSeconds())].join("");
}

function formatTimestamp(value?: number) {
  if (typeof value !== "number") return "";
  return formatDateTime(new Date(value));
}

await main();
