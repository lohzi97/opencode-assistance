#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { stdin as processStdin, stdout as processStdout, stderr as processStderr } from "node:process";

type Env = Record<string, string | undefined>;
type CliStdin = {
  text?: () => Promise<string>;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
};

type CliIO = {
  stdout: Pick<typeof processStdout, "write">;
  stderr: Pick<typeof processStderr, "write">;
  stdin: CliStdin;
  env: Env;
  fetch: typeof fetch;
};

type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

type CommandContext = {
  args: ParsedArgs;
  json: boolean;
  client: CollabHttpClient;
  io: CliIO;
};

type RequestOptions = {
  method?: string;
  body?: Record<string, unknown>;
  search?: Record<string, string>;
};

export const DEFAULT_AGENT_COLLAB_URL = "http://127.0.0.1:9100";

const BOOLEAN_FLAGS = new Set(["all", "closed", "paused", "hard", "json", "password-stdin", "stdin"]);

class CliError extends Error {
  constructor(
    message: string,
    readonly status = 1,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

class CollabHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async request(path: string, options: RequestOptions = {}) {
    const url = new URL(path, ensureTrailingSlash(this.baseUrl));
    for (const [key, value] of Object.entries(options.search ?? {})) url.searchParams.set(key, value);

    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers: options.body ? { "content-type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await readResponseBody(response);
    if (!response.ok) {
      const message = responseErrorMessage(data) ?? `${response.status} ${response.statusText}`.trim();
      throw new CliError(message, response.status, data);
    }
    return data;
  }
}

export function resolveBaseUrl(env: Env = process.env) {
  return (env.AGENT_COLLAB_URL?.trim() || DEFAULT_AGENT_COLLAB_URL).replace(/\/+$/, "");
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq >= 0 ? eq : undefined);
    if (!name) throw new CliError("empty flag is not supported");
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = eq >= 0 ? arg.slice(eq + 1) : true;
      continue;
    }
    if (eq >= 0) {
      flags[name] = arg.slice(eq + 1);
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new CliError(`--${name} requires a value`);
    flags[name] = value;
    index += 1;
  }

  return { positionals, flags };
}

export async function runAgentCollabCli(argv: string[], io: Partial<CliIO> = {}) {
  const fullIO: CliIO = {
    stdout: io.stdout ?? processStdout,
    stderr: io.stderr ?? processStderr,
    stdin: io.stdin ?? processStdin,
    env: io.env ?? process.env,
    fetch: io.fetch ?? fetch,
  };

  try {
    const args = parseArgs(argv);
    const json = Boolean(args.flags.json);
    const client = new CollabHttpClient(resolveBaseUrl(fullIO.env), fullIO.fetch);
    const result = await dispatch({ args, json, client, io: fullIO });
    writeOutput(fullIO.stdout, json ? JSON.stringify(result, null, 2) : formatHuman(args.positionals, result));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const data = error instanceof CliError ? error.data : undefined;
    const json = argv.includes("--json");
    writeOutput(fullIO.stderr, json ? JSON.stringify({ error: message, details: data }, null, 2) : `Error: ${message}`);
    return 1;
  }
}

async function dispatch(context: CommandContext) {
  const [group, action, subaction] = context.args.positionals;
  if (group === "room" && action === "create") return createRoom(context);
  if (group === "room" && action === "status") return roomStatus(context);
  if (group === "room" && action === "list") return roomList(context);
  if (group === "room" && action === "close") return closeRoom(context);
  if (group === "pause") return pauseRoom(context);
  if (group === "resume") return resumeRoom(context);
  if (group === "member" && action === "add") return memberAdd(context);
  if (group === "member" && action === "remove") return memberRemove(context);
  if (group === "join") return joinRoom(context);
  if (group === "leave") return leaveRoom(context);
  if (group === "spawn") return spawnMember(context);
  if (group === "room" && action === "public-message" && subaction === "set") return setPublicMessage(context);
  if (group === "room" && action === "public-message" && subaction === "clear") return clearPublicMessage(context);
  if (group === "send") return sendMessage(context);
  if (group === "ask") return askQuestion(context);
  if (group === "answer") return answerQuestion(context);
  if (group === "messages") return listMessages(context);
  throw new CliError("unknown command");
}

