/**
 * Compaction Prompts Plugin
 *
 * Allows project-local control over how OpenCode builds compaction prompts.
 * Configuration is read from `.opencode/compaction-prompts.jsonc`.
 *
 * Supported prompt categories:
 * - Manual compaction prompt
 * - General auto-compaction prompt
 * - Command-specific auto-compaction prompts keyed by slash command name
 *
 * Prompt refs support either:
 * - `file`: relative/absolute path to a prompt file
 * - `text`: inline prompt text
 *
 * Optional placeholders inside prompt text/file content:
 * - `{{SESSION_ID}}`
 * - `{{COMMAND}}`
 * - `{{ARGUMENTS}}`
 * - `{{COMPACTION_KIND}}`
 *
 * Prompt mode:
 * - `replace` (default): replaces the built-in compaction prompt entirely
 * - `append`: appends custom context to the built-in compaction prompt
 *
 * Debug Mode:
 * Set `const DEBUG = true` to write the final compaction prompt text seen by this
 * plugin before and after it applies its changes:
 * - `.opencode/compaction-prompt-before.md`
 * - `.opencode/compaction-prompt-after.md`
 *
 * Note: OpenCode does not pass the built-in compaction prompt into the hook, so
 * the "before" snapshot is reconstructed from the current upstream default prompt
 * plus any prompt/context already applied by earlier plugins.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Mode = "replace" | "append";
type CompactionKind = "auto" | "manual";

type PromptRef = {
  mode: Mode;
  file?: string;
  text?: string;
};

type Cfg = {
  manual?: PromptRef;
  auto: {
    general?: PromptRef;
    commands: Record<string, PromptRef>;
  };
};

type SessionState = {
  command: string;
  arguments: string;
  updated_at: number;
  source: "session-start";
};

type State = {
  sessions: Record<string, SessionState>;
};

type PromptContext = {
  sessionID: string;
  command?: string;
  arguments?: string;
  kind: CompactionKind;
};

const CFG_FILE = "compaction-prompts.jsonc";
const STATE_FILE = "compaction-prompts-state.json";
const DEBUG = true;
const DEFAULT_COMPACTION_PROMPT = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`;

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

function abs(root: string, file: string) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function rel(root: string, file: string) {
  const item = path.relative(root, file).replaceAll("\\", "/");
  if (!item || item === ".." || item.startsWith("../")) return file;
  return item;
}

function render(text: string, ctx: PromptContext) {
  const replacements: Record<string, string> = {
    "{{SESSION_ID}}": ctx.sessionID,
    "{{COMMAND}}": ctx.command ?? "",
    "{{ARGUMENTS}}": ctx.arguments ?? "",
    "{{COMPACTION_KIND}}": ctx.kind,
  };

  let out = text;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(key).join(value);
  }
  return out.trim();
}

function pickMode(value: unknown): Mode {
  return value === "append" ? "append" : "replace";
}

function composePrompt(prompt: string | undefined, context: string[]) {
  return (prompt ?? [DEFAULT_COMPACTION_PROMPT, ...context].join("\n\n")).trim();
}

export const CompactionPromptsPlugin: Plugin = async ({ client, directory }) => {
  const cfgPath = path.join(directory, ".opencode", CFG_FILE);
  const statePath = path.join(directory, ".opencode", STATE_FILE);
  const beforePath = path.join(directory, ".opencode", "compaction-prompt-before.md");
  const afterPath = path.join(directory, ".opencode", "compaction-prompt-after.md");
  const seen = new Set<string>();
  const pendingCommandMessages = new Set<string>();

  const log = async (level: "info" | "warn" | "error", message: string) => {
    const key = `${level}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    await client.app.log({
      body: {
        service: "compaction-prompts",
        level,
        message,
      },
    });
  };

  const readStateSafe = async () => {
    try {
      const text = await readFile(statePath, "utf8");
      const parsed = JSON.parse(text) as Partial<State>;
      const sessions: Record<string, SessionState> = {};

      if (isObject(parsed.sessions)) {
        for (const [sessionID, value] of Object.entries(parsed.sessions)) {
          if (!isObject(value) || value.source !== "session-start") continue;
          const command = typeof value.command === "string" ? value.command.trim() : "";
          if (!command) continue;
          sessions[sessionID] = {
            command,
            arguments: typeof value.arguments === "string" ? value.arguments : "",
            updated_at: typeof value.updated_at === "number" ? value.updated_at : Date.now(),
            source: "session-start",
          };
        }
      }

      return {
        sessions,
      } satisfies State;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { sessions: {} } satisfies State;
      }
      await log(
        "error",
        `failed to read ${STATE_FILE}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { sessions: {} } satisfies State;
    }
  };

  const writeStateSafe = async (state: State) => {
    try {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
    } catch (err) {
      await log(
        "error",
        `failed to write ${STATE_FILE}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const writeDebugPrompts = async (before: string, after: string) => {
    if (!DEBUG) return;
    try {
      await mkdir(path.join(directory, ".opencode"), { recursive: true });
      await Promise.all([
        writeFile(beforePath, before, "utf8"),
        writeFile(afterPath, after, "utf8"),
      ]);
    } catch (err) {
      await log(
        "error",
        `failed to write compaction prompt debug files: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  let state = await readStateSafe();

  const normalizePrompt = async (value: unknown, label: string): Promise<PromptRef | undefined> => {
    if (value === undefined) return;
    if (!isObject(value)) {
      await log("error", `${cfgPath} ${label} must be an object`);
      return;
    }

    const mode = pickMode(value.mode);
    if (value.mode !== undefined && value.mode !== "replace" && value.mode !== "append") {
      await log("error", `${cfgPath} ${label}.mode must be \"replace\" or \"append\"`);
    }

    const file = typeof value.file === "string" ? value.file.trim() : undefined;
    const text = typeof value.text === "string" ? value.text : undefined;
    const textTrimmed = text?.trim();

    if (!!file === !!textTrimmed) {
      await log("error", `${cfgPath} ${label} must define exactly one of \"file\" or \"text\"`);
      return;
    }

    return {
      mode,
      file,
      text,
    } satisfies PromptRef;
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

      const manual = await normalizePrompt(raw.manual, "manual");

      let autoRaw: Record<string, unknown> = {};
      if (raw.auto !== undefined) {
        if (!isObject(raw.auto)) {
          await log("error", `${cfgPath} auto must be an object`);
        } else {
          autoRaw = raw.auto;
        }
      }

      const general = await normalizePrompt(autoRaw.general, "auto.general");

      const commands: Record<string, PromptRef> = {};
      if (autoRaw.commands !== undefined) {
        if (!isObject(autoRaw.commands)) {
          await log("error", `${cfgPath} auto.commands must be an object keyed by command name`);
        } else {
          for (const [name, value] of Object.entries(autoRaw.commands)) {
            const key = name.trim();
            if (!key) {
              await log("error", `${cfgPath} auto.commands contains an empty command key`);
              continue;
            }
            const prompt = await normalizePrompt(value, `auto.commands.${key}`);
            if (!prompt) continue;
            commands[key] = prompt;
          }
        }
      }

      if (!manual && !general && Object.keys(commands).length === 0) {
        await log("warn", `${cfgPath} defines no valid prompts; plugin disabled`);
        return;
      }

      return {
        manual,
        auto: {
          general,
          commands,
        },
      } satisfies Cfg;
    } catch (err) {
      await log(
        "error",
        `failed to load ${cfgPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const rememberCommand = async (sessionID: string, command: string, args: string) => {
    state.sessions[sessionID] = {
      command,
      arguments: args,
      updated_at: Date.now(),
      source: "session-start",
    };
    await writeStateSafe(state);
  };

  const forgetCommand = async (sessionID: string) => {
    if (!state.sessions[sessionID]) return;
    delete state.sessions[sessionID];
    await writeStateSafe(state);
  };

  const latestCompactionKind = async (sessionID: string): Promise<CompactionKind> => {
    try {
      const msgs = await client.session
        .messages({ path: { id: sessionID }, throwOnError: true })
        .then((res) => res.data ?? []);

      for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex];
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex] as { type?: string; auto?: boolean };
          if (part.type !== "compaction") continue;
          return part.auto === false ? "manual" : "auto";
        }
      }
    } catch (err) {
      await log(
        "error",
        `failed to inspect compaction type for ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return "auto";
  };

  const shouldRememberCommand = async (sessionID: string, command: string, cfg: Cfg) => {
    if (state.sessions[sessionID]) return false;
    if (!cfg.auto.commands[command]) return false;

    try {
      const msgs = await client.session
        .messages({ path: { id: sessionID }, throwOnError: true })
        .then((res) => res.data ?? []);

      // Bind command-specific auto prompts only when the command opens the session.
      return msgs.length === 0;
    } catch (err) {
      await log(
        "error",
        `failed to inspect session start state for ${sessionID}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  };

  const resolvePrompt = async (prompt: PromptRef | undefined, ctx: PromptContext) => {
    if (!prompt) return;

    let text = prompt.text;
    if (!text && prompt.file) {
      const file = abs(directory, prompt.file);
      try {
        text = await readFile(file, "utf8");
      } catch (err) {
        await log(
          "error",
          `failed to read prompt file ${rel(directory, file)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    if (!text?.trim()) return;

    return {
      mode: prompt.mode,
      text: render(text, ctx),
    };
  };

  const selectPrompt = async (sessionID: string, cfg: Cfg) => {
    const kind = await latestCompactionKind(sessionID);
    const tracked = state.sessions[sessionID];
    const ctx: PromptContext = {
      sessionID,
      command: tracked?.command,
      arguments: tracked?.arguments,
      kind,
    };

    if (kind === "manual") {
      return resolvePrompt(cfg.manual, ctx);
    }

    if (tracked?.command) {
      return resolvePrompt(cfg.auto.commands[tracked.command] ?? cfg.auto.general, ctx);
    }

    return resolvePrompt(cfg.auto.general, ctx);
  };

  return {
    "command.execute.before": async (input) => {
      const cfg = await loadCfg();
      if (!cfg) return;
      pendingCommandMessages.add(input.sessionID);
      if (!(await shouldRememberCommand(input.sessionID, input.command, cfg))) return;
      await rememberCommand(input.sessionID, input.command, input.arguments);
    },
    "chat.message": async (input) => {
      const cfg = await loadCfg();
      if (!cfg) return;
      if (pendingCommandMessages.has(input.sessionID)) {
        pendingCommandMessages.delete(input.sessionID);
      }
    },
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return;
      pendingCommandMessages.delete(event.properties.info.id);
      await forgetCommand(event.properties.info.id);
    },
    "experimental.session.compacting": async ({ sessionID }, output) => {
      const before = composePrompt(output.prompt, output.context);
      const cfg = await loadCfg();
      if (!cfg) {
        await writeDebugPrompts(before, before);
        return;
      }

      const prompt = await selectPrompt(sessionID, cfg);
      if (prompt?.text) {
        if (prompt.mode === "append") {
          output.context.push(prompt.text);
        } else {
          output.prompt = prompt.text;
        }
      }

      await writeDebugPrompts(before, composePrompt(output.prompt, output.context));
    },
  };
};

export default CompactionPromptsPlugin;
