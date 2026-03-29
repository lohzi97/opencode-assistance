/**
 * Export Session Plugin
 *
 * Automatically exports OpenCode sessions to markdown files when sessions become idle
 * or when they are compacted. The exported files include:
 * - YAML frontmatter with session metadata (title, ID, timestamps, export reason)
 * - Full conversation history with user and assistant messages
 * - Optional details: thinking blocks, tool inputs/outputs, assistant metadata
 *
 * Setup Instructions:
 * 1. Create a config file at `.opencode/export-session.jsonc` in your project root
 * 2. Specify the export directory where session markdown files will be saved
 * 3. Customize export options (idle timeout, include tool details, etc.)
 *
 * Configuration File Location:
 * `.opencode/export-session.jsonc` in your project root
 *
 * Example Configuration:
 * ```jsonc
 * {
 *   // Enable/disable the plugin (optional, defaults to true)
 *   "enabled": true,
 *   // Export when the session becomes idle (optional, defaults to true)
 *   "export_when_idle": true,
 *   // Export when the session is compacted (optional, defaults to true)
 *   "export_when_compact": true,
 *   // Directory where exported markdown files will be saved (required if enabled)
 *   "export_dir": "sessions",
 *   // Time to wait (ms) after session goes idle before exporting (optional, defaults to 30 minutes)
 *   "idle_wait_ms": 1800000,
 *   // Include assistant thinking/reasoning blocks (optional, defaults to true)
 *   "thinking": true,
 *   // Include detailed tool input/output (optional, defaults to true)
 *   "tool_details": true,
 *   // Include assistant metadata (provider, model, duration) (optional, defaults to true)
 *   "assistant_metadata": true
 * }
 * ```
 *
 * Expected Behavior:
 * - If config file is missing: Logs warning message and disables plugin
 * - If config is invalid JSON: Logs error message with syntax details and disables plugin
 * - If export_dir is missing: Logs error message "missing export_dir" and disables plugin
 * - If enabled is set to false: Plugin is disabled, no sessions will be exported
 * - When session goes idle: Arms a timer (idle_wait_ms) then exports the session if export_when_idle is enabled
 * - When session compacted: Immediately exports the session if export_when_compact is enabled
 * - When session deleted: Cancels any pending export timer for that session
 * - File naming: Based on timestamp (YYYYMMDDHHMMSS.md) in format()
 *
 * Field Descriptions:
 * - enabled (boolean, optional): Enable or disable the plugin (defaults to true)
 * - export_when_idle (boolean, optional): Export when a session becomes idle (defaults to true)
 * - export_when_compact (boolean, optional): Export when a session is compacted (defaults to true)
 * - export_dir (string, required): Directory path for exported markdown files (relative or absolute)
 * - idle_wait_ms (number, optional): Milliseconds to wait after idle before exporting (defaults to 30 minutes)
 * - thinking (boolean, optional): Include assistant thinking/reasoning blocks (defaults to true)
 * - tool_details (boolean, optional): Include tool input, output, and error details (defaults to true)
 * - assistant_metadata (boolean, optional): Include provider, model, and duration info (defaults to true)
 *
 * Export Format:
 * Files are written in markdown format with YAML frontmatter:
 * ```yaml
 * ---
 * title: "Session Title"
 * session-id: "uuid"
 * created: "YYYY-MM-DD HH:MM:SS"
 * updated: "YYYY-MM-DD HH:MM:SS"
 * exported: "YYYY-MM-DD HH:MM:SS"
 * reason: "idle" or "compacting"
 * ---
 *
 * ## User
 *
 * User message content...
 *
 * ---
 *
 * ## Assistant (provider · model · duration)
 *
 * Assistant response content...
 *
 * **Tool: tool_name**
 *
 * **Input:**
 * ```json
 * {...}
 * ```
 *
 * **Output:**
 * ```
 * tool output
 * ```
 *
 * ---
 * ```
 */