function createRoom({ args, client }: CommandContext) {
  return client.request("/room", {
    method: "POST",
    body: compact({
      name: required(args, "name"),
      session_id: required(args, "session"),
      from: required(args, "from"),
      project_dir: optional(args, "project-dir"),
    }),
  });
}

function roomStatus({ args, client }: CommandContext) {
  const search = compact({ failure_limit: optional(args, "failure-limit") }) as Record<string, string>;
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/status`, Object.keys(search).length > 0 ? { search } : undefined);
}

function roomList({ args, client }: CommandContext) {
  const state = args.flags.all ? "all" : args.flags.closed ? "closed" : args.flags.paused ? "paused" : undefined;
  const search: Record<string, string> = {};
  if (state) search.state = state;
  if (typeof args.flags.before === "string") search.before = args.flags.before;
  if (typeof args.flags.limit === "string") search.limit = args.flags.limit;
  return client.request("/room/list", Object.keys(search).length > 0 ? { search } : undefined);
}

async function pauseRoom({ args, client, io }: CommandContext) {
  const password = await readPassword(args, io);
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/pause`, {
    method: "POST",
    body: { password },
  });
}

async function resumeRoom({ args, client, io }: CommandContext) {
  const password = await readPassword(args, io);
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/resume`, {
    method: "POST",
    body: { password },
  });
}

function closeRoom({ args, client }: CommandContext) {
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}`, {
    method: "DELETE",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
    },
  });
}

function memberAdd({ args, client }: CommandContext) {
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/member`, {
    method: "POST",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
      target_session_id: required(args, "target-session"),
      name: required(args, "name"),
      role: optional(args, "role") ?? "member",
    },
  });
}

function memberRemove({ args, client }: CommandContext) {
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/member`, {
    method: "DELETE",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
      target: required(args, "target"),
    },
  });
}

async function joinRoom({ args, client, io }: CommandContext) {
  const password = await readPassword(args, io);
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/join`, {
    method: "POST",
    body: {
      session_id: required(args, "session"),
      name: required(args, "name"),
      password,
    },
  });
}

function leaveRoom({ args, client }: CommandContext) {
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/leave`, {
    method: "DELETE",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
    },
  });
}

function spawnMember({ args, client }: CommandContext) {
  const provider = optional(args, "provider");
  const model = optional(args, "model");
  const variant = optional(args, "variant");
  if ((provider && !model) || (!provider && model)) throw new CliError("--provider and --model must be supplied together");
  if (variant && (!provider || !model)) throw new CliError("--variant requires --provider and --model");

  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/spawn`, {
    method: "POST",
    body: compact({
      session_id: required(args, "session"),
      from: required(args, "from"),
      name: required(args, "name"),
      role: optional(args, "role") ?? "member",
      agent: optional(args, "agent"),
      model: provider && model ? compact({ providerID: provider, modelID: model, variant }) : undefined,
      directory: optional(args, "dir"),
      initial_prompt: optional(args, "initial-prompt"),
    }),
  });
}

async function setPublicMessage({ args, client, io }: CommandContext) {
  const body = await readBody(args, io, { text: "text", file: "file", stdin: "stdin" });
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/public-message`, {
    method: "POST",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
      body,
    },
  });
}

function clearPublicMessage({ args, client }: CommandContext) {
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/public-message`, {
    method: "DELETE",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
    },
  });
}

async function sendMessage({ args, client, io }: CommandContext) {
  const body = await readBody(args, io, { text: "body", file: "body-file", stdinTextValue: "-" });
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/message`, {
    method: "POST",
    body: compact({
      session_id: required(args, "session"),
      from: required(args, "from"),
      body,
      kind: optional(args, "kind"),
      hard: args.flags.hard ? true : undefined,
    }),
  });
}

async function askQuestion({ args, client, io }: CommandContext) {
  const body = await readBody(args, io, { text: "body", stdinTextValue: "-" });
  const options = optional(args, "options")
    ?.split(",")
    .map((option) => option.trim())
    .filter(Boolean);
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/ask`, {
    method: "POST",
    body: compact({
      session_id: required(args, "session"),
      from: required(args, "from"),
      body,
      options: options && options.length > 0 ? options : undefined,
    }),
  });
}

async function answerQuestion({ args, client, io }: CommandContext) {
  const body = await readBody(args, io, { text: "body", stdinTextValue: "-" });
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/answer`, {
    method: "POST",
    body: {
      session_id: required(args, "session"),
      from: required(args, "from"),
      parent: required(args, "parent"),
      body,
    },
  });
}

