import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export type ModelRef = {
  providerID: string;
  modelID: string;
  variant?: string;
};

export type SessionStatusInfo =
  | {
      type: "idle";
    }
  | {
      type: "busy";
    }
  | {
      type: "retry";
      attempt: number;
      message: string;
      next: number;
    };

export type SessionInfo = {
  id: string;
  parentID?: string;
  title: string;
  directory: string;
  time: {
    created: number;
    updated: number;
    compacting?: number;
    archived?: number;
  };
};

export type UserMessageInfo = {
  id: string;
  sessionID: string;
  role: "user";
  time: {
    created: number;
  };
  agent?: string;
  model?: ModelRef;
};

export type AssistantError = {
  name?: string;
  data?: {
    message?: string;
  };
};

export type AssistantTokens = {
  total?: number;
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
};

export type AssistantMessageInfo = {
  id: string;
  sessionID: string;
  role: "assistant";
  time: {
    created: number;
    completed?: number;
  };
  error?: AssistantError;
  parentID: string;
  modelID: string;
  providerID: string;
  agent: string;
  summary?: boolean;
  cost: number;
  tokens: AssistantTokens;
  finish?: string;
  variant?: string;
};

export type MessageInfo = UserMessageInfo | AssistantMessageInfo;

export type TextPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
};

export type ReasoningPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
};

export type FilePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
};

export type ToolPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state:
    | {
        status: "pending";
        input: Record<string, unknown>;
        raw: string;
      }
    | {
        status: "running";
        input: Record<string, unknown>;
        title?: string;
        metadata?: Record<string, unknown>;
        time: {
          start: number;
        };
      }
    | {
        status: "completed";
        input: Record<string, unknown>;
        output: string;
        title: string;
        metadata: Record<string, unknown>;
        time: {
          start: number;
          end: number;
          compacted?: number;
        };
        attachments?: FilePart[];
      }
    | {
        status: "error";
        input: Record<string, unknown>;
        error: string;
        metadata?: Record<string, unknown>;
        time: {
          start: number;
          end: number;
        };
      };
};

export type StepFinishPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: AssistantTokens;
};

export type PatchPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "patch";
  hash: string;
  files: string[];
};

export type CompactionPart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "compaction";
  auto: boolean;
  overflow?: boolean;
  tail_start_id?: string;
};

export type MessagePart =
  | TextPart
  | ReasoningPart
  | FilePart
  | ToolPart
  | StepFinishPart
  | PatchPart
  | CompactionPart
  | {
      id: string;
      sessionID: string;
      messageID: string;
      type: string;
      [key: string]: unknown;
    };

export type MessageWithParts = {
  info: MessageInfo;
  parts: MessagePart[];
};

export type ProviderModelInfo = {
  id: string;
  limit?: {
    context: number;
    input?: number;
    output: number;
  };
};

export type ProviderInfo = {
  id: string;
  models: Record<string, ProviderModelInfo>;
};

export type ProviderListResult = {
  all: ProviderInfo[];
  default: Record<string, string>;
  connected: string[];
};

export type GlobalEventEnvelope = {
  directory?: string;
  project?: string;
  workspace?: string;
  payload?: {
    type?: string;
    properties?: Record<string, unknown>;
    syncEvent?: {
      type?: string;
      data?: Record<string, unknown>;
    };
  };
};

export type BusEventPayload = {
  type: string;
  properties: Record<string, unknown>;
};

