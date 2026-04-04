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