function listMessages({ args, client }: CommandContext) {
  return client.request(`/room/${encodeURIComponent(required(args, "room"))}/messages`, {
    search: compact({
      session_id: optional(args, "session"),
      from: optional(args, "member"),
      since: optional(args, "since"),
      limit: optional(args, "limit"),
    }) as Record<string, string>,
  });
}

export async function readBody(
  args: ParsedArgs,
  io: Pick<CliIO, "stdin">,
  names: { text?: string; file?: string; stdin?: string; stdinTextValue?: string },
) {
  const text = names.text ? optional(args, names.text) : undefined;
  const file = names.file ? optional(args, names.file) : undefined;
  const explicitStdin = names.stdin ? Boolean(args.flags[names.stdin]) : false;
  const textMeansStdin = text !== undefined && names.stdinTextValue !== undefined && text === names.stdinTextValue;
  const selected = [text !== undefined && !textMeansStdin, file !== undefined, explicitStdin || textMeansStdin].filter(Boolean).length;
  if (selected !== 1) throw new CliError("provide exactly one body input source");
  if (text !== undefined && !textMeansStdin) return text;
  if (file !== undefined) return readFile(file, "utf8");
  return readStdinText(io.stdin);
}

async function readPassword(args: ParsedArgs, io: CliIO) {
  const inline = optional(args, "password");
  const fromStdin = Boolean(args.flags["password-stdin"]);
  if (inline && fromStdin) throw new CliError("use only one of --password or --password-stdin");
  if (inline) return inline;
  if (fromStdin) return (await readStdinText(io.stdin)).replace(/[\r\n]+$/, "");
  throw new CliError("--password or --password-stdin is required");
}

async function readStdinText(stdin: CliStdin) {
  if (stdin.text) return stdin.text();
  if (!stdin[Symbol.asyncIterator]) throw new CliError("stdin is not readable");

  const chunks: string[] = [];
  for await (const chunk of stdin as AsyncIterable<Buffer | string>) chunks.push(String(chunk));
  return chunks.join("");
}

function required(args: ParsedArgs, name: string) {
  const value = optional(args, name);
  if (!value) throw new CliError(`--${name} is required`);
  return value;
}

function optional(args: ParsedArgs, name: string) {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

function compact(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function responseErrorMessage(data: unknown) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") return data.error;
  if (typeof data === "string") return data;
  return undefined;
}

function writeOutput(stream: Pick<typeof processStdout, "write">, text: string) {
  stream.write(`${text}\n`);
}

function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function formatHuman(positionals: string[], result: unknown) {
  const [group, action] = positionals;
  if (group === "room" && action === "create" && isRecord(result)) {
    return [
      "Room created.",
      `Room: ${String(result.name)}`,
      `Founder: ${String((result.founder as { name?: unknown } | undefined)?.name ?? "unknown")}`,
      `Planner password: ${String(result.planner_password)}`,
      "Warning: this planner password will not be shown again.",
    ].join("\n");
  }
  if (group === "room" && action === "close" && isRecord(result)) {
    return ["Room closed.", `Room: ${String(result.name ?? result.room_id ?? "unknown")}`, `State: ${String(result.state ?? "closed")}`].join("\n");
  }
  if (isRecord(result) && typeof result.name === "string") return `Room ${result.name} is ${String(result.state ?? "unknown")}.`;
  if (isRecord(result) && Array.isArray(result.rooms)) return result.rooms.map((room) => formatRoomLine(room)).join("\n") || "No rooms.";
  return JSON.stringify(result, null, 2);
}

function formatRoomLine(room: unknown) {
  if (!isRecord(room)) return String(room);
  return `${String(room.name ?? room.room_id)} (${String(room.state ?? "unknown")})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

if (import.meta.main) {
  const exitCode = await runAgentCollabCli(Bun.argv.slice(2));
  process.exit(exitCode);
}