import type { Plugin } from "@opencode-ai/plugin";
import type {
  AssistantMessage,
  Part,
  Session,
  UserMessage,
} from "@opencode-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Cfg = {
  enabled?: boolean;
  export_when_idle?: boolean;
  export_when_compact?: boolean;
  export_dir?: string;
  idle_wait_ms?: number;
  thinking?: boolean;
  tool_details?: boolean;
  assistant_metadata?: boolean;
};

type Opts = {
  thinking: boolean;
  tool_details: boolean;
  assistant_metadata: boolean;
};

type Msg = {
  info: UserMessage | AssistantMessage;
  parts: Part[];
};

type ExportReason = "idle" | "compacting";

const DEFAULT_IDLE_WAIT_MS = 30 * 60 * 1000;

function strip(text: string) {
  let out = "";
  let i = 0;
  let str = false;
  let line = false;
  let block = false;
  let esc = false;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (esc) {
      out += ch;
      esc = false;
      i++;
      continue;
    }

    if (str) {
      if (ch === "\\") esc = true;
      if (ch === '"') str = false;
      out += ch;
      i++;
      continue;
    }

    if (line) {
      if (ch === "\n") {
        line = false;
        out += ch;
      }
      i++;
      continue;
    }

    if (block) {
      if (ch === "*" && next === "/") {
        block = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      str = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      line = true;
      i += 2;
      continue;
    }

    if (ch === "/" && next === "*") {
      block = true;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function commas(text: string) {
  let out = "";
  let i = 0;
  let str = false;
  let esc = false;

  while (i < text.length) {
    const ch = text[i];

    if (esc) {
      out += ch;
      esc = false;
      i++;
      continue;
    }

    if (str) {
      if (ch === "\\") esc = true;
      if (ch === '"') str = false;
      out += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      str = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") {
        i++;
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

function parse(text: string) {
  return JSON.parse(commas(strip(text))) as Cfg;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function stamp(time = new Date()) {
  return [
    time.getFullYear().toString(),
    pad(time.getMonth() + 1),
    pad(time.getDate()),
    pad(time.getHours()),
    pad(time.getMinutes()),
    pad(time.getSeconds()),
  ].join("");
}

function dateTime(time: Date) {
  return [
    `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`,
    `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`,
  ].join(" ");
}

function yaml(text: string) {
  return JSON.stringify(text);
}

function assistant(msg: AssistantMessage, full: boolean) {
  if (!full) return "## Assistant\n\n";
  const dur = msg.time.completed
    ? ` · ${((msg.time.completed - msg.time.created) / 1000).toFixed(1)}s`
    : "";
  return `## Assistant (${msg.providerID} · ${msg.modelID}${dur})\n\n`;
}

function tool(part: Extract<Part, { type: "tool" }>, opts: Opts) {
  let out = `**Tool: ${part.tool}**\n`;
  if (opts.tool_details && part.state.input) {
    out += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`;
  }
  if (
    opts.tool_details &&
    part.state.status === "completed" &&
    part.state.output
  ) {
    out += `\n**Output:**\n\`\`\`\n${part.state.output}\n\`\`\`\n`;
  }
  if (opts.tool_details && part.state.status === "error" && part.state.error) {
    out += `\n**Error:**\n\`\`\`\n${part.state.error}\n\`\`\`\n`;
  }
  return out + "\n";
}

function part(part: Part, opts: Opts) {
  if (part.type === "text" && !part.synthetic) return `${part.text}\n\n`;

  if (part.type === "reasoning") {
    if (!opts.thinking) return "";
    return `_Thinking:_\n\n${part.text}\n\n`;
  }

  if (part.type === "tool") return tool(part, opts);

  return "";
}

function line(msg: UserMessage | AssistantMessage, parts: Part[], opts: Opts) {
  let out =
    msg.role === "user"
      ? "## User\n\n"
      : assistant(msg, opts.assistant_metadata);
  for (const item of parts) out += part(item, opts);
  return out;
}

function format(session: Session, msgs: Msg[], opts: Opts, why: string) {
  let out = `---\n`;
  out += `title: ${yaml(session.title)}\n`;
  out += `session-id: ${yaml(session.id)}\n`;
  out += `created: ${dateTime(new Date(session.time.created))}\n`;
  out += `updated: ${dateTime(new Date(session.time.updated))}\n`;
  out += `exported: ${dateTime(new Date())}\n`;
  out += `reason: ${yaml(why)}\n`;
  out += `---\n\n`;

  for (const msg of msgs) {
    out += line(msg.info, msg.parts, opts);
    out += `---\n\n`;
  }

  return out;
}

export const ExportSessionPlugin: Plugin = async ({ client, directory }) => {
  const jobs = new Map<string, ReturnType<typeof setTimeout>>();
  const file = path.join(directory, ".opencode", "export-session.jsonc");

  const log = async (
    level: "info" | "warn" | "error",
    message: string,
  ) => {
    await client.app.log({
      body: {
        service: "export-session",
        level,
        message,
      },
    });
  };

  const cfg = async () => {
    try {
      const text = await readFile(file, "utf8");
      const data = parse(text);
      if (data.enabled === false) return data;
      if (
        data.export_when_idle === false &&
        data.export_when_compact === false
      ) {
        return data;
      }
      if (!data.export_dir) {
        await log("error", `missing export_dir in ${file}`);
        return;
      }
      if (
        data.idle_wait_ms !== undefined &&
        (!Number.isFinite(data.idle_wait_ms) || data.idle_wait_ms < 0)
      ) {
        await log("error", `invalid idle_wait_ms in ${file}`);
        return;
      }
      return data;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        await log("warn", `${file} not found; plugin disabled`);
        return;
      }
      await log(
        "error",
        `failed to load ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
  };

  const shouldExport = (data: Cfg, why: ExportReason) => {
    if (data.enabled === false) return false;
    if (why === "idle") return data.export_when_idle !== false;
    return data.export_when_compact !== false;
  };

  const save = async (sessionID: string, why: ExportReason) => {
    const data = await cfg();
    if (!data || !shouldExport(data, why) || !data.export_dir) return;

    try {
      const exportDir = data.export_dir;
      const dir = path.isAbsolute(exportDir)
        ? exportDir
        : path.resolve(directory, exportDir);
      await mkdir(dir, { recursive: true });
      const session = await client.session
        .get({ path: { id: sessionID }, throwOnError: true })
        .then((res) => res.data!);
      const msgs = await client.session
        .messages({ path: { id: sessionID }, throwOnError: true })
        .then((res) => res.data ?? []);
      const opts: Opts = {
        thinking: data.thinking !== false,
        tool_details: data.tool_details !== false,
        assistant_metadata: data.assistant_metadata !== false,
      };
      const dest = path.join(dir, `${stamp()}.md`);
      await writeFile(dest, format(session, msgs, opts, why), "utf8");
      await log("info", `exported ${sessionID} to ${dest}`);
    } catch (err) {
      await log(
        "error",
        `failed to export ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const stop = (sessionID: string) => {
    const job = jobs.get(sessionID);
    if (!job) return;
    clearTimeout(job);
    jobs.delete(sessionID);
  };

  const arm = async (sessionID: string) => {
    const data = await cfg();
    if (!data || !shouldExport(data, "idle")) {
      stop(sessionID);
      return;
    }

    const wait = data.idle_wait_ms ?? DEFAULT_IDLE_WAIT_MS;
    stop(sessionID);
    jobs.set(
      sessionID,
      setTimeout(() => {
        jobs.delete(sessionID);
        void save(sessionID, "idle");
      }, wait),
    );
  };

  return {
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        stop(event.properties.info.id);
        return;
      }

      if (event.type !== "session.status") return;
      if (event.properties.status.type === "idle") {
        await arm(event.properties.sessionID);
        return;
      }
      stop(event.properties.sessionID);
    },
    "experimental.session.compacting": async ({ sessionID }) => {
      await save(sessionID, "compacting");
    },
  };
};

export default ExportSessionPlugin;
