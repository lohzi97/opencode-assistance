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
