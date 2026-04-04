/**
 * File Check Plugin
 * 
 * Runs validation scripts on files after they are modified by OpenCode tools, including:
 * - File edits (edit)
 * - File writes (write)
 * - Patch applications (apply_patch)
 * 
 * Setup Instructions:
 * 1. Create a configuration file at `.opencode/file-check.jsonc` in your project root
 * 2. Define rules with glob patterns to match files and scripts to validate them
 * 3. Scripts will be executed with Bun and receive the file path as the first argument
 * 
 * Configuration File Location:
 * `.opencode/file-check.jsonc` in your project root
 * 
 * Example Configuration:
 * ```jsonc
 * {
 *   // Enable/disable the plugin (optional, defaults to true)
 *   "enabled": true,
 *   // Array of validation rules
 *   "rules": [
 *     {
 *       // Glob pattern to match files (relative to project root)
 *       "glob": "*.ts",
 *       // Script to run (relative or absolute path)
 *       "script": "./scripts/check-typescript.js"
 *     },
 *     {
 *       "glob": "*.json",
 *       "script": "./scripts/validate-json.js"
 *     }
 *   ]
 * }
 * ```
 * 
 * Example Validation Script (check-typescript.js):
 * ```javascript
 * const file = process.argv[2]; // File path passed as argument
 * const content = await Bun.file(file).text();
 * 
 * // Your validation logic here
 * if (content.includes("TODO")) {
 *   console.error("File contains TODO comments");
 *   process.exit(1); // Exit 1 = validation failed
 * }
 * 
 * process.exit(0); // Exit 0 = validation passed
 * ```
 * 
 * Expected Behavior:
 * - If config file is missing: Logs error message "file-check.jsonc not found. Plugin disabled." and disables plugin
 * - If config is invalid JSON: Logs error message with syntax details and disables plugin (silent failure, doesn't crash OpenCode)
 * - If rules array is missing or empty: Logs error message "missing rules array. Plugin disabled." and disables plugin
 * - If enabled is set to false: Logs info message "file-check disabled: enabled is set to false in file-check.jsonc" and disables plugin
 * - If script file not found: Logs error message and appends warning to tool output, continues checking other files
 * - If script exits with code 0: Validation passed, continues to next rule
 * - If script exits with code 1: Validation failed, appends failure message to tool output
 * - If script exits with other codes: Script crashed, logs error message and appends to tool output
 * 
 * Field Descriptions:
 * - enabled (boolean, optional): Enable or disable the plugin (defaults to true)
 * - rules (array, required): Array of validation rules
 *   - glob (string, required): Glob pattern to match files (e.g., "*.ts", "src/*.{js,ts}")
 *   - script (string, required): Path to validation script (relative to project root or absolute)
 * 
 * Script Interface:
 * - Script is executed with: `bun <script> <file_path>`
 * - Exit code 0: Validation passed
 * - Exit code 1: Validation failed (output shown to user)
 * - Exit code other: Script crashed (logged as error)
 * - stdout and stderr are captured and displayed on failure
 */

import type { Plugin } from "@opencode-ai/plugin";
import path from "node:path";

type Rule = {
  glob: string;
  script: string;
};

type Cfg = {
  enabled?: boolean;
  rules?: Rule[];
};

type Res = {
  cfg: Cfg;
  err?: string;
};

type FileMeta = {
  filePath?: string;
  movePath?: string;
  type?: string;
};

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

