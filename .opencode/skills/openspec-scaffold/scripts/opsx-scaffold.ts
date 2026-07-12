#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

type Options = {
  input?: string;
  project?: string;
  prd?: string;
  dryRun: boolean;
  force: boolean;
  skipGit: boolean;
  skipOpenSpecInit: boolean;
  help: boolean;
};

type Action = {
  kind: "created" | "copied" | "skipped" | "removed" | "ran" | "would" | "updated" | "error";
  path?: string;
  detail: string;
};

const skillDir = path.resolve(import.meta.dir, "..");
const defaultTemplateDir = path.join(skillDir, "template");

function usage() {
  return `Usage: bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts [options] <project-or-prd-path>

Prepare a project for Master's OPSX/OpenSpec orchestration workflow.

Prerequisites:
  - 'openext' must be installed and on PATH (run ~/openext/install.sh)
  - 'openspec' must be installed and on PATH

Inputs:
  <project-or-prd-path>       Directory to scaffold, or a PRD file whose parent directory is the project root.
  --project <path>            Explicit project directory.
  --prd <path>                PRD file; its parent directory is used as the project root.

Options:
  --dry-run                   Show intended changes without writing files or running commands.
  --force                     Overwrite files that already exist.
  --skip-git                  Do not initialize git when .git is missing.
  --skip-openspec-init        Do not run openspec init.
  --help                      Show this help.

Flow:
  1. Ensure openspec is initialized (run openspec init if needed, then remove auto-generated files).
  2. Copy opencode.json and openext.json from template/ if they do not exist.
  3. Run openext init to create all extension symlinks.
  4. Initialize git when .git is absent.`;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
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

// ─── Helpers ────────────────────────────────────────────────────────

function runCommand(command: string, args: string[], cwd: string, options: Options, actions: Action[], captureStdio = false) {
  const rendered = [command, ...args].join(" ");
  if (options.dryRun) {
    actions.push({ kind: "would", detail: `run ${rendered} in ${cwd}` });
    return;
  }

  const result = spawnSync(command, args, {
    cwd,
    stdio: captureStdio ? ["pipe", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${rendered} failed with exit code ${result.status}`);
  actions.push({ kind: "ran", detail: `${rendered} in ${cwd}` });
  return result.stdout?.toString().trim();
}

function listNames(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set<string>();
  return new Set(readdirSync(dir));
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

// ─── Step 1: Ensure OpenSpec is initialized ────────────────────────

function ensureOpenSpec(projectRoot: string, options: Options, actions: Action[]) {
  if (options.skipOpenSpecInit) {
    actions.push({ kind: "skipped", detail: "openspec init skipped (--skip-openspec-init)" });
    return;
  }

  // Check if already openspec-ready
  const openspecDir = path.join(projectRoot, "openspec");
  if (existsSync(openspecDir)) {
    actions.push({ kind: "skipped", path: openspecDir, detail: "openspec already initialized" });
    return;
  }

  // Snapshot pre-existing OpenCode assets
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

  // Run openspec init
  runCommand("openspec", ["init", "--tools", "opencode"], projectRoot, options, actions);

  // Remove auto-generated opsx-/openspec- commands and skills
  // (these are replaced by openext-managed versions)
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

// ─── Step 2: Copy template files ───────────────────────────────────

function copyTemplates(projectRoot: string, options: Options, actions: Action[]) {
  const templates = ["opencode.json", "openext.json"];
  for (const file of templates) {
    const src = path.join(defaultTemplateDir, file);
    if (!existsSync(src)) throw new Error(`Missing template asset: ${src}`);
    const dest = file === "openext.json"
      ? path.join(projectRoot, ".opencode", "openext.json")
      : path.join(projectRoot, file);
    copyManagedFile(src, dest, options, actions);
  }
}

// ─── Step 3: Run openext init ──────────────────────────────────────

function runOpenextInit(projectRoot: string, options: Options, actions: Action[]) {
  const args = ["init", projectRoot];
  if (options.force) args.push("--force");
  runCommand("openext", args, projectRoot, options, actions);
}

// ─── Step 4a: Ensure .opencode/.gitignore exists ───────────────────

function ensureOpenextGitignore(projectRoot: string, options: Options, actions: Action[]) {
  const gitignorePath = path.join(projectRoot, ".opencode", ".gitignore");
  const templatePath = path.join(defaultTemplateDir, "opencode-gitignore");

  if (!existsSync(templatePath)) throw new Error(`Missing template asset: ${templatePath}`);

  if (existsSync(gitignorePath) && !options.force) {
    actions.push({ kind: "skipped", path: gitignorePath, detail: "exists" });
    return;
  }

  if (options.dryRun) {
    actions.push({ kind: "would", path: gitignorePath, detail: `${existsSync(gitignorePath) ? "overwrite" : "copy"} from ${templatePath}` });
    return;
  }

  mkdirSync(path.dirname(gitignorePath), { recursive: true });
  copyFileSync(templatePath, gitignorePath);
  actions.push({ kind: "copied", path: gitignorePath, detail: `from ${templatePath}` });
}

// ─── Step 4b: Initialize git ───────────────────────────────────────

function ensureGit(projectRoot: string, options: Options, actions: Action[]) {
  if (options.skipGit) {
    actions.push({ kind: "skipped", detail: "git init skipped (--skip-git)" });
    return;
  }
  if (existsSync(path.join(projectRoot, ".git"))) {
    actions.push({ kind: "skipped", path: path.join(projectRoot, ".git"), detail: "git repository already exists" });
    return;
  }
  runCommand("git", ["init"], projectRoot, options, actions);
}

// ─── Output ────────────────────────────────────────────────────────

function printActions(actions: Action[]) {
  const groups = ["ran", "created", "removed", "copied", "updated", "skipped", "would", "error"] as const;
  for (const group of groups) {
    const items = actions.filter((a) => a.kind === group);
    if (items.length === 0) continue;
    console.log(`\n${group.toUpperCase()}`);
    for (const item of items) {
      console.log(`- ${item.path ? `${item.path}: ` : ""}${item.detail}`);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────

function main() {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const { projectRoot, prdPath } = resolveProjectRoot(options);

  const actions: Action[] = [];

  // Step 1: Ensure openspec is initialized
  ensureOpenSpec(projectRoot, options, actions);

  // Step 2: Copy template files (opencode.json, openext.json)
  copyTemplates(projectRoot, options, actions);

  // Step 3: Run openext init to create all extension symlinks
  runOpenextInit(projectRoot, options, actions);

  // Step 4a: Ensure .opencode/.gitignore exists (ignores openext-linked artifacts, commits openext.json)
  ensureOpenextGitignore(projectRoot, options, actions);

  // Step 4b: Initialize git when .git is absent
  ensureGit(projectRoot, options, actions);

  console.log(`\nOPSX scaffold target: ${projectRoot}`);
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
