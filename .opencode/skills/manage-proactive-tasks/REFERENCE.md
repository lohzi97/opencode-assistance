# Reference: CLI Surface, Payloads, and Operational Notes

## Source Of Truth

Use these files as the authoritative local references:

- `.opencode/scripts/proactive-cli.ts`
- `.opencode/server/proactive.ts`
- `.opencode/server/proactive-state.ts`

Prefer the repository's real CLI behavior over assumptions.

## Canonical CLI Surface

```sh
bun .opencode/scripts/proactive-cli.ts get-all-tasks
bun .opencode/scripts/proactive-cli.ts run-task-now <task-id>
bun .opencode/scripts/proactive-cli.ts remove-queued-task <queue-id>
bun .opencode/scripts/proactive-cli.ts add-task-to-queue [--file path | --stdin]
bun .opencode/scripts/proactive-cli.ts edit-queued-task <queue-id> [--file path | --stdin]
```

Treat this CLI as the canonical interface. Do not rely on thin wrapper scripts unless there is a specific reason.

## Payload Reference

### Add payload shape

```json
{
  "instructions": "required string",
  "priority": 0,
  "ttl_ms": 1800000,
  "agent": "sebastian",
  "title": "optional session title",
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
- allowed `source.type` values: `trigger`, `manual`, `script`, `anchor`, `isolated`, `user-session`

### Edit payload shape

The edit payload supports this partial shape:

```json
{
  "instructions": "optional string",
  "priority": 5,
  "ttl_ms": 900000,
  "agent": "sebastian",
  "title": "optional session title",
  "model": {
    "providerID": "provider",
    "modelID": "model",
    "variant": "optional"
  },
  "dedupe_key": "optional-string",
  "not_before": 1760000000000
}
```

Rules:

- the payload must be a JSON object
- all fields are optional
- only include fields that should change

## Queue Item Field Semantics

Each field controls a specific runtime behavior. Semantics verified against
`.opencode/server/proactive.ts` and `.opencode/server/shared.ts`.

### `instructions` (required for add)

The literal prompt text delivered to the agent session at dispatch time. This is
not a label or description — it IS the task. Two execution paths:

- If the trimmed text starts with `/`, it is dispatched as a slash command
  (e.g. `/my-command arg1 arg2`).
- Otherwise, it is sent as a plain text prompt via `promptAsync`.

Never replace with placeholder text when editing — the agent receives the string
verbatim. Only edit to refine or improve the actual instruction content.

### `not_before` (epoch milliseconds)

Unix timestamp in ms. The dispatcher will not dispatch until current time exceeds
this value. Default: current time (immediate eligibility). Compute with:

```sh
date -d "2026-07-06 08:00:00 +0800" +%s%3N
```

### `priority` (integer, default 0)

Higher number = dispatched first. Items are sorted by priority (descending), then
by creation time (FIFO) within the same priority.

### `ttl_ms` (milliseconds)

If a queued item waits longer than `ttl_ms` from creation, it expires and is
dropped without executing. Default: 1800000 (30 min). For future-scheduled items
with a distant `not_before`, set `ttl_ms` high enough to cover the full wait
period plus a grace window.

### `agent` (string)

The OpenCode agent for the session (e.g. `sebastian`, `levi`). If omitted, the
default agent is used.

### `model` (object: `{ providerID, modelID, variant? }`)

Overrides the model for the dispatched session:

- `providerID` (required with modelID): e.g. `deepseek`, `zai-coding-plan`
- `modelID` (required with providerID): e.g. `deepseek-v4-flash`, `glm-5.1`
- `variant` (optional): reasoning effort — `low`, `medium`, `high`, `max`.
  Fully supported and threaded through to the API at dispatch time.

If `providerID` or `modelID` is missing, the entire model field is silently
ignored and the default model is used.

### `context` (object)

**Metadata only — NOT injected into the agent session.**

Stored on the queue item for inspection via `get-all-tasks` and included in
exec-mode failure artifacts. The isolated-session execution path passes only
`instructions`, `agent`, and `model` — `context` is never referenced at runtime.

If the agent needs contextual information, embed it directly in `instructions`.

### `title` (string)

Optional human-readable label used as the OpenCode **session title** for the
dispatched isolated session. When omitted, the title falls back to
`"Proactive Isolated Run"` for ad-hoc items, or the rendered task name for
configured tasks.

This is a display concern only — it is never injected into the agent prompt
(`instructions` remains the sole runtime input). Set it for ad-hoc items that
deserve a recognizable name in the session list (e.g. reminders). Survives
state persistence and queue edits. Editable via `edit-queued-task`.

### `dedupe_key` (string)

Idempotency guard. If an item with the same key already exists in the queue or
active runs, the new item is **rejected** (suppressed with reason "dedupe key
already queued or active"). Prevents duplicate tasks from accumulating when a
script enqueues repeatedly. If omitted, no dedup check occurs.

## Queue Item Lifecycle

```
add-task-to-queue
       |
       v
   [ queued ]<------ not_before > now, stays waiting
       |
       | not_before <= now, lane available
       v
  [ dispatched ]   removed from queue, moved to state.active
       |
       | run completes
       v
   [ consumed ]    removed from active, logged to proactive-runs.jsonl
