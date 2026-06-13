#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

type Options = {
  input?: string;
  project?: string;
  prd?: string;
  openextPath: string;
  dryRun: boolean;
  force: boolean;
  skipGit: boolean;
  skipOpenSpecInit: boolean;
  help: boolean;
};

type Action = {
  kind: "created" | "copied" | "symlinked" | "skipped" | "removed" | "ran" | "would" | "updated" | "error";
  path?: string;
  detail: string;
};

const skillDir = path.resolve(import.meta.dir, "..");
const defaultTemplateDir = path.join(skillDir, "template");

const DEFAULT_OPSX_MANIFEST: Record<string, string[]> = {
  agents: ["levi", "shalltear"],
  skills: [
    "agent-tui",
    "antigravity-websearch",
    "chatgpt-research",
    "chrome",
    "openspec-align",
    "openspec-apply-change",
    "openspec-apply-resume",
    "openspec-archive-change",
    "openspec-code-review",
    "openspec-discuss",
    "openspec-fix",
    "openspec-propose",
    "openspec-review-proposal",
    "openspec-test",
    "write-commit-message",
  ],
  plugins: ["stuck-watcher"],
  scripts: ["session-info"],
  config: ["stuck-watcher.jsonc"],
};

function usage() {
  return `Usage: bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts [options] <project-or-prd-path>

Prepare a project for Master's OPSX/OpenSpec orchestration workflow.

Inputs:
  <project-or-prd-path>       Directory to scaffold, or a PRD file whose parent directory is the project root.
  --project <path>            Explicit project directory.
  --prd <path>                PRD file; its parent directory is used as the project root.

Options:
  --openext-path <path>       Path to openext CLI. Defaults to ~/openext/cli.ts.
  --dry-run                   Show intended changes without writing files or running commands.
  --force                     Overwrite files that already exist.
  --skip-git                  Do not initialize git when .git is missing.
  --skip-openspec-init        Do not run openspec init.
  --help                      Show this help.

Default behavior is conservative: existing files are skipped, not overwritten.
Extension management (agents, skills, plugins, scripts, config) is delegated
to openext via a generated .opencode/openext.json manifest.`;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    openextPath: "~/openext/cli.ts",
    dryRun: false,
    force: false,
    skipGit: false,
    skipOpenSpecInit: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--skip-git":
        options.skipGit = true;
        break;
      case "--skip-openspec-init":
        options.skipOpenSpecInit = true;
        break;
      case "--project":
        options.project = readValue(argv, ++i, arg);
        break;
      case "--prd":
        options.prd = readValue(argv, ++i, arg);
        break;
      case "--openext-path":
        options.openextPath = readValue(argv, ++i, arg);
        break;
      default:
        if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
        if (options.input) throw new Error(`Multiple positional inputs provided: ${options.input}, ${arg}`);
        options.input = arg;
    }
  }

  return options;
}

function readValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function resolveProjectRoot(options: Options) {
  if (options.project && options.prd) throw new Error("Use either --project or --prd, not both.");
  const input = options.project ?? options.prd ?? options.input;
  if (!input) throw new Error("A project directory or PRD path is required.");

  const resolved = path.resolve(input);
  if (!existsSync(resolved)) throw new Error(`Input path does not exist: ${resolved}`);

  if (options.prd) {
    if (!statSync(resolved).isFile()) throw new Error(`PRD path is not a file: ${resolved}`);
    return { projectRoot: path.dirname(resolved), prdPath: resolved };
  }

  const st = statSync(resolved);
  if (st.isDirectory()) return { projectRoot: resolved, prdPath: undefined };
  if (st.isFile()) return { projectRoot: path.dirname(resolved), prdPath: resolved };
  throw new Error(`Input must be a directory or file: ${resolved}`);
}

function listNames(dir: string) {
  if (!existsSync(dir)) return new Set<string>();
  return new Set(readdirSync(dir));
}

function ensureDir(dir: string, options: Options, actions: Action[]) {
  if (existsSync(dir)) return;
  if (options.dryRun) {
    actions.push({ kind: "would", path: dir, detail: "create directory" });
    return;
  }
  mkdirSync(dir, { recursive: true });
  actions.push({ kind: "created", path: dir, detail: "directory" });
}

