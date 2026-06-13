---
name: openspec-scaffold
description: Use when preparing a project for Master's OPSX/OpenSpec orchestration workflow: run opsx-scaffold, install project-local OpenCode agents/plugins/openspec skills, initialize OpenSpec/git, and interview the user before creating AGENTS.md.
---

# OpenSpec Scaffold

Use this skill when Master wants to prepare a target project for the OPSX/OpenSpec orchestration workflow before running `opsx-orchestrate`.

This is a one-time manually triggered setup skill. The autonomous `opsx-orchestrate` workflow should assume this scaffold has already been completed and should not perform scaffold work itself.

## Grounding

Master's OPSX workflow is recorded in:

- `notes/my-opsx-workflow.md`
- `notes/20260602-opsx-orchestration-workflow.md`

Important orchestration facts:

- Sebastian remains the long-lived planner/orchestrator.
- Short-lived worker sessions are spawned in the target project directory.
- Agent-collab messages cannot trigger slash commands, so workers must use project-local `openspec-*` skills directly.
- The target project must therefore contain the OpenCode configuration, `levi` agent, `stuck-watcher` plugin, and custom `openspec-*` skills before orchestration begins.

## Inputs

Accept either:

- A target project directory.
- A PRD file path. When a PRD path is given, use the PRD file's parent directory as the project directory.

If neither path is explicit, ask Master for the project directory or PRD path before running any setup.

## Workflow

1. Confirm the target path.
2. Run the scaffold script from this skill directory:

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts <project-or-prd-path>
```

3. If the target project already has meaningful local `opencode.json` configuration, do not auto-merge it. The script skips existing files by default. Inspect and discuss any needed manual merge with Master.
4. Analyze the project or PRD before creating `AGENTS.md`.
5. Interview Master until the project-specific operating context is clear.
6. Create or update `AGENTS.md` in the project root.
7. Verify the scaffold and report readiness for `opsx-orchestrate`.

## Scaffold Script Behavior

The script generates a default `.opencode/openext.json` manifest and delegates extension management to `openext init`. The 6-step flow is:

1. **Generate manifest** — writes `.opencode/openext.json` with the default OPSX extension set (agents, skills, plugins, scripts, config). Skipped if the manifest already exists (use `--force` to overwrite).
2. **Run `openspec init --tools opencode`** — initializes the OpenSpec directory and generates `opsx-`/`openspec-` commands and skills. Skipped if `--skip-openspec-init` is supplied.
3. **Remove generated assets** — deletes only newly created `opsx-*` and `openspec-*` entries from `.opencode/commands/` and `.opencode/skills/` (these are replaced by openext-managed versions). Pre-existing entries are preserved.
4. **Copy `opencode.json`** — copies `template/opencode.json` to the project root. Always a copy (never a symlink) because OpenCode writes back to this file. Symlinks scaffold-specific files (`runtime-session-info.md`, `system-files.json`) into `.opencode/`.
5. **Run `openext init`** — creates all extension symlinks from the manifest using the openext hub at `~/openext/`. This is idempotent: re-running creates only missing symlinks and removes stale ones. Passes `--force` to openext when the scaffold `--force` flag is set.
6. **Initialize git** — runs `git init` when `.git` is absent, unless `--skip-git` is supplied.

The script also ensures `.opencode/` is listed in `.gitignore`.

### Extension Management

All extension symlinks (agents, skills, plugins, scripts, config) are managed by `openext`. To add or remove individual extensions after scaffolding, use the openext CLI directly:

```sh
bun ~/openext/cli.ts add skills/chrome <project-path>
bun ~/openext/cli.ts remove skills/chrome <project-path>
```

To reconcile all symlinks with the manifest (e.g., after adding new extensions to `openext.json`):

```sh
bun ~/openext/cli.ts init <project-path>
```

### Useful Options

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --dry-run <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --force <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --skip-git <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --skip-openspec-init <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --openext-path ~/custom/openext/cli.ts <project-or-prd-path>
```

## AGENTS.md Interview

Before writing `AGENTS.md`, inspect the project and ask only questions needed to avoid guessing. Cover these topics when they are not already clear from code or PRD:

- Project overview and product purpose.
- Target users and important domain concepts.
- Directory structure and ownership boundaries.
- Development commands: install, dev server, build, lint, typecheck, test, migration, seed, format.
- Runtime versions and package managers.
- Coding conventions and architecture preferences.
- Testing expectations and required verification level.
- Environment variables, secrets handling, and local service dependencies.
- Database, storage, queue, cache, browser, or external API dependencies.
- Deployment target and production-impacting commands to avoid.
- Files, directories, generated assets, or external systems agents must not touch.
- Additional references: PRD, design docs, API docs, tickets, diagrams, or existing notes.

## AGENTS.md Structure

Use this structure unless the project clearly needs a small variation:

```md
# AGENTS.md

## Project Overview

## Directory Structure

## Development Commands

## Coding Conventions

## Testing And Verification

## OpenSpec / OPSX Workflow

## Environment And Secrets

## Safety Rules

## Additional Resources
```

The `OpenSpec / OPSX Workflow` section should tell future workers that this project uses Master's OPSX/OpenSpec workflow, that project-local `openspec-*` skills are available, and that spawned worker sessions should follow the assigned skill rather than slash commands.

## Verification

After setup, verify at minimum:

- `opencode.json` exists or was intentionally skipped due to an existing config.
- `.opencode/openext.json` exists and contains the expected extension manifest.
- `.opencode/agents/levi.md` exists (symlinked by openext).
- `.opencode/plugins/stuck-watcher.ts` exists (symlinked by openext).
- `.opencode/stuck-watcher.jsonc` exists (symlinked by openext).
- `.opencode/skills/openspec-propose/SKILL.md` exists (symlinked by openext).
- `.opencode/skills/openspec-apply-change/SKILL.md` exists (symlinked by openext).
- `.opencode/skills/openspec-test/SKILL.md` exists (symlinked by openext).
- `openspec/` exists after initialization, unless intentionally skipped.
- `.git/` exists after initialization, unless intentionally skipped.
- `AGENTS.md` exists and reflects the project/PRD.

Run openext status to verify all extension symlinks are healthy:

```sh
bun ~/openext/cli.ts status <project-path>
```

Also run lightweight validation where feasible:

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --dry-run <project-or-prd-path>
git -C <project-path> status --short
```

If an OpenCode config, agent, skill, or plugin file was created or changed, remind Master that running OpenCode sessions must be restarted before those config-time changes take effect.
