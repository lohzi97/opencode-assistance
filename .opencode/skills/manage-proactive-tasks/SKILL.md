---
name: manage-proactive-tasks
description: Inspect, query, and manage proactive tasks, queue state, and active runs; run tasks on-demand, remove or edit queued items, and provide human-readable summaries and live monitoring.
---

# Manage Proactive Tasks

## What I do

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

## Source Of Truth

Use these files as the authoritative local references:

- `.opencode/scripts/proactive-cli.ts`
- `.opencode/server/proactive.ts`
- `.opencode/server/proactive-state.ts`

Prefer the repository's real CLI behavior over assumptions.

## Canonical CLI Surface

The real command surface is:

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
bun .opencode/scripts/proactive-cli.ts run-task-now <task-id>
bun .opencode/scripts/proactive-cli.ts remove-queued-task <queue-id>
bun .opencode/scripts/proactive-cli.ts add-task-to-queue [--file path | --stdin]
bun .opencode/scripts/proactive-cli.ts edit-queued-task <queue-id> [--file path | --stdin]
```

Treat this CLI as the canonical interface.

Do not rely on thin wrapper scripts unless there is a specific reason.

## Decision Guide

Choose commands using this rule set:

### `get-all-tasks`

Use when the Master wants visibility into:

- configured proactive tasks
- queued ad-hoc items
- current runtime state in general

This is the safest first step when IDs are unknown.

### `run-task-now <task-id>`

Use when the Master wants to immediately execute a configured proactive task.

Important:

- this expects a configured task ID
- this is not for queue item IDs
- when uncertain, inspect with `get-all-tasks` first

### `remove-queued-task <queue-id>`

Use when the Master wants to delete an existing queued ad-hoc item.

Important:

- this expects a queue item ID
- do not use it for configured task IDs

### `add-task-to-queue`

Use when the Master wants to create a new ad-hoc queued proactive item.

Important:

- payload must be JSON
- payload must include `instructions` as a string
- everything else is optional

### `edit-queued-task <queue-id>`

Use when the Master wants to modify an existing queued ad-hoc item.

Important:

- this expects a queue item ID
- payload must be a JSON object
- every field is optional on edit
- use this only for queued items, not configured task definitions

## Payload Reference

### Add payload shape

The add payload supports:

```json
{
  "instructions": "required string",
  "priority": 0,
  "ttl_ms": 1800000,
  "agent": "sebastian",
  "model": {
    "providerID": "provider",
    "modelID": "model",
    "variant": "optional"
  },
  "context": {
    "topic": "optional arbitrary context"
  },
  "dedupe_key": "optional-string",
  "not_before": 1760000000000,
  "source": {
    "type": "manual",
    "session_id": "optional-session-id",
    "run_id": "optional-run-id"
  }
}
```

Rules:

- `instructions` is required
- `priority`, `ttl_ms`, and `not_before` must be numbers if present
- `agent`, `dedupe_key`, and source string fields must be strings if present
- `context` must be an object if present
- `model` must contain both `providerID` and `modelID` to be accepted
- allowed `source.type` values are:
  - `trigger`
  - `manual`
  - `script`
  - `anchor`
  - `isolated`
  - `user-session`

### Edit payload shape

The edit payload supports this partial shape:

```json
{
  "instructions": "optional string",
  "priority": 5,
  "ttl_ms": 900000,
  "agent": "sebastian",
  "model": {
    "providerID": "provider",
    "modelID": "model",
    "variant": "optional"
  },
  "context": {
    "reason": "optional"
  },
  "dedupe_key": "optional-string",
  "not_before": 1760000000000
}
```

Rules:

- the payload must be a JSON object
- all fields are optional
- only include fields that should change

## Operational Workflow

Follow this order.

### 1. Inspect first when IDs are unclear

If the Master did not give a precise `task-id` or `queue-id`, start with:

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
```

Use the output to determine whether the target is:

- a configured task
- a queued item
- missing entirely

### 2. Distinguish configured task IDs from queue IDs

Before mutating or running anything, verify whether the target is:

- a configured task to use with `run-task-now`
- a queue item to use with `edit-queued-task` or `remove-queued-task`

Never guess. Inspect first if there is any ambiguity.

### 3. Prefer the smallest valid payload

When adding or editing items:

- include only fields that matter
- do not invent extra structure
- keep `context` focused and minimal

### 4. Execute the CLI directly

Use the canonical Bun command surface.

### 5. Return the actual JSON result

Do not paraphrase the CLI response when the raw result matters.

Summarize it, but preserve the essential output.

## Examples

These examples are intended to be copied with minimal adjustment.

### Example 1: List everything first