function runCommand(command: string, args: string[], cwd: string, options: Options, actions: Action[]) {
  const rendered = [command, ...args].join(" ");
  if (options.dryRun) {
    actions.push({ kind: "would", detail: `run ${rendered} in ${cwd}` });
    return;
  }

  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${rendered} failed with exit code ${result.status}`);
  actions.push({ kind: "ran", detail: `${rendered} in ${cwd}` });
}

function copyManagedFile(src: string, dest: string, options: Options, actions: Action[]) {
  if (existsSync(dest) && !options.force) {
    actions.push({ kind: "skipped", path: dest, detail: "exists" });
    return;
  }
  if (options.dryRun) {
    actions.push({ kind: "would", path: dest, detail: `${existsSync(dest) ? "overwrite" : "copy"} from ${src}` });
    return;
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  actions.push({ kind: "copied", path: dest, detail: `from ${src}` });
}

function ensureGitignoreEntry(projectRoot: string, entry: string, comment: string, options: Options, actions: Action[]) {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const entryBase = entry.replace(/\/$/, "");

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const alreadyPresent = lines.some((line) => {
      const trimmed = line.trim();
      return trimmed === entryBase || trimmed === entryBase + "/";
    });
    if (alreadyPresent) {
      actions.push({ kind: "skipped", path: gitignorePath, detail: `${entry} already in .gitignore` });
      return;
    }
  }

  if (options.dryRun) {
    actions.push({ kind: "would", path: gitignorePath, detail: `add ${entry} to .gitignore` });
    return;
  }

  const block = `\n# ${comment}\n${entry}\n`;

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    const needsNewline = content.length > 0 && !content.endsWith("\n");
    writeFileSync(gitignorePath, content + (needsNewline ? "\n" : "") + block);
  } else {
    writeFileSync(gitignorePath, block);
  }

  actions.push({ kind: "updated", path: gitignorePath, detail: `added ${entry}` });
}

/**
 * Create a relative symlink from dest -> src for scaffold-specific files.
 * Skips if correct symlink already present; overwrites only with --force.
 */
function ensureSymlink(src: string, dest: string, options: Options, actions: Action[]) {
  const relativeTarget = path.relative(path.dirname(dest), src);

  let existingStat: ReturnType<typeof lstatSync> | undefined;
  try {
    existingStat = lstatSync(dest);
  } catch {}

  if (existingStat?.isSymbolicLink()) {
    try {
      const currentTarget = readlinkSync(dest);
      const resolvedCurrent = path.resolve(path.dirname(dest), currentTarget);
      if (resolvedCurrent === path.resolve(src)) {
        actions.push({ kind: "skipped", path: dest, detail: "symlink already correct" });
        return;
      }
    } catch {}
    if (!options.force) {
      actions.push({ kind: "skipped", path: dest, detail: "symlink exists (different target)" });
      return;
    }
    if (!options.dryRun) unlinkSync(dest);
  } else if (existingStat) {
    if (!options.force) {
      actions.push({ kind: "skipped", path: dest, detail: "exists (not a symlink)" });
      return;
    }
    if (!options.dryRun) rmSync(dest, { recursive: true, force: true });
  }

  if (options.dryRun) {
    actions.push({ kind: "would", path: dest, detail: `symlink -> ${relativeTarget}` });
    return;
  }

  mkdirSync(path.dirname(dest), { recursive: true });
  symlinkSync(relativeTarget, dest);
  actions.push({ kind: "symlinked", path: dest, detail: `-> ${relativeTarget}` });
}

function removeGeneratedAssets(projectRoot: string, preExisting: { commands: Set<string>; skills: Set<string> }, options: Options, actions: Action[]) {
  const specs = [
    { dir: path.join(projectRoot, ".opencode", "command"), before: preExisting.commands },
    { dir: path.join(projectRoot, ".opencode", "commands"), before: preExisting.commands },
    { dir: path.join(projectRoot, ".opencode", "skill"), before: preExisting.skills },
    { dir: path.join(projectRoot, ".opencode", "skills"), before: preExisting.skills },
  ];

  for (const spec of specs) {
    if (!existsSync(spec.dir)) continue;
    for (const name of readdirSync(spec.dir)) {
      if (!/^(opsx|openspec)-/.test(name)) continue;
      if (spec.before.has(name)) {
        actions.push({ kind: "skipped", path: path.join(spec.dir, name), detail: "pre-existing OpenCode asset" });
        continue;
      }
      const target = path.join(spec.dir, name);
      if (options.dryRun) {
        actions.push({ kind: "would", path: target, detail: "remove generated OpenSpec/OpenCode asset" });
        continue;
      }
      if (lstatSync(target).isSymbolicLink()) {
        unlinkSync(target);
      } else {
        rmSync(target, { recursive: true, force: true });
      }
      actions.push({ kind: "removed", path: target, detail: "generated OpenSpec/OpenCode asset" });
    }
  }
}