```

Key points:

- **No manual cleanup needed.** Dispatched items are removed from `state.queue`
  and moved to `state.active`. On completion they are removed from `state.active`
  and appended to the run ledger. Nothing lingers to clean up.
- **Survives restart.** State persists to `.opencode/server/state/proactive-state.json`
  on every mutation (locked read-mutate-write). A restart recycles processes only;
  the JSON state file is untouched. The dispatcher loads state fresh from disk on
  startup.
- **Only actionable while queued.** `edit-queued-task` and `remove-queued-task`
  work only on items still in the queue. Once dispatched, the item is consumed
  and no longer exists to edit or remove.

## `get-all-tasks` Output Structure

```json
{
  "enabled": true,
  "configured_tasks": [
    { "id": "...", "name": "...", "queued_count": N, "active_count": N }
  ],
  "queue": [
    { "queue_id": "pq_...", "instructions": "...", "title": "...", "not_before": N,
      "priority": N, "agent": "...", "model": {...}, "context": {...},
      "dedupe_key": "...", "ttl_ms": N, "status": "queued" }
  ],
  "active_runs": [ { "run_id": "run_...", "status": "running" } ],
  "anchors": [ ... ]
}
```

- `queue`: all pending items sorted by priority (descending). Inspect to find
  `queue_id` values before editing or removing.
- `configured_tasks`: task definitions from `server.jsonc` with live counts.
- `active_runs`: currently executing tasks.

## Anchor Runtime Notes

When operating anchor tasks at runtime, keep these behaviors in mind:

- Each anchor task can have multiple open windows simultaneously (when `policy.no_overlap` is `false`).
- `run-task-now` for an anchor task always creates a new window; it never replays into an existing one.
- Rollover replaces only one window's current session. Other windows are unaffected.
- Every session in anchor lineage is permanently exempt from generic compaction.
- Removing a task or setting `enabled: false` immediately orphans its open windows and stops all future proactive actions for them.
- Orphaned anchor sessions remain usable for normal chat but will never compact.

## Error Avoidance

### Avoid confusing IDs

Common mistake: passing a queue ID to `run-task-now`, or passing a configured task ID to `edit-queued-task` or `remove-queued-task`. Prevention: inspect with `get-all-tasks` first.

### Avoid invalid add payloads

Common mistake: omitting `instructions`. The add payload must include string field `instructions`.

### Avoid invalid JSON

Common mistake: sending plain text instead of JSON over stdin. The CLI parses stdin as JSON.

### Avoid malformed model objects

Common mistake: providing `model.providerID` without `model.modelID`. The CLI will ignore malformed model input rather than accepting a partial model.

### Avoid editing configured tasks through this skill

Common mistake: trying to use `edit-queued-task` to change the schedule or trigger of a configured task. That is the wrong layer. Use `configure-proactive-task` instead.

### Avoid editing instructions to placeholder text

Common mistake: setting `instructions` to a generic string like "updated" when editing. The agent receives the `instructions` string verbatim as its prompt at dispatch time. Only edit instructions to refine the actual task content.

### Avoid relying on `context` for runtime behavior

Common mistake: putting critical information in `context` expecting the agent to see it. The `context` field is metadata only — it is never injected into the session prompt. Embed any information the agent needs directly in `instructions`.

### Avoid default TTL for future-scheduled items

Common mistake: using `not_before` to schedule a reminder days away but leaving `ttl_ms` at the default 30 minutes. The item expires and is dropped before it ever becomes eligible. Always set `ttl_ms` to exceed the gap between creation and `not_before`.

### Avoid confusion about queue persistence

Common mistake: assuming queued items are lost on restart. Queue state is persisted to `proactive-state.json` on every mutation. Restarts recycle processes only; the state file survives untouched.

## Quick Reference

```sh
# Show current proactive state
bun .opencode/scripts/proactive-cli.ts get-all-tasks

# Run configured task now
bun .opencode/scripts/proactive-cli.ts run-task-now <task-id>

# Remove queued item
bun .opencode/scripts/proactive-cli.ts remove-queued-task <queue-id>

# Add queued item from stdin
printf '%s' '{"instructions":"..."}' | bun .opencode/scripts/proactive-cli.ts add-task-to-queue --stdin

# Edit queued item from stdin
printf '%s' '{"priority":3}' | bun .opencode/scripts/proactive-cli.ts edit-queued-task <queue-id> --stdin
```
