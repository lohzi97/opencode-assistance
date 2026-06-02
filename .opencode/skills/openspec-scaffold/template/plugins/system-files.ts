/**
 * System Files Plugin
 *
 * Injects content from configured files into the OpenCode system prompt before each chat session.
 * This allows you to provide additional project context, instructions, or reference materials
 * that will be automatically available to the AI assistant.
 *
 * Setup Instructions:
 * 1. Create a config file at `.opencode/system-files.json` in your project root
 * 2. Add an array of file paths (relative or absolute) to files you want included
 * 3. The files will be read and injected into the system prompt in the order listed
 *
 * Configuration File Location:
 * `.opencode/system-files.json` in your project root
 *
 * Example Configuration:
 * ```json
 * [
 *   "README.md",
 *   "docs/architecture.md",
 *   ".opencode/AGENTS.md",
 *   "notes/project-context.md"
 * ]
 * ```
 *
 * Template Placeholders:
 * - File contents may contain runtime placeholders using `{{PLACEHOLDER_NAME}}`
 * - Supported placeholders are replaced with runtime values before injection
 * - Unknown placeholders are left unchanged and logged once as warnings
 * - `.opencode/runtime-context.md` is the canonical example file for these placeholders
 *
 * Expected Behavior:
 * - If config file is missing: Logs warning message "{path} not found; plugin disabled" and disables plugin
 * - If config is not a JSON array: Logs error message "{path} must be a JSON array of file paths" and disables plugin
 * - If config contains non-string values: Logs error message and disables plugin
 * - If config contains empty strings: Logs error message and disables plugin
 * - If a configured file is not found: Logs error message "configured file not found: {path}" and continues with other files
 * - If a file cannot be read: Logs error message "failed to read {path}: {error}" and continues with other files
 * - If all files fail: No content is injected, but plugin doesn't crash
 * - On success: File contents are formatted and appended to the system prompt
 *
 * File Content Format:
 * Each file's content is formatted as:
 * ```
 * ## File N: {relative/path/to/file}
 * <content>
 * {file contents}
 * </content>
 * ```
 *
 * Field Descriptions:
 * - Configuration is a JSON array of strings (file paths)
 * - File paths can be relative to project root or absolute paths
 * - Relative paths outside project root are treated as absolute paths for security
 * - Files are processed in the order they appear in the configuration
 * 
 * Debug Mode:
 * Set `const DEBUG = true` in the plugin file to enable debug mode.
 * This will write the system prompt before and after transformation to:
 * - `.opencode/sysprompt-before.md`
 * - `.opencode/sysprompt-after.md`
 */

import type { Plugin } from "@opencode-ai/plugin";
import path from "node:path";

const DEBUG = false;
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

type RuntimeModalities = {
  text: boolean;
  audio: boolean;
  image: boolean;
  video: boolean;
  pdf: boolean;
};

type RuntimeProject = {
  id: string;
  worktree: string;
  vcsDir?: string;
  vcs?: string;
  time: {
    created: number;
    initialized?: number;
  };
};

type RuntimeModel = {
  id: string;
  providerID: string;
  api: {
    id: string;
    url: string;
    npm: string;
  };
  name: string;
  family?: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: RuntimeModalities;
    output: RuntimeModalities;
    interleaved: unknown;
  };
  cost: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
    experimentalOver200K?: {
      input: number;
      output: number;
      cache: {
        read: number;
        write: number;
      };
    };
  };
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  status: string;
  release_date: string;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatDate(value: Date) {
  return [
    String(value.getFullYear()),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
  ].join("");
}

function formatDateTime(value: Date) {
  return [
    formatDate(value),
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds()),
  ].join("");
}

function formatTimestamp(value?: number) {
  if (typeof value !== "number") return "";
  return formatDateTime(new Date(value));
}

function stringify(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof URL) return value.toString();
  return JSON.stringify(value);
}

function render(text: string, vars: Record<string, string>) {
  return text.replace(PLACEHOLDER, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key]!;
    }
    return match;
  });
}

