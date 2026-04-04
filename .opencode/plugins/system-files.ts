import type { Plugin } from "@opencode-ai/plugin";
import path from "node:path";

const DEBUG = true;

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

export const SystemFilesPlugin: Plugin = async ({ client, directory }) => {
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
    "experimental.chat.system.transform": async (_, output) => {
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
      for (const item of list) {
        const file = abs(directory, item);
        const src = Bun.file(file);
        if (!(await src.exists())) {
          await log("error", `configured file not found: ${item}`);
          continue;
        }

        try {
          parts.push(
            block(parts.length, rel(directory, file), await src.text()),
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
