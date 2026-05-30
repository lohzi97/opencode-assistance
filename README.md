# opencode-assistant

`opencode-assistant` is a personal assistant workspace built around [OpenCode](https://opencode.ai/). It keeps OpenCode as the underlying agent runtime, then layers project-local services, plugins, skills, commands, memory, notes, and operational scripts on top so OpenCode behaves less like a bare coding tool and more like a persistent digital aide.

The project is intentionally a wrapper and extension layer. It avoids modifying upstream OpenCode source unless absolutely necessary, and instead uses OpenCode configuration, plugins, MCP servers, local worker services, and repository-managed prompts to customize behavior.

For installation and operator setup, see [`README_HUMAN.md`](README_HUMAN.md).

## Purpose

This repository exists to give Sebastian, the OpenCode assistant persona, a durable operating environment.

It provides:

- A default `sebastian` agent profile with project-specific instructions and tools.
- A project worker that runs background services beside `opencode serve`.
- Custom OpenCode plugins for session export, system-file injection, session titles, compaction prompts, stuck-session recovery, and notifications.
- A memory and notes layer for long-term continuity across sessions.
- Proactive task automation for scheduled or event-driven assistant work.
- Custom compaction behavior to preserve long-running work across context limits.
- Agent collaboration infrastructure for room-based coordination between OpenCode sessions.
- OpenSpec artifacts for planning and validating larger changes before implementation.

## Runtime Architecture

At runtime, the project is normally started with [`start.sh`](start.sh). That script starts two tmux sessions:

- `opencode-assistant-backend`: runs `opencode serve`.
- `opencode-assistant-worker`: runs `.opencode/server/index.ts` with Bun.

The backend remains the OpenCode API, session, model, tool, and web UI runtime. The worker is this repository's sidecar process. It talks to the backend over OpenCode HTTP APIs and listens to `/global/event` so local services can react to session status, message updates, compaction events, and other bus events.

```text
OpenCode Web UI / TUI
        |
        v
OpenCode backend (`opencode serve`)
        |
        | HTTP API + /global/event SSE
        v
Project worker (`.opencode/server/index.ts`)
        |
        |-- CompactionService
        |-- ProactiveService
        |-- CollabService
        |
        v
Repository state, notes, memory, scripts, plugins, and external MCP services
```

## Repository Map

| Path | Role |
|---|---|
| `opencode.json` | OpenCode configuration for default model, default agent, plugins, permissions, and MCP servers. |
| `.opencode/agents/` | Custom OpenCode agents, including `sebastian` and `shalltear`. |
| `.opencode/server/` | Bun worker services that extend OpenCode outside the plugin runtime. |
| `.opencode/plugins/` | OpenCode plugins loaded by the OpenCode runtime. |
| `.opencode/commands/` | Custom slash commands for diary, memory, OpenSpec, and workflow operations. |
| `.opencode/skills/` | Reusable skill instructions for specialized workflows. |
| `.opencode/scripts/` | Local helper CLIs and maintenance scripts. |
| `.opencode/server.jsonc` | Worker configuration for compaction, proactive tasks, and collaboration. |
| `memory/canonical/` | Approved prompt-grade memory injected into Sebastian's working context. |
| `memory/candidates/` | Pending memory candidates awaiting review and promotion. |
| `notes/` | Durable long-term project and research notes, indexed by `qmd`. |
| `journals/` | Automatically written session and daily history. |
| `openspec/` | OpenSpec change proposals, archived changes, and durable capability specs. |
| `start.sh`, `stop.sh`, `restart.sh`, `tui.sh` | Operator scripts for running the assistant stack. |
| `README_HUMAN.md` | Human setup and configuration guide. |

## Core Subsystems

### OpenCode Configuration

[`opencode.json`](opencode.json) configures OpenCode itself. It sets the default model and default agent, disables unused built-in agents, disables built-in auto-compaction, loads plugins, and declares MCP servers such as computer control, Brave Search, Google Workspace, IMAP, and Chrome DevTools.

This file controls the OpenCode runtime. The worker-specific behavior lives separately in `.opencode/server.jsonc`.

### Project Worker

The worker entrypoint is [`.opencode/server/index.ts`](.opencode/server/index.ts). It creates one shared `OpenCodeClient`, starts the configured services, and attaches one global event listener.

Current worker services:

| Service | File | Responsibility |
|---|---|---|
| `CompactionService` | `.opencode/server/compaction.ts` | Monitors token usage, aborts sessions at configured thresholds, creates summarization handoffs, and starts continuation sessions. |
| `ProactiveService` | `.opencode/server/proactive.ts` | Schedules and dispatches proactive tasks from `.opencode/server.jsonc`, including anchor sessions, isolated sessions, and exec jobs. |
| `CollabService` | `.opencode/server/collab.ts` | Provides room-based collaboration between OpenCode sessions, including messages, membership, delivery modes, Q&A, spawn, and close-drain behavior. |

Shared backend integration types and helpers live in [`.opencode/server/shared.ts`](.opencode/server/shared.ts). Worker configuration parsing lives in [`.opencode/server/config.ts`](.opencode/server/config.ts).

### Plugins

Plugins run inside OpenCode's plugin environment and are used when behavior belongs directly at the OpenCode hook/event layer.

Notable plugins:

| Plugin | Purpose |
|---|---|
| `system-files.ts` | Injects project files such as runtime session info and memory into assistant context. |
| `export-session.ts` | Exports session transcripts into the journal structure. |
| `session-title.ts` | Applies project-specific session title behavior. |
| `compaction-prompts.ts` | Customizes manual and automatic compaction prompts. |
| `stuck-watcher.ts` | Detects sessions that are busy without output and sends recovery prompts after aborting. |
| `telegram-ping.ts` | Sends Telegram notifications. |
| `file-check.ts` | Provides file-size and file-safety checks. |

The distinction is deliberate: plugins handle OpenCode hook behavior, while `.opencode/server/` handles longer-running sidecar services and stateful orchestration.

### Memory, Notes, And Journals

Sebastian uses layered context rather than relying on raw chat history alone.

| Layer | Purpose |
|---|---|
| `memory/canonical/` | Approved durable memory that may be injected into prompts. |
| `memory/candidates/` | Proposed memory updates that require review before promotion. |
| `memory/private/` | Deliberate private memory not treated as ordinary public project notes. |
| `notes/` | Long-term knowledge base for project decisions, research, PRDs, and technical findings. |
| `journals/` | Automatically generated raw and summarized history from assistant sessions. |

The `notes/` collection is indexed with `qmd` so Sebastian can retrieve prior findings through the `search-notes` skill. Journals are searched separately through the `search-journals` skill when exact historical conversation context is needed.

### Proactive Automation

The proactive system lets Sebastian act on schedules or events instead of waiting for direct user prompts.

Configuration lives under the `proactive` block in [`.opencode/server.jsonc`](.opencode/server.jsonc). Tasks can run in three modes:

| Mode | Description |
|---|---|
| `anchor-session` | Maintains a longer-running session window for a task, with end, rollover, and retrigger instructions. |
| `isolated-session` | Creates a fresh session for a bounded task. |
| `exec` | Runs a configured shell command, often for maintenance workflows. |

Runtime state is stored under `.opencode/server/state/`. Helper management commands are provided through `.opencode/scripts/proactive-cli.ts` and the `manage-proactive-tasks` / `configure-proactive-task` skills.

### Compaction Management

OpenCode's built-in auto-compaction is disabled in `opencode.json`. This project replaces it with a sidecar compaction manager.

The custom compaction service monitors assistant messages and model context usage. When a session crosses the configured threshold, it aborts the source session, summarizes relevant context into a temporary session, creates a continuation session, and tracks the continuation chain in `.opencode/server/state/compaction-state.json`.

This keeps long-running assistant work recoverable and gives the project more control over model-specific thresholds, carryover content, temporary session cleanup, and title naming.

### Agent Collaboration

The collaboration service turns multiple OpenCode sessions into members of a managed room so agents can coordinate through structured messages rather than brittle file polling or TUI automation.

The service is implemented in [`.opencode/server/collab.ts`](.opencode/server/collab.ts). It provides:

- Room creation, status, listing, and terminal closure.
- Planner-managed membership, password self-join, leave, remove, and spawn.
- Room-wide transcript storage and member-scoped delivery views.
- Buffered delivery, immediate soft delivery, and planner-only hard interrupt delivery.
- Public room messages that act like pinned shared context.
- Question and answer workflows with blocker semantics.
- SQLite-backed persistence at `.opencode/server/state/collab.sqlite`.

The agent-facing CLI lives in [`.opencode/scripts/agent-collab.ts`](.opencode/scripts/agent-collab.ts). The original product design is recorded in [`notes/agent-collaboration.md`](notes/agent-collaboration.md), while durable behavioral contracts live in `openspec/specs/`.

### Commands And Skills

Custom commands under `.opencode/commands/` are user-facing slash-command workflows. They cover diary writing, memory extraction, session summarization, OpenSpec workflows, and other repeated assistant procedures.

Skills under `.opencode/skills/` are reusable instruction packs. They tell Sebastian how to perform specialized tasks such as searching notes, managing proactive tasks, restarting the stack, using OpenSpec, using Antigravity web search, or creating new custom agents and skills.

In practice, commands are invoked directly by a user or prompt, while skills are loaded by the assistant when a task matches a known workflow.

### OpenSpec

OpenSpec is used for spec-driven development of larger changes. Active changes live under `openspec/changes/`, completed change history lives under `openspec/changes/archive/`, and durable main specs live under `openspec/specs/`.

The intended role of OpenSpec in this repository is to keep behavioral contracts clear before and after implementation. PRDs and design notes may live in `notes/`, but OpenSpec specs should be the concise, validated source of truth for requirements and scenarios that future changes must preserve.

## Operational Lifecycle

Typical operation:

1. Run `./start.sh` to start the OpenCode backend, worker, and supporting services.
2. Use the OpenCode web UI or `./tui.sh` to interact with Sebastian.
3. The backend executes ordinary OpenCode sessions, agents, tools, plugins, and MCP calls.
4. The worker listens to backend events and runs compaction, proactive automation, and collaboration services.
5. Plugins and scripts export history into journals, update notes and memory workflows, and support long-term continuity.
6. Run `./stop.sh` or `./restart.sh` when operational changes require a restart.

For detailed setup, credentials, and MCP configuration, use [`README_HUMAN.md`](README_HUMAN.md).

## Design Principles

- Keep upstream OpenCode untouched where possible.
- Prefer small project-local extensions over broad forks.
- Keep durable memory curated and explicit.
- Prefer custom OpenCode skills and commands over redundant shell wrappers when the workflow is primarily assistant-driven.
- Treat `.opencode/server/` as the stateful orchestration layer and `.opencode/plugins/` as OpenCode hook extensions.