async function load(root: string): Promise<Res> {
  const file = path.join(root, ".opencode", "file-check.jsonc");
  const src = Bun.file(file);
  if (!(await src.exists())) {
    return {
      cfg: {},
      err: "file-check.jsonc not found. Plugin disabled.",
    };
  }

  try {
    return { cfg: parse(await src.text()) };
  } catch (err) {
    return {
      cfg: {},
      err: `invalid file-check.jsonc: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function invalid(cfg: Cfg) {
  if (!cfg.rules?.length) return "missing rules array";
  for (const [i, rule] of cfg.rules.entries()) {
    if (!rule || typeof rule.glob !== "string" || !rule.glob) {
      return `rules[${i}].glob must be a non-empty string`;
    }
    if (typeof rule.script !== "string" || !rule.script) {
      return `rules[${i}].script must be a non-empty string`;
    }
  }
}

function abs(root: string, file: string) {
  return path.isAbsolute(file) ? file : path.resolve(root, file);
}

function files(root: string, tool: string, args: any, meta: any) {
  if (tool === "edit") {
    if (typeof meta?.filediff?.file === "string") {
      return [abs(root, meta.filediff.file)];
    }
    return typeof args?.filePath === "string" ? [abs(root, args.filePath)] : [];
  }

  if (tool === "write") {
    if (typeof meta?.filepath === "string") {
      return [abs(root, meta.filepath)];
    }
    return typeof args?.filePath === "string" ? [abs(root, args.filePath)] : [];
  }

  if (tool !== "apply_patch") return [];
  if (!Array.isArray(meta?.files)) return [];

  return meta.files
    .filter((item: FileMeta) => item?.type !== "delete")
    .map((item: FileMeta) => item.movePath ?? item.filePath)
    .filter((item: string | undefined): item is string => Boolean(item))
    .map((item: string) => abs(root, item));
}

function uniq(list: string[]) {
  return Array.from(new Set(list));
}

function rel(root: string, file: string) {
  return path.relative(root, file).replaceAll("\\", "/");
}

function append(out: { output: string }, text: string) {
  out.output = out.output ? `${out.output}\n\n${text}` : text;
}

export const FileCheckPlugin: Plugin = async ({ client, directory }) => {
  const loaded = await load(directory);
  if (loaded.err) {
    await client.app.log({
      body: {
        service: "file-check",
        level: "error",
        message: loaded.err,
      },
    });
    return {};
  }

  const err = invalid(loaded.cfg);
  if (err) {
    await client.app.log({
      body: {
        service: "file-check",
        level: "error",
        message: `${err}. Plugin disabled.`,
      },
    });
    return {};
  }

  if (loaded.cfg.enabled === false) {
    await client.app.log({
      body: {
        service: "file-check",
        level: "info",
        message:
          "file-check disabled: enabled is set to false in file-check.jsonc",
      },
    });
    return {};
  }

  const rules = loaded.cfg.rules ?? [];

  return {
    "tool.execute.after": async (input, output) => {
      if (!output || typeof output.output !== "string") return;
      if (
        input.tool !== "edit" &&
        input.tool !== "write" &&
        input.tool !== "apply_patch"
      )
        return;

      for (const file of uniq(
        files(directory, input.tool, input.args, output.metadata),
      )) {
        const name = rel(directory, file);

        for (const rule of rules) {
          if (!new Bun.Glob(rule.glob).match(name)) continue;

          const script = path.isAbsolute(rule.script)
            ? rule.script
            : path.join(directory, rule.script);
          const src = Bun.file(script);
          if (!(await src.exists())) {
            const msg = `File check misconfigured for ${name}: script not found: ${script}`;
            await client.app.log({
              body: {
                service: "file-check",
                level: "error",
                message: msg,
              },
            });
            append(output, msg);
            continue;
          }

          try {
            const proc = Bun.spawn(["bun", script, file], {
              cwd: directory,
              stdout: "pipe",
              stderr: "pipe",
            });
            const [stdout, stderr, code] = await Promise.all([
              new Response(proc.stdout).text(),
              new Response(proc.stderr).text(),
              proc.exited,
            ]);
            if (code === 0) continue;

            const body = [stdout.trim(), stderr.trim()]
              .filter(Boolean)
              .join("\n");
            if (code === 1) {
              append(
                output,
                [
                  `File check failed for ${name}`,
                  `Rule: ${rule.glob}`,
                  `Script: ${rule.script}`,
                  body,
                ]
                  .filter(Boolean)
                  .join("\n"),
              );
              continue;
            }

            const msg = [
              `File check crashed for ${name}`,
              `Rule: ${rule.glob}`,
              `Script: ${rule.script}`,
              `Exit code: ${code}`,
              body,
            ]
              .filter(Boolean)
              .join("\n");
            await client.app.log({
              body: {
                service: "file-check",
                level: "error",
                message: msg,
              },
            });
            append(output, msg);
          } catch (err) {
            const msg = `File check failed to run for ${name}: ${err instanceof Error ? err.message : String(err)}`;
            await client.app.log({
              body: {
                service: "file-check",
                level: "error",
                message: msg,
              },
            });
            append(output, msg);
          }
        }
      }
    },
  };
};

export default FileCheckPlugin;