export const root = path.resolve(import.meta.dir, "../..");
export const serverDir = path.resolve(root, ".opencode/server");
export const stateDir = path.join(serverDir, "state");
const host = process.env.OPENCODE_ASSISTANT_HOST ?? "127.0.0.1";
const port = process.env.OPENCODE_ASSISTANT_PORT ?? "4096";
const base = `http://${host}:${port}`;
const auth = process.env.OPENCODE_SERVER_PASSWORD
  ? `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME ?? "opencode"}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
  : undefined;

export class OpenCodeClient {
  async health() {
    for (let i = 0; i < 30; i++) {
      try {
        await this.req("/global/health");
        return;
      } catch {
        await sleep(1_000);
      }
    }
    throw new Error(`opencode server not reachable at ${base}`);
  }

  async createSession(title: string) {
    return await this.req<SessionInfo>("/session", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  }

  async updateSession(
    sessionID: string,
    body: {
      title?: string;
      time?: {
        archived?: number;
      };
    },
  ) {
    return await this.req<SessionInfo>(`/session/${sessionID}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async deleteSession(sessionID: string) {
    return await this.req<boolean>(`/session/${sessionID}`, {
      method: "DELETE",
    });
  }

  async getSession(sessionID: string) {
    return await this.req<SessionInfo>(`/session/${sessionID}`);
  }

  async sessionStatus() {
    return await this.req<Record<string, SessionStatusInfo>>("/session/status");
  }

  async sessionMessages(sessionID: string) {
    return await this.req<MessageWithParts[]>(`/session/${sessionID}/message`);
  }

  async prompt(
    sessionID: string,
    body: {
      agent?: string;
      model?: ModelRef;
      variant?: string;
      system?: string;
      parts: Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "file";
            mime: string;
            filename?: string;
            url: string;
          }
      >;
    },
  ) {
    return await this.req<MessageWithParts>(`/session/${sessionID}/message`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        model: body.model
          ? {
              providerID: body.model.providerID,
              modelID: body.model.modelID,
            }
          : undefined,
        variant: body.variant ?? body.model?.variant,
      }),
    });
  }

  async promptAsync(
    sessionID: string,
    body: {
      agent?: string;
      model?: ModelRef;
      variant?: string;
      system?: string;
      parts: Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "file";
            mime: string;
            filename?: string;
            url: string;
          }
      >;
    },
  ) {
    await this.req<void>(`/session/${sessionID}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        model: body.model
          ? {
              providerID: body.model.providerID,
              modelID: body.model.modelID,
            }
          : undefined,
        variant: body.variant ?? body.model?.variant,
      }),
      expect: 204,
    });
  }

  async command(
    sessionID: string,
    body: {
      agent?: string;
      model?: ModelRef;
      variant?: string;
      command: string;
      arguments: string;
    },
  ) {
    return await this.req<MessageWithParts>(`/session/${sessionID}/command`, {
      method: "POST",
      body: JSON.stringify({
        agent: body.agent,
        model: body.model
          ? `${body.model.providerID}/${body.model.modelID}`
          : undefined,
        variant: body.variant ?? body.model?.variant,
        command: body.command,
        arguments: body.arguments,
      }),
    });
  }

  async abortSession(sessionID: string) {
    return await this.req<boolean>(`/session/${sessionID}/abort`, {
      method: "POST",
    });
  }

  async providers() {
    return await this.req<ProviderListResult>("/provider");
  }

  async log(level: "info" | "warn" | "error" | "debug", message: string, extra?: Record<string, unknown>) {
    try {
      await this.req<boolean>("/log", {
        method: "POST",
        body: JSON.stringify({
          service: "opencode-assistant-worker",
          level,
          message,
          extra,
        }),
      });
    } catch {
      // ignore logging failures
    }
  }

  async req<T = unknown>(
    url: string,
    init: RequestInit & { expect?: number } = {},
  ) {
    const res = await fetch(`${base}${url}`, {
      ...init,
      headers: {
        ...jsonHeaders(),
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok && res.status !== init.expect) {
      throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
    }
    if (init.expect === 204 || res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }
}

export async function ensureStateDir() {
  await mkdir(stateDir, { recursive: true });
}

export async function writeJsonFile(filePath: string, data: unknown) {
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
}

export async function readText(filePath: string) {
  return await readFile(filePath, "utf8");
}

export async function readJsonc<T>(
  filePath: string,
  parse: (input: unknown) => T,
  fallback: T,
) {
  try {
    const text = await readFile(filePath, "utf8");
    return parse(parseJsonc(text));
  } catch {
    return fallback;
  }
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}

export async function listenGlobalEvents(input: {
  onEvent: (event: GlobalEventEnvelope) => void | Promise<void>;
}) {
  while (true) {
    try {
      const res = await fetch(`${base}/global/event`, {
        headers: authHeaders(),
      });
      if (!res.ok || !res.body) {
        throw new Error(`event stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const out = await reader.read();
        if (out.done) break;
        buffer += decoder.decode(out.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = parseSseFrame(frame);
          if (!event) continue;
          void Promise.resolve(input.onEvent(event)).catch((err) => {
            console.error("global event handler failed", err);
          });
        }
      }
    } catch (err) {
      console.error("global event reconnect", err);
      await sleep(2_000);
    }
  }
}

export function unwrapBusEvent(envelope: GlobalEventEnvelope): BusEventPayload | undefined {
  if (!record(envelope) || !record(envelope.payload)) return undefined;
  if (envelope.payload.type === "sync") return undefined;
  if (typeof envelope.payload.type !== "string") return undefined;
  if (!record(envelope.payload.properties)) return undefined;
  return {
    type: envelope.payload.type,
    properties: envelope.payload.properties,
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}

export function collapse(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function iso(value: number) {
  return new Date(value).toISOString();
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSseFrame(frame: string) {
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trim());
    }
  }
  if (data.length === 0) return undefined;
  try {
    return JSON.parse(data.join("\n")) as GlobalEventEnvelope;
  } catch {
    return undefined;
  }
}

function authHeaders() {
  return auth ? { authorization: auth } : {};
}

function jsonHeaders() {
  return {
    "content-type": "application/json",
    ...authHeaders(),
  };
}

function stripComments(text: string) {
  let out = "";
  let str = false;
  let esc = false;
  let line = false;
  let block = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (line) {
      if (ch === "\n") {
        line = false;
        out += ch;
      }
      continue;
    }

    if (block) {
      if (ch === "*" && next === "/") {
        block = false;
        i++;
      }
      continue;
    }

    if (str) {
      out += ch;
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        str = false;
      }
      continue;
    }

    if (ch === '"') {
      str = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      line = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      block = true;
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

function stripTrailingCommas(text: string) {
  let out = "";
  let str = false;
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (str) {
      out += ch;
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') {
        str = false;
      }
      continue;
    }

    if (ch === '"') {
      str = true;
      out += ch;
      continue;
    }

    if (ch !== ",") {
      out += ch;
      continue;
    }

    let j = i + 1;
    while (j < text.length && /\s/.test(text[j])) {
      j++;
    }
    if (text[j] === "]" || text[j] === "}") {
      continue;
    }
    out += ch;
  }

  return out;
}