function placeholders(text: string) {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

function runtimeVars(input: {
  sessionID?: string;
  model: RuntimeModel;
  now: Date;
  project: RuntimeProject;
  directory: string;
  worktree: string;
  serverUrl: URL;
}) {
  const over200k = input.model.cost.experimentalOver200K;
  return {
    OPENCODE_CURRENT_DATE: formatDate(input.now),
    OPENCODE_CURRENT_DATETIME: formatDateTime(input.now),
    OPENCODE_SESSION_ID: input.sessionID ?? "unknown-session",
    OPENCODE_SERVER_URL: stringify(input.serverUrl),
    OPENCODE_DIRECTORY: input.directory,
    OPENCODE_WORKTREE: input.worktree,
    OPENCODE_PROJECT_ID: input.project.id,
    OPENCODE_PROJECT_WORKTREE: input.project.worktree,
    OPENCODE_PROJECT_VCS: input.project.vcs ?? "",
    OPENCODE_PROJECT_VCS_DIR: input.project.vcsDir ?? "",
    OPENCODE_PROJECT_CREATED_AT: formatTimestamp(input.project.time.created),
    OPENCODE_PROJECT_INITIALIZED_AT: formatTimestamp(input.project.time.initialized),
    OPENCODE_PROVIDER_ID: input.model.providerID,
    OPENCODE_MODEL_ID: input.model.id,
    OPENCODE_MODEL_NAME: input.model.name,
    OPENCODE_MODEL_FAMILY: input.model.family ?? "",
    OPENCODE_MODEL_STATUS: input.model.status,
    OPENCODE_MODEL_RELEASE_DATE: input.model.release_date,
    OPENCODE_MODEL_API_ID: input.model.api.id,
    OPENCODE_MODEL_API_URL: input.model.api.url,
    OPENCODE_MODEL_API_NPM: input.model.api.npm,
    OPENCODE_MODEL_LIMIT_CONTEXT: stringify(input.model.limit.context),
    OPENCODE_MODEL_LIMIT_INPUT: stringify(input.model.limit.input),
    OPENCODE_MODEL_LIMIT_OUTPUT: stringify(input.model.limit.output),
    OPENCODE_MODEL_COST_INPUT: stringify(input.model.cost.input),
    OPENCODE_MODEL_COST_OUTPUT: stringify(input.model.cost.output),
    OPENCODE_MODEL_COST_CACHE_READ: stringify(input.model.cost.cache.read),
    OPENCODE_MODEL_COST_CACHE_WRITE: stringify(input.model.cost.cache.write),
    OPENCODE_MODEL_COST_OVER_200K_INPUT: stringify(over200k?.input),
    OPENCODE_MODEL_COST_OVER_200K_OUTPUT: stringify(over200k?.output),
    OPENCODE_MODEL_COST_OVER_200K_CACHE_READ: stringify(over200k?.cache.read),
    OPENCODE_MODEL_COST_OVER_200K_CACHE_WRITE: stringify(over200k?.cache.write),
    OPENCODE_MODEL_CAPABILITY_TEMPERATURE: stringify(input.model.capabilities.temperature),
    OPENCODE_MODEL_CAPABILITY_REASONING: stringify(input.model.capabilities.reasoning),
    OPENCODE_MODEL_CAPABILITY_ATTACHMENT: stringify(input.model.capabilities.attachment),
    OPENCODE_MODEL_CAPABILITY_TOOLCALL: stringify(input.model.capabilities.toolcall),
    OPENCODE_MODEL_CAPABILITY_INTERLEAVED: stringify(input.model.capabilities.interleaved),
    OPENCODE_MODEL_CAPABILITY_INPUT_TEXT: stringify(input.model.capabilities.input.text),
    OPENCODE_MODEL_CAPABILITY_INPUT_AUDIO: stringify(input.model.capabilities.input.audio),
    OPENCODE_MODEL_CAPABILITY_INPUT_IMAGE: stringify(input.model.capabilities.input.image),
    OPENCODE_MODEL_CAPABILITY_INPUT_VIDEO: stringify(input.model.capabilities.input.video),
    OPENCODE_MODEL_CAPABILITY_INPUT_PDF: stringify(input.model.capabilities.input.pdf),
    OPENCODE_MODEL_CAPABILITY_OUTPUT_TEXT: stringify(input.model.capabilities.output.text),
    OPENCODE_MODEL_CAPABILITY_OUTPUT_AUDIO: stringify(input.model.capabilities.output.audio),
    OPENCODE_MODEL_CAPABILITY_OUTPUT_IMAGE: stringify(input.model.capabilities.output.image),
    OPENCODE_MODEL_CAPABILITY_OUTPUT_VIDEO: stringify(input.model.capabilities.output.video),
    OPENCODE_MODEL_CAPABILITY_OUTPUT_PDF: stringify(input.model.capabilities.output.pdf),
  };
}

function abs(root: string, file: string) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function rel(root: string, file: string) {
  const item = path.relative(root, file).replaceAll("\\", "/");
  if (!item || item === ".." || item.startsWith("../")) return file;
  return item;
}

function block(i: number, file: string, text: string) {
  return [
    `## File ${i + 1}: ${file}`,
    "<content>",
    text || "(empty file)",
    "</content>",
  ].join("\n");
}

export const SystemFilesPlugin: Plugin = async ({ client, directory, project, worktree, serverUrl }) => {
  const cfg = path.join(directory, ".opencode", "system-files.json");
  const seen = new Set<string>();

  const log = async (level: "info" | "warn" | "error", message: string) => {
    const key = `${level}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    await client.app.log({
      body: {
        service: "system-files",
        level,
        message,
      },
    });
  };

  const load = async () => {
    const src = Bun.file(cfg);
    if (!(await src.exists())) {
      await log("warn", `${cfg} not found; plugin disabled`);
      return;
    }

    try {
      const data = JSON.parse(await src.text());
      if (!Array.isArray(data)) {
        await log("error", `${cfg} must be a JSON array of file paths`);
        return;
      }

      const list = data
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim());

      if (list.length !== data.length || list.some((item) => !item)) {
        await log(
          "error",
          `${cfg} must contain only non-empty string file paths`,
        );
        return;
      }

      return list;
    } catch (err) {
      await log(
        "error",
        `failed to load ${cfg}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    "shell.env": async (input, output) => {
      if (typeof input.sessionID === "string" && input.sessionID) {
        output.env.OPENCODE_SESSION_ID ??= input.sessionID;
      }
      if (typeof input.callID === "string" && input.callID) {
        output.env.OPENCODE_CALL_ID ??= input.callID;
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      const before = [...output.system];
      const list = await load();
      if (!list?.length) {
        if (DEBUG) {
          await Bun.write(
            path.join(directory, ".opencode", "sysprompt-before.md"),
            before.join("\n\n---\n\n"),
          );
          await Bun.write(
            path.join(directory, ".opencode", "sysprompt-after.md"),
            output.system.join("\n\n---\n\n"),
          );
        }
        return;
      }

      const parts: string[] = [];
      const vars = runtimeVars({
        sessionID: input.sessionID,
        model: input.model as RuntimeModel,
        now: new Date(),
        project: project as RuntimeProject,
        directory,
        worktree,
        serverUrl,
      });

      for (const item of list) {
        const file = abs(directory, item);
        const src = Bun.file(file);
        if (!(await src.exists())) {
          await log("error", `configured file not found: ${item}`);
          continue;
        }

        try {
          const text = await src.text();
          const unknown = [...new Set(placeholders(text))].filter(
            (key) => !Object.prototype.hasOwnProperty.call(vars, key),
          );

          for (const key of unknown) {
            await log("warn", `unsupported placeholder {{${key}}} in ${item}`);
          }

          parts.push(
            block(parts.length, rel(directory, file), render(text, vars)),
          );
        } catch (err) {
          await log(
            "error",
            `failed to read ${item}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (!parts.length) {
        if (DEBUG) {
          await Bun.write(
            path.join(directory, ".opencode", "sysprompt-before.md"),
            before.join("\n\n---\n\n"),
          );
          await Bun.write(
            path.join(directory, ".opencode", "sysprompt-after.md"),
            output.system.join("\n\n---\n\n"),
          );
        }
        return;
      }

      output.system.push(
        [
          "Additional project context from configured files.",
          "Read the following files in the listed order.",
          ...parts,
        ].join("\n\n"),
      );

      if (DEBUG) {
        await Bun.write(
          path.join(directory, ".opencode", "sysprompt-before.md"),
          before.join("\n\n---\n\n"),
        );
        await Bun.write(
          path.join(directory, ".opencode", "sysprompt-after.md"),
          output.system.join("\n\n---\n\n"),
        );
      }
    },
  };
};

export default SystemFilesPlugin;
