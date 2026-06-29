---
name: manage-proactive-tasks
description: Inspect, query, and manage proactive tasks, queue state, and active runs; run tasks on-demand, remove or edit queued items, and provide human-readable summaries and live monitoring.
---

# Manage Proactive Tasks

Use this skill when the Master wants runtime proactive task operations, not config authoring.

This skill is for requests such as:

- "Show me all proactive tasks and queued items."
- "Add an ad-hoc proactive task to the queue."
- "Edit this queued task so it runs later with higher priority."
- "Remove that queued item."
- "Run this configured proactive task now."

This skill must:

1. inspect the current proactive state first when that helps avoid mistakes
2. choose the correct proactive CLI subcommand
3. build valid JSON payloads for add and edit operations
4. execute the CLI through Bun
5. return the resulting JSON clearly
6. avoid changing `.opencode/server.jsonc` unless the request is actually about configuration

## Scope Boundary

This skill is for runtime operations through `.opencode/scripts/proactive-cli.ts`.

Use `configure-proactive-task` instead when the Master wants to:

- add or edit a proactive task definition in `.opencode/server.jsonc`
- change schedule, trigger, mode, policy, or instructions of a configured task definition
- discuss how proactive task configuration should be designed

In short:

- `manage-proactive-tasks` = operate the current runtime surface
- `configure-proactive-task` = edit the configured task definitions

## Decision Guide

Choose commands using this rule set:

| Command | Target | When to use |
|---|---|---|
| `get-all-tasks` | -- | Visibility into configured tasks, queued items, open anchor windows, runtime state. Safest first step when IDs are unknown. |
| `run-task-now <task-id>` | Configured task ID | Immediate execution of a configured task. Not for queue item IDs. For anchor tasks, creates a new window. |
| `remove-queued-task <queue-id>` | Queue item ID | Delete a queued ad-hoc item. Not for configured task IDs. |
| `add-task-to-queue` | -- (new item) | Create a new ad-hoc queued item. Payload must include `instructions`. |
| `edit-queued-task <queue-id>` | Queue item ID | Modify an existing queued item. All fields optional. Not for configured task definitions. |

## Critical Field Notes

Source-verified semantics that prevent common mistakes:

- **`instructions` is the literal agent prompt.** Not a label. If edited to placeholder text, the agent receives it verbatim. Only edit to refine the actual instruction.
- **`context` is NOT injected into the session.** It is metadata for inspection and debugging only. If the agent needs context, embed it in `instructions`.
- **`model.variant` is supported.** Use `{"providerID": "...", "modelID": "...", "variant": "high"}` to control reasoning effort.
- **Queued items self-clean on dispatch.** No manual cleanup needed after a task fires.
- **Queued items survive restart.** State persists to `proactive-state.json` on every mutation.

## Operational Workflow

1. **Inspect first when IDs are unclear** -- Run `get-all-tasks` to determine whether the target is a configured task, a queued item, or missing.
2. **Distinguish configured task IDs from queue IDs** -- Never guess. Inspect first if there is any ambiguity.
3. **Prefer the smallest valid payload** -- Include only fields that matter. Keep `context` focused and minimal.
4. **Execute the CLI directly** -- Use the canonical Bun command surface.
5. **Return the actual JSON result** -- Summarize but preserve essential output.

## Config Behavior

### Cron Timezone

Cron expressions (`trigger.kind: "cron"`) are evaluated in the server-level `proactive.timezone` field from `.opencode/server.jsonc`. There is no per-task timezone override. When describing a cron trigger to the Master, always interpret it in the configured server timezone (e.g. `0 8 * * *` with `timezone: "Asia/Kuala_Lumpur"` means 08:00 MYT, not UTC).

### Hot Reload

Edits to `.opencode/server.jsonc` are picked up automatically by the running proactive worker via mtime-based hot reload. A worker restart is **not** required for changes to proactive task definitions (add, edit, enable, disable, reorder). The reload happens on the next scheduler tick. If a config parse fails, the worker keeps the last known good config.

## Guardrails

- Never mutate `.opencode/server.jsonc` through this skill.
- Never guess whether an ID belongs to a configured task or a queued item.
- Never send non-JSON input to add or edit commands.
- Never overfill payloads when a smaller payload is sufficient.
- Prefer `get-all-tasks` as the first move when uncertainty exists.

## Reference and Examples

- Full CLI surface, payload schemas, anchor notes, and error avoidance: [REFERENCE.md](REFERENCE.md)
- Copy-ready usage examples for every command: [EXAMPLES.md](EXAMPLES.md)
