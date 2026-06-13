---
name: openspec-scaffold
description: Use when preparing a project for OPSX/OpenSpec orchestration workflow: run opsx-scaffold, install project-local OpenCode agents/plugins/openspec skills, initialize OpenSpec/git, and interview the user before creating AGENTS.md.
---

# OpenSpec Scaffold

Use this skill when user wants to prepare a target project for the OPSX/OpenSpec orchestration workflow before running `opsx-orchestrate`.

This is a one-time manually triggered setup skill. The autonomous `opsx-orchestrate` workflow should assume this scaffold has already been completed and should not perform scaffold work itself.

## Prerequisites

Before doing anything else, verify that both CLIs are installed and on PATH:

```sh
which openext
which openspec
```

If either is missing, **pause immediately** and inform the user. Tell them which tool is missing and how to install it:

- `openext` — clone the hub and run the install script: `git clone git@github.com:sebastianloh97/openext.git ~/openext && bash ~/openext/install.sh`
- `openspec` — install via the OpenSpec CLI's own setup instructions.

Do not proceed until both are confirmed available.

## Inputs

Accept either:

- A target project directory.
- A PRD file path. When a PRD path is given, use the PRD file's parent directory as the project directory.

If neither path is explicit, ask the user for the project directory or PRD path before running any setup.

## Workflow

1. Confirm the target path.
2. Run the scaffold script from this skill directory:

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts <project-or-prd-path>
```

3. If the target project already has `opencode.json` or `.opencode/openext.json`, the script skips them. Inspect and discuss any needed manual merge with the user.
4. Analyze the project or PRD before creating `AGENTS.md`.
5. Interview the user until the project-specific operating context is clear.
6. Create or update `AGENTS.md` in the project root.
7. Verify the scaffold and report readiness for `opsx-orchestrate`.

## Scaffold Script Flow

The script does exactly 4 things:

1. **Ensure OpenSpec is initialized** — checks if `openspec/` exists. If not, runs `openspec init --tools opencode`, then removes the auto-generated `opsx-*`/`openspec-*` commands and skills (these are replaced by openext-managed versions). Pre-existing entries are preserved.
2. **Copy template files** — copies `template/opencode.json` to the project root (always a copy because OpenCode writes back to it) and `template/openext.json` to `.opencode/openext.json`. Both are skipped if they already exist (use `--force` to overwrite).
3. **Run `openext init`** — creates all extension symlinks from the manifest. This is idempotent: re-running creates only missing symlinks and removes stale ones.
4. **Initialize git** — runs `git init` when `.git` is absent.

The script also ensures `.opencode/` is listed in `.gitignore`.

All extension management (agents, skills, plugins, scripts, config) is handled by `openext`. To add or remove individual extensions after scaffolding, use the openext CLI directly:

```sh
openext add skills/chrome <project-path>
openext remove skills/chrome <project-path>
openext init <project-path>
openext status <project-path>
```

### Useful Options

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

The `OpenSpec / OPSX Workflow` section should tell future workers that this project uses OPSX/OpenSpec workflow, that project-local `openspec-*` skills are available, and that spawned worker sessions should follow the assigned skill rather than slash commands.

## Verification

After setup, verify at minimum:

- `opencode.json` exists or was intentionally skipped due to an existing config.
- `.opencode/openext.json` exists and contains the expected extension manifest.
- `openspec/` exists after initialization, unless intentionally skipped.
- `.git/` exists after initialization, unless intentionally skipped.
- `AGENTS.md` exists and reflects the project/PRD.

Run openext status to verify all extension symlinks are healthy:

```sh
openext status <project-path>
```

Also run lightweight validation where feasible:

```sh
bun .opencode/skills/openspec-scaffold/scripts/opsx-scaffold.ts --dry-run <project-or-prd-path>
git -C <project-path> status --short
```

If an OpenCode config, agent, skill, or plugin file was created or changed, remind the user that running OpenCode sessions must be restarted before those config-time changes take effect.