function validateTemplate(templateDir: string) {
  const configPath = path.join(templateDir, "opencode.json");
  if (!existsSync(configPath)) throw new Error(`Missing template asset: ${configPath}`);
  try {
    JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`Template opencode.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function generateManifest(projectRoot: string, options: Options, actions: Action[]) {
  const od = path.join(projectRoot, ".opencode");
  const mp = path.join(od, "openext.json");

  if (existsSync(mp) && !options.force) {
    actions.push({ kind: "skipped", path: mp, detail: "openext.json already exists" });
    return;
  }

  if (options.dryRun) {
    actions.push({ kind: "would", path: mp, detail: "generate default openext.json manifest" });
    return;
  }

  mkdirSync(od, { recursive: true });
  writeFileSync(mp, JSON.stringify(DEFAULT_OPSX_MANIFEST, null, 2) + "\n", "utf-8");
  actions.push({ kind: "created", path: mp, detail: "default OPSX manifest" });
}

function printActions(actions: Action[]) {
  const groups = ["ran", "created", "removed", "copied", "symlinked", "updated", "skipped", "would", "error"] as const;
  for (const group of groups) {
    const items = actions.filter((action) => action.kind === group);
    if (items.length === 0) continue;
    console.log(`\n${group.toUpperCase()}`);
    for (const item of items) {
      console.log(`- ${item.path ? `${item.path}: ` : ""}${item.detail}`);
    }
  }
}

function main() {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const { projectRoot, prdPath } = resolveProjectRoot(options);
  validateTemplate(defaultTemplateDir);

  const actions: Action[] = [];

  // Step 1: Generate default .opencode/openext.json manifest
  generateManifest(projectRoot, options, actions);

  // Step 2: Run openspec init --tools opencode
  if (!options.skipOpenSpecInit) runCommand("openspec", ["init", "--tools", "opencode"], projectRoot, options, actions);

  // Step 3: Remove generated opsx-/openspec- commands and skills
  const preExisting = {
    commands: new Set([
      ...listNames(path.join(projectRoot, ".opencode", "command")),
      ...listNames(path.join(projectRoot, ".opencode", "commands")),
    ]),
    skills: new Set([
      ...listNames(path.join(projectRoot, ".opencode", "skill")),
      ...listNames(path.join(projectRoot, ".opencode", "skills")),
    ]),
  };
  removeGeneratedAssets(projectRoot, preExisting, options, actions);

  // Step 4: Copy opencode.json to project root (always a copy — OpenCode writes back to it)
  const opencodeSrc = path.join(defaultTemplateDir, "opencode.json");
  const opencodeDest = path.join(projectRoot, "opencode.json");
  copyManagedFile(opencodeSrc, opencodeDest, options, actions);

  // Step 4b: Symlink scaffold-specific files not managed by openext
  for (const file of ["runtime-session-info.md", "system-files.json"]) {
    const src = path.join(defaultTemplateDir, file);
    if (existsSync(src)) {
      const dest = path.join(projectRoot, ".opencode", file);
      ensureSymlink(src, dest, options, actions);
    }
  }

  // Step 5: Run openext init to create all extension symlinks from the manifest
  const openextPath = options.openextPath.replace(/^~/, os.homedir());
  const openextArgs = [openextPath, "init", projectRoot];
  if (options.force) openextArgs.push("--force");
  runCommand("bun", openextArgs, projectRoot, options, actions);

  // Step 6: Initialize git when .git is absent
  if (!options.skipGit && !existsSync(path.join(projectRoot, ".git"))) {
    runCommand("git", ["init"], projectRoot, options, actions);
  } else if (existsSync(path.join(projectRoot, ".git"))) {
    actions.push({ kind: "skipped", path: path.join(projectRoot, ".git"), detail: "git repository already exists" });
  }

  // Ensure .opencode/ is in .gitignore
  ensureGitignoreEntry(projectRoot, ".opencode/", "OpenCode config (managed by openext — recreate with opsx-scaffold)", options, actions);

  console.log(`OPSX scaffold target: ${projectRoot}`);
  if (prdPath) console.log(`PRD input: ${prdPath}`);
  printActions(actions);
  console.log("\nNext: inspect the project and create or update AGENTS.md through the openspec-scaffold skill interview.");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
