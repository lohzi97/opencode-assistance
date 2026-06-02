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
} from "node:fs";
import path from "node:path";

type Options = {
  input?: string;
  project?: string;
  prd?: string;
  templateDir: string;
  dryRun: boolean;
  force: boolean;
  skipGit: boolean;
  skipOpenSpecInit: boolean;
  help: boolean;
};

type Action = {
  kind: "created" | "copied" | "skipped" | "removed" | "ran" | "would" | "error";
  path?: string;
  detail: string;
};

const skillDir = path.resolve(import.meta.dir, "..");
const defaultTemplateDir = path.join(skillDir, "template");

function usage() {
  return `Usage: bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts [options] <project-or-prd-path>

Prepare a project for Master's OPSX/OpenSpec orchestration workflow.

Inputs:
  <project-or-prd-path>       Directory to scaffold, or a PRD file whose parent directory is the project root.
  --project <path>            Explicit project directory.
  --prd <path>                PRD file; its parent directory is used as the project root.

Options:
  --template-dir <path>       Template directory. Defaults to this skill's template directory.
  --dry-run                   Show intended changes without writing files or running commands.
  --force                     Overwrite template-managed files that already exist.
  --skip-git                  Do not initialize git when .git is missing.
  --skip-openspec-init        Do not run openspec init.
  --help                      Show this help.

Default behavior is conservative: existing files are skipped, not overwritten.`;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    templateDir: defaultTemplateDir,
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
      case "--template-dir":
        options.templateDir = readValue(argv, ++i, arg);
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

function copyTree(srcDir: string, destDir: string, options: Options, actions: Action[]) {
  if (!existsSync(srcDir)) return;
  for (const entry of readdirSync(srcDir)) {
    const src = path.join(srcDir, entry);
    const dest = path.join(destDir, entry);
    const st = lstatSync(src);
    if (st.isDirectory()) {
      ensureDir(dest, options, actions);
      copyTree(src, dest, options, actions);
      continue;
    }
    if (st.isFile()) copyManagedFile(src, dest, options, actions);
  }
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
      rmSync(target, { recursive: true, force: true });
      actions.push({ kind: "removed", path: target, detail: "generated OpenSpec/OpenCode asset" });
    }
  }
}

function copyTemplate(projectRoot: string, templateDir: string, options: Options, actions: Action[]) {
  for (const entry of readdirSync(templateDir)) {
    const src = path.join(templateDir, entry);
    const dest = entry === "opencode.json" ? path.join(projectRoot, entry) : path.join(projectRoot, ".opencode", entry);
    const st = lstatSync(src);
    if (st.isDirectory()) {
      ensureDir(dest, options, actions);
      copyTree(src, dest, options, actions);
      continue;
    }
    if (st.isFile()) copyManagedFile(src, dest, options, actions);
  }
}

function validateTemplate(templateDir: string) {
  const required = [
    "opencode.json",
    "stuck-watcher.jsonc",
    path.join("agents", "levi.md"),
    path.join("plugins", "stuck-watcher.ts"),
    "skills",
  ];
  for (const rel of required) {
    const target = path.join(templateDir, rel);
    if (!existsSync(target)) throw new Error(`Missing template asset: ${target}`);
  }

  const configPath = path.join(templateDir, "opencode.json");
  try {
    JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    throw new Error(`Template opencode.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function printActions(actions: Action[]) {
  const groups = ["ran", "created", "removed", "copied", "skipped", "would", "error"] as const;
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
  const templateDir = path.resolve(options.templateDir);
  validateTemplate(templateDir);

  const actions: Action[] = [];
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

  if (!options.skipOpenSpecInit) runCommand("openspec", ["init", "--tools", "opencode"], projectRoot, options, actions);
  removeGeneratedAssets(projectRoot, preExisting, options, actions);
  copyTemplate(projectRoot, templateDir, options, actions);

  if (!options.skipGit && !existsSync(path.join(projectRoot, ".git"))) {
    runCommand("git", ["init"], projectRoot, options, actions);
  } else if (existsSync(path.join(projectRoot, ".git"))) {
    actions.push({ kind: "skipped", path: path.join(projectRoot, ".git"), detail: "git repository already exists" });
  }

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
