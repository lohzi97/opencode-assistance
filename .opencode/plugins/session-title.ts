/**
 * Session Title Plugin
 *
 * Renames brand-new sessions opened by mapped slash commands before OpenCode's
 * title agent runs. Unmapped commands and normal prompts keep the built-in
 * title behavior.
 *
 * Configuration File Location:
 * `.opencode/session-title.jsonc`
 *
 * Example Configuration:
 * ```jsonc
 * {
 *   "enabled": true,
 *   "commands": {
 *     "generate-commit": "Generate commit {{TIMESTAMP}}"
 *   }
 * }
 * ```
 *
 * Keys are slash command names without the leading `/`.
 * Supported placeholders:
 * - `{{TIMESTAMP}}`: local time in `YYYYMMDDHHmmss`
 */

import type { Plugin } from "@opencode-ai/plugin";
import path from "node:path";

type Cfg = {
  commands: Record<string, string>;
};

const CFG_FILE = "session-title.jsonc";
const DEFAULT_TITLE_RE =
  /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localTimestamp(date = new Date()) {
  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function isDefaultTitle(title: string) {
  return DEFAULT_TITLE_RE.test(title);
}

function render(template: string) {
  return template.split("{{TIMESTAMP}}").join(localTimestamp()).trim();
}

export const SessionTitlePlugin: Plugin = async ({ client, directory }) => {
  const cfgPath = path.join(directory, ".opencode", CFG_FILE);
  const seen = new Set<string>();

  const log = async (level: "info" | "warn" | "error", message: string) => {
    const key = `${level}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    await client.app.log({
      body: {
        service: "session-title",
        level,
        message,
      },
    });
  };

  const loadCfg = async () => {
    const src = Bun.file(cfgPath);
    if (!(await src.exists())) {
      await log("warn", `${cfgPath} not found; plugin disabled`);
      return;
    }

    try {
      const raw = JSON.parse(commas(strip(await src.text()))) as unknown;
      if (!isObject(raw)) {
        await log("error", `${cfgPath} must be a JSON object`);
        return;
      }

      if (raw.enabled === false) return;
      if (raw.commands !== undefined && !isObject(raw.commands)) {
        await log("error", `${cfgPath} commands must be an object keyed by command name`);
        return;
      }

      const commands: Record<string, string> = {};
      for (const [name, value] of Object.entries(raw.commands ?? {})) {
        const key = name.trim();
        if (!key) {
          await log("error", `${cfgPath} commands contains an empty command key`);
          continue;
        }
        if (typeof value !== "string" || !value.trim()) {
          await log("error", `${cfgPath} commands.${key} must be a non-empty string`);
          continue;
        }
        commands[key] = value.trim();
      }

      if (!Object.keys(commands).length) {
        await log("warn", `${cfgPath} defines no valid commands; plugin disabled`);
        return;
      }

      return {
        commands,
      } satisfies Cfg;
    } catch (err) {
      await log(
        "error",
        `failed to load ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    "command.execute.before": async (input) => {
      const cfg = await loadCfg();
      if (!cfg) return;

      const template = cfg.commands[input.command];
      if (!template) return;

      try {
        const messages = await client.session
          .messages({
            path: { id: input.sessionID },
            query: { limit: 1 },
            throwOnError: true,
          })
          .then((res) => res.data ?? []);
        if (messages.length !== 0) return;

        const session = await client.session
          .get({
            path: { id: input.sessionID },
            throwOnError: true,
          })
          .then((res) => res.data);
        if (!session || !isDefaultTitle(session.title)) return;

        const title = render(template);
        if (!title || title === session.title) return;

        await client.session.update({
          path: { id: input.sessionID },
          body: { title },
          throwOnError: true,
        });
      } catch (err) {
        await log(
          "error",
          `failed to rename session ${input.sessionID} for /${input.command}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
};

export default SessionTitlePlugin;