Use this when the Master asks what tasks exist or when IDs are unknown.

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
```

Use this before:

- running a task now
- editing a queued item
- removing a queued item

### Example 2: Run a configured task immediately

If the configured task ID is `daily-review`, run:

```sh
bun .opencode/scripts/proactive-cli.ts run-task-now daily-review
```

Use this only for configured task IDs.

If the Master says "run that queued item now," first inspect whether they actually mean a configured task or whether a queue edit is needed instead.

### Example 3: Remove a queued ad-hoc item

If the queue item ID is `pq_abc123`, run:

```sh
bun .opencode/scripts/proactive-cli.ts remove-queued-task pq_abc123
```

Use this only for queued item IDs.

### Example 4: Add a simple ad-hoc queued item via stdin

```sh
printf '%s' '{
  "instructions": "Review current repository maintenance state and report only actionable issues.",
  "priority": 2,
  "ttl_ms": 1800000,
  "agent": "sebastian"
}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

This is the simplest useful pattern for new ad-hoc work.

### Example 5: Add an ad-hoc item with model and context via stdin

```sh
printf '%s' '{
  "instructions": "Research the failing proactive precheck and summarize the root cause.",
  "priority": 3,
  "agent": "sebastian",
  "model": {
    "providerID": "deepseek",
    "modelID": "deepseek-v4-flash"
  },
  "context": {
    "task": "hello-testing",
    "requested_by": "master"
  },
  "dedupe_key": "research-hello-testing",
  "source": {
    "type": "manual"
  }
}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

### Example 6: Add an ad-hoc item from a file

Create a JSON payload file first, then run:

```sh
bun .opencode/scripts/proactive-cli.ts add-task-to-queue --file /absolute/path/to/payload.json
```

You may also pass a path positionally because the CLI accepts it:

```sh
bun .opencode/scripts/proactive-cli.ts add-task-to-queue /absolute/path/to/payload.json
```

Use `--file` when clarity matters.

### Example 7: Edit a queued item via stdin

If the queue ID is `pq_abc123`, and the Master wants to delay it and raise priority:

```sh
printf '%s' '{
  "priority": 5,
  "not_before": 1760000000000,
  "context": {
    "reason": "deferred until after current work"
  }
}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task pq_abc123 --stdin
```

### Example 8: Edit only the instructions of a queued item

```sh
printf '%s' '{
  "instructions": "Re-check the last proactive failure artifact and summarize only the concrete fix."
}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task pq_abc123 --stdin
```

### Example 9: Edit a queued item from a file

```sh
bun .opencode/scripts/proactive-cli.ts edit-queued-task pq_abc123 --file /absolute/path/to/edit-payload.json
```

### Example 10: Inspect before deciding whether to run, edit, or remove

Good operator pattern:

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
```

Then decide:

- if the target is a configured task ID, use `run-task-now`
- if the target is a queued item ID and needs changes, use `edit-queued-task`
- if the target is a queued item ID and should be deleted, use `remove-queued-task`

## Error Avoidance

### Avoid confusing IDs

Common mistake:

- passing a queue ID to `run-task-now`
- passing a configured task ID to `edit-queued-task` or `remove-queued-task`

Prevention:

- inspect with `get-all-tasks` first

### Avoid invalid add payloads

Common mistake:

- omitting `instructions`

This will fail because the add payload must include string field `instructions`.

### Avoid invalid JSON

Common mistake:

- sending plain text instead of JSON over stdin

This will fail because the CLI parses stdin as JSON.

### Avoid malformed model objects

Common mistake:

- providing `model.providerID` without `model.modelID`

The CLI will ignore malformed model input rather than accepting a partial model.

### Avoid editing configured tasks through this skill

Common mistake:

- trying to use `edit-queued-task` to change the schedule or trigger of a configured task

That is the wrong layer. Use `configure-proactive-task` instead.

## Recommended Response Pattern

When handling a request, structure the work like this:

1. inspect first if the target ID is unclear
2. state which command you are going to use and why
3. run the CLI
4. return the result clearly
5. mention the next sensible action only if useful

## Quick Reference

### Show current proactive state

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
```

### Run configured task now

```sh
bun .opencode/scripts/proactive-cli.ts run-task-now <task-id>
```

### Remove queued item

```sh
bun .opencode/scripts/proactive-cli.ts remove-queued-task <queue-id>
```

### Add queued item from stdin

```sh
printf '%s' '{"instructions":"..."}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin
```

### Edit queued item from stdin

```sh
printf '%s' '{"priority":3}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task <queue-id> --stdin
```

## Guardrails

- Never mutate `.opencode/server.jsonc` through this skill.
- Never guess whether an ID belongs to a configured task or a queued item.
- Never send non-JSON input to add or edit commands.
- Never overfill payloads when a smaller payload is sufficient.
- Prefer `get-all-tasks` as the first move when uncertainty exists.
