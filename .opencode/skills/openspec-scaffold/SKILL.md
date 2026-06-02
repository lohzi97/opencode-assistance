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

The script is conservative by default:

- Runs `openspec init --tools opencode` unless `--skip-openspec-init` is supplied.
- Records pre-existing `.opencode/command`, `.opencode/commands`, `.opencode/skill`, and `.opencode/skills` entries before initialization.
- Removes only newly generated `opsx-*` and `openspec-*` commands/skills created by initialization.
- Copies `template/opencode.json` to the target project root as `opencode.json`.
- Recursively copies every other file and directory in `template/` into the target project's `.opencode/` directory.
- This means new template agents, plugins, skills, commands, or other OpenCode assets are included automatically when placed under `template/`.
- Skips existing target files unless `--force` is supplied.
- Initializes git when `.git` is absent, unless `--skip-git` is supplied.
- Never commits changes.

Useful options:

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --dry-run <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --force <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --skip-git <project-or-prd-path>
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --skip-openspec-init <project-or-prd-path>
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
- `.opencode/agents/levi.md` exists.
- `.opencode/plugins/stuck-watcher.ts` exists.
- `.opencode/stuck-watcher.jsonc` exists.
- `.opencode/skills/openspec-propose/SKILL.md` exists.
- `.opencode/skills/openspec-apply-change/SKILL.md` exists.
- `.opencode/skills/openspec-test/SKILL.md` exists.
- `openspec/` exists after initialization, unless intentionally skipped.
- `.git/` exists after initialization, unless intentionally skipped.
- `AGENTS.md` exists and reflects the project/PRD.

Also run lightweight validation where feasible:

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --dry-run <project-or-prd-path>
git -C <project-path> status --short
```

If an OpenCode config, agent, skill, or plugin file was created or changed, remind Master that running OpenCode sessions must be restarted before those config-time changes take effect.
