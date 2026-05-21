# Task Schema Reference

## Top-Level Shape

Each proactive task lives under:

```json
{
  "proactive": {
    "tasks": [
      {
        "id": "task-id",
        "name": "Human readable task name",
        "enabled": true,
        "purpose": "Why this task exists.",
        "trigger": { ... },
        "mode": "anchor-session | isolated-session | exec",
        "instructions": "What the run should do.",
        "command": ["..."],
        "anchor": { ... },
        "agent": "optional-agent-override",
        "model": {
          "providerID": "provider",
          "modelID": "model",
          "variant": "optional"
        },
        "priority": 0,
        "precheck": { ... },
        "policy": { ... }
      }
    ]
  }
}
```

Global `proactive.anchor` defaults no longer exist. Anchor behavior is fully configured per task under `task.anchor`.

## Required Common Fields

- `id`: unique machine-friendly identifier
- `name`: human-readable label
- `enabled`: whether the task is active
- `purpose`: why the task exists
- `trigger`: when the task becomes eligible
- `mode`: how the task runs
- `instructions`: what it should do (see `instructions` Options below)

## `instructions` Options

### Plain text (default)

Freeform text sent as a regular prompt to the session. All current examples use this form.

```json
"instructions": "Review context. If nothing needed, respond SEBASTIAN_IDLE."
```

### Custom command reference

If the value starts with `/`, the proactive dispatcher invokes it as a custom OpenCode command instead of a text prompt. The first token is the command name (without the `/`), and remaining tokens are passed as arguments.

This lets you reuse existing custom commands without duplicating their full workflow in the instructions field.

```json
"instructions": "/write-master-diary"
```

With arguments:

```json
"instructions": "/write-master-diary 20260517"
```

Only applies to `anchor-session` and `isolated-session` modes. The `exec` mode ignores `instructions` and runs `command` directly.

## Optional Common Fields

- `agent`: overrides default agent
- `model`: overrides default model
- `priority`: higher number dispatches first
- `precheck`: dispatch-time guard
- `policy`: runtime control block

## `trigger` Options

### `cron`

Use for calendar schedules.

```json
{ "kind": "cron", "expr": "0 21 * * *" }
```

### `every`

Use for fixed repeating intervals.

```json
{ "kind": "every", "minutes": 180 }
```

### `at`

Use for a one-shot future timestamp.

```json
{ "kind": "at", "timestamp": "2026-05-10T09:00:00+08:00" }
```

### `event`

Use when a raw OpenCode event should enqueue work.

```json
{
  "kind": "event",
  "name": "session.status",
  "include_user_sessions": true,
  "match": {
    "properties.status.type": "idle"
  },
  "debounce_ms": 10000,
  "max_queue_per_window": 2,
  "window_ms": 60000
}
```

## `mode` Options

### `anchor-session`

Use for continuity-preserving work that should persist across a time window with task-scoped rolling anchor sessions.

Characteristics:

- each trigger creates a new **anchor window** (a task-scoped session lineage)
- titles render as `Anchor: ${task.name}` for anchor windows
- multiple windows may coexist for the same task when `policy.no_overlap` is `false`
- each window owns its own session lineage, retrigger clock, and end time
- rollover replaces only one window's current session; others remain untouched
- every session in anchor lineage is permanently exempt from generic compaction
- requires the `anchor` config block (see `anchor` Fields below)

When `policy.no_overlap` is `true` for an anchor task, it means: suppress creation of a new top-level window if an older window for that task is still open. It does not block retrigger, rollover, or end for already-open windows.

### `isolated-session`

Use for self-contained agentic work in a fresh session.

Characteristics:

- better for heavier or noisier analysis
- clean runtime isolation
- good default when unsure

### `exec`

Use for direct local commands without an LLM session.

Requirements:

- `command` must be present
- `command` must be a non-empty string array

## `anchor` Fields

Required when `mode` is `anchor-session`. The `anchor` block configures the lifecycle of task-scoped anchor windows.

```json
{
  "duration_ms": 82800000,
  "end_instructions": "Finalize and close.",
  "rollover_threshold": 0.7,
  "rollover_instructions": "Summarize for continuation.",
  "retrigger": {
    "kind": "every",
    "minutes": 120
  },
  "retrigger_instructions": "Re-engage with a follow-up prompt."
}
```

Fields:

- `duration_ms`: how long an anchor window stays open from its scheduled start (required)
- `end_instructions`: prompt sent into the window's current session when the window expires; considered successful once the session returns idle after it fires (required)
- `rollover_threshold`: context usage ratio (0-1) at which a rollover fires before `window_end_at` (required)
- `rollover_instructions`: prompt sent into the current session to produce a handover summary before the continuation session is created (required)
- `retrigger`: optional repeating trigger that fires into an open window's current session; must be `{ "kind": "every", "minutes": N }`
- `retrigger_instructions`: required when `retrigger` is defined; the prompt sent on each retrigger

Lifecycle notes:

- Top-level `instructions` run only once per window at start.
- Rollover creates a fresh continuation session seeded from the rollover handover text; it does not rerun `instructions`.
- Retrigger targets the window's current session; it does not create sessions by itself.
- Title is rendered once from the window start time and reused exactly across rollovers.
- If model context limit is unknown, runtime refuses to start the window.

## `model` Shape

```json
{
  "providerID": "deepseek",
  "modelID": "deepseek-v4-flash",
  "variant": "optional"
}
```

## `precheck` Options

### Exec precheck

```json
{
  "kind": "exec",
  "cmd": ["bash", ".opencode/scripts/qmd-refresh.sh"]
}
```

Requirements:

- the command must write valid JSON to stdout
- plain text such as `echo precheck-ok` is invalid and will fail parsing
- the JSON object must follow this shape:

```json
{
  "decision": "proceed | skip | error",
  "reason": "string",
  "context": {},
  "dedupe_key": "optional",
  "ttl_ms": 0
}
```

Minimal proceed example:

```json
{
  "kind": "exec",
  "cmd": [
    "bash",
    "-c",
    "printf '%s\\n' '{\"decision\":\"proceed\",\"reason\":\"ok\",\"context\":{}}'"
  ]
}
```

### Internal precheck

```json
{
  "kind": "internal",
  "name": "alwaysProceed"
}
```

Currently implemented internal precheck names in this repository include:

- `alwaysProceed`
- `skipIfInstructionsEmpty`

Current behavior:

- `alwaysProceed`: does no real check; it always returns `decision: proceed`, `reason: alwaysProceed`, and passes through the current queue item context
- `skipIfInstructionsEmpty`: skips the run only when `instructions` is empty after trimming

## `policy` Fields

- `no_overlap`: for anchor tasks, suppresses creation of a new window if one is already open; for isolated/exec tasks, blocks duplicate in-flight runs
- `max_runtime_ms`: fail long-running runs after this limit
- `retry`: fixed-delay retry policy for runtime failures
- `quiet_hours`: suppress delivery channels during the window
- `cooldown_ms`: minimum delay between runs of the same task
- `budget`: cap run counts within a time window
- `silence_ok`: allow intentionally silent outcomes
- `ttl_ms`: how long a queued run may wait before expiry

### `retry` Shape

```json
{
  "max_attempts": 2,
  "delay_ms": 60000
}
```

### `budget` Shape

```json
{
  "window_ms": 86400000,
  "max_runs": 8,
  "max_isolated_llm_runs": 4
}
```

### `quiet_hours` Shape

```json
{
  "start": "23:00",
  "end": "08:00",
  "timezone": "Asia/Kuala_Lumpur",
  "channels": ["telegram"]
}
```
