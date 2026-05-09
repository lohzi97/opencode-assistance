---
name: configure-proactive-task
description: Help configure, add, or edit proactive tasks by explaining all task options, collecting missing details with questions, inspecting existing tasks, and asking for confirmation before updating server.jsonc.
---

# Configure Proactive Task

## What I do

Use this skill when the Master wants help setting up, modifying, or understanding a proactive task in `.opencode/server.jsonc`.

This skill is for requests such as:

- "Help me set up a proactive task that runs once per day at 9pm and teaches me database knowledge."
- "I think there is a daily morning report proactive task. Can you change it to run at 7am instead of 8am?"
- "Show me how to configure an event-based proactive task."

This skill must:

1. explain the task configuration model clearly
2. inspect the current configured proactive tasks
3. collect missing requirements using the `question` tool
4. decide whether to edit an existing task or add a new one
5. ask for confirmation before editing `.opencode/server.jsonc`
6. update the config with `apply_patch`
7. validate the result by re-parsing worker config

## Source Of Truth

Use these files as the authoritative local references:

- `.opencode/server.jsonc`
- `.opencode/server/config.ts`
- `.opencode/server/proactive.ts`

When explaining options to the Master, prefer the current repository behavior over vague generalities.

## Task Schema Reference

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

## Field Guide

### Required Common Fields

- `id`: unique machine-friendly identifier
- `name`: human-readable label
- `enabled`: whether the task is active
- `purpose`: why the task exists
- `trigger`: when the task becomes eligible
- `mode`: how the task runs
- `instructions`: what it should do

### Optional Common Fields

- `agent`: overrides default agent
- `model`: overrides default model
- `priority`: higher number dispatches first
- `precheck`: dispatch-time guard
- `policy`: runtime control block

### `trigger` Options

#### `cron`

Use for calendar schedules.

```json
{ "kind": "cron", "expr": "0 21 * * *" }
```

#### `every`

Use for fixed repeating intervals.

```json
{ "kind": "every", "minutes": 180 }
```

#### `at`

Use for a one-shot future timestamp.

```json
{ "kind": "at", "timestamp": "2026-05-10T09:00:00+08:00" }
```

#### `event`

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

### `mode` Options

#### `anchor-session`

Use for lightweight awareness-style work that should reuse the persistent anchor session.

Characteristics:

- continuity-preserving
- best for concise checks
- not enforced as "simple only" by code, so task authors must keep it light

#### `isolated-session`

Use for self-contained agentic work in a fresh session.

Characteristics:

- better for heavier or noisier analysis
- clean runtime isolation
- good default when unsure

#### `exec`

Use for direct local commands without an LLM session.

Requirements:

- `command` must be present
- `command` must be a non-empty string array

### `model` Shape

```json
{
  "providerID": "deepseek",
  "modelID": "deepseek-v4-flash",
  "variant": "optional"
}
```

### `precheck` Options

#### Exec precheck

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

#### Internal precheck

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

### `policy` Fields

- `no_overlap`: block duplicate in-flight runs of the same task
- `max_runtime_ms`: fail long-running runs after this limit
- `retry`: fixed-delay retry policy for runtime failures
- `quiet_hours`: suppress delivery channels during the window
- `cooldown_ms`: minimum delay between runs of the same task
- `budget`: cap run counts within a time window
- `silence_ok`: allow intentionally silent outcomes
- `ttl_ms`: how long a queued run may wait before expiry

#### `retry` Shape

```json
{
  "max_attempts": 2,
  "delay_ms": 60000
}
```

#### `budget` Shape

```json
{
  "window_ms": 86400000,
  "max_runs": 8,
  "max_isolated_llm_runs": 4
}
```

#### `quiet_hours` Shape

```json
{
  "start": "23:00",
  "end": "08:00",
  "timezone": "Asia/Kuala_Lumpur",
  "channels": ["telegram"]
}
```

## Canonical Local Examples

The repository already contains example tasks inside `.opencode/server.jsonc`. Read them before proposing edits.

### Example A: Simple anchor cron task

```json
{
  "id": "morning-awareness-example",
  "name": "Morning Awareness Sweep Example",
  "enabled": false,
  "purpose": "Review maintenance context each morning and stay silent when nothing meaningful is needed.",
  "trigger": {
    "kind": "cron",
    "expr": "0 8 * * *"
  },
  "mode": "anchor-session",
  "instructions": "Review current maintenance context. If nothing meaningful is required, respond exactly with SEBASTIAN_IDLE. If heavy follow-up work is needed, queue an isolated task instead of doing it here.",
  "priority": 0,
  "policy": {
    "no_overlap": true,
    "silence_ok": true,
    "cooldown_ms": 300000,
    "ttl_ms": 1800000
  }
}
```

### Example B: Isolated repeating task with model override and exec precheck

```json
{
  "id": "notes-refresh-review-example",
  "name": "Notes Refresh Review Example",
  "enabled": false,
  "purpose": "Refresh the notes index and investigate only when the precheck indicates something is wrong.",
  "trigger": {
    "kind": "every",
    "minutes": 180
  },
  "mode": "isolated-session",
  "instructions": "Inspect the precheck result. If issues are present, diagnose and summarize them. If everything looks healthy, remain silent.",
  "agent": "sebastian",
  "model": {
    "providerID": "deepseek",
    "modelID": "deepseek-v4-flash"
  },
  "priority": 2,
  "precheck": {
    "kind": "exec",
    "cmd": ["bash", ".opencode/scripts/qmd-refresh.sh"]
  },
  "policy": {
    "no_overlap": true,
    "max_runtime_ms": 900000,
    "silence_ok": true,
    "cooldown_ms": 600000,
    "ttl_ms": 1800000,
    "retry": {
      "max_attempts": 2,
      "delay_ms": 60000
    },
    "budget": {
      "window_ms": 86400000,
      "max_runs": 8,
      "max_isolated_llm_runs": 4
    }
  }
}
```

### Example C: One-shot exec task

```json
{
  "id": "one-shot-exec-example",
  "name": "One-Shot Exec Example",
  "enabled": false,
  "purpose": "Run a one-time local maintenance command at a specific timestamp.",
  "trigger": {
    "kind": "at",
    "timestamp": "2026-05-10T09:00:00+08:00"
  },
  "mode": "exec",
  "instructions": "Record a one-shot maintenance heartbeat.",
  "command": [
    "bash",
    "-lc",
    "printf '%s one-shot-exec-example\\n' \"$(date -Is)\" >> .opencode/server/state/proactive-exec-example.log"
  ],
  "priority": 1,
  "policy": {
    "no_overlap": true,
    "max_runtime_ms": 60000,
    "silence_ok": true,
    "ttl_ms": 300000,
    "retry": {
      "max_attempts": 2,
      "delay_ms": 30000
    }
  }
}
```

### Example D: Event-driven anchor task

```json
{
  "id": "watch-user-session-idle-example",
  "name": "Watch User Session Idle Example",
  "enabled": false,
  "purpose": "React when an allowed user session goes idle and decide whether follow-up is warranted.",
  "trigger": {
    "kind": "event",
    "name": "session.status",
    "include_user_sessions": true,
    "match": {
      "properties.status.type": "idle"
    },
    "debounce_ms": 10000,
    "max_queue_per_window": 2,
    "window_ms": 60000
  },
  "mode": "anchor-session",
  "instructions": "Review the idle session context. If nothing useful should happen, respond exactly with SEBASTIAN_IDLE. If self-contained follow-up is needed, queue an isolated task.",
  "priority": 5,
  "policy": {
    "no_overlap": true,
    "silence_ok": true,
    "cooldown_ms": 120000,
    "ttl_ms": 300000,
    "quiet_hours": {
      "start": "23:30",
      "end": "07:30",
      "timezone": "Asia/Kuala_Lumpur",
      "channels": ["telegram"]
    }
  }
}
```

### Example E: Internal precheck task

```json
{
  "id": "internal-precheck-example",
  "name": "Internal Precheck Example",
  "enabled": false,
  "purpose": "Demonstrate the internal precheck shape and an isolated-session task override.",
  "trigger": {
    "kind": "every",
    "minutes": 60
  },
  "mode": "isolated-session",
  "instructions": "If dispatched, summarize the current state relevant to this test task.",
  "priority": 0,
  "precheck": {
    "kind": "internal",
    "name": "alwaysProceed"
  },
  "policy": {
    "no_overlap": false,
    "silence_ok": true,
    "ttl_ms": 900000
  }
}
```

Together, these examples cover the full current task surface in this repository.

## Operating Rules

Follow this workflow in order.

### 1. Inspect First

Before asking the Master questions, read the current `.opencode/server.jsonc` and inspect `proactive.tasks`.

Look for:

- direct matches by task name or ID
- semantically similar tasks that may need editing instead of adding a new one
- examples you can reuse as a template

### 2. Explain Briefly, Not Endlessly

If the Master appears unsure, first explain the relevant task shape in a short practical way.

Prefer:

- what trigger to use
- what mode to use
- what the minimal required fields are
- what optional policy knobs are relevant

Avoid dumping the entire schema unless the Master asks for it.

### 3. Collect Missing Information With `question`

Use the `question` tool to collect missing information.

Ask only for details that actually matter.

Common things to clarify:

- whether this is a new task or an edit
- desired schedule
- desired trigger kind
- desired execution mode
- whether the task should be enabled immediately
- whether silence is acceptable
- whether it should use anchor or isolated behavior
- whether there is an existing task to modify

When the request is ambiguous about add-vs-edit, present both options explicitly.

Recommended choices:

- `Edit existing task (Recommended)` when there is one strong likely match
- `Add new task`

If there are multiple plausible existing tasks, list them by label.

### 4. Decide Add vs Edit

Use this decision rule:

- if the request clearly refers to an existing task by ID or unmistakable name, edit it
- if the request clearly describes new behavior, add a new task
- if there is ambiguity, ask the Master with `question`

Never silently replace the wrong task.

### 5. Present The Proposed Config Before Editing

Before making changes, show the Master:

- whether you will add or edit
- the task ID affected
- the important fields that will be set or changed

Then ask for confirmation.

Do not edit `.opencode/server.jsonc` until the Master confirms.

### 6. Edit Carefully

After confirmation:

- use `apply_patch`
- keep comments intact
- preserve JSONC style already used in the file
- make the smallest correct change
- avoid changing unrelated tasks

### 7. Validate After Editing

After editing, validate by re-parsing worker config using a Bun import or equivalent local check.

A suitable validation pattern is:

```sh
bun -e 'import { loadWorkerConfig } from "./.opencode/server/config.ts"; const cfg = await loadWorkerConfig(); console.log(cfg.proactive.tasks.map(t => t.id))'
```

### 8. Final Report

After validation, report:

- what was added or changed
- whether the task is enabled
- the trigger and mode used
- any notable policy settings
- whether validation passed

## Intake Template

Use this checklist internally when gathering missing information.

- `id`
- `name`
- `enabled`
- `purpose`
- `trigger.kind`
- schedule details appropriate to the trigger kind
- `mode`
- `instructions`
- optional `agent`
- optional `model`
- optional `priority`
- optional `precheck`
- policy overrides that matter

Do not force every optional field. Minimal correct config is preferred.

## Recommendation Heuristics

When the Master is unsure, recommend defaults:

- prefer `cron` for daily or weekly schedules
- prefer `every` for interval-based repetition
- prefer `at` for one-shot future tasks
- prefer `event` only when the request is genuinely event-driven
- prefer `isolated-session` for heavier teaching, analysis, or content generation tasks
- prefer `anchor-session` only for lightweight awareness or routing behavior
- prefer omitting `agent`, `model`, `precheck`, and extra policy fields unless there is a real need

## Example Request Handling

### Example 1

User request:

> help me setup a proactive task that run once per day at 9pm that teach me databases knowledge that a senior backend engineer requires?

Suggested interpretation:

- likely a new task
- trigger: `cron` at `0 21 * * *`
- mode: likely `isolated-session`
- instructions: teach one focused backend database concept per run
- probably enabled: ask

Likely questions to ask:

- enable immediately or keep disabled for review?
- deliver concise lesson or a more detailed lesson?
- create as a new task or edit an existing similar teaching task if found?

### Example 2

User request:

> i think now there is a 'daily morning report' proactive task, can you change it to run at 7am instead of 8am?

Required behavior:

- inspect current tasks first
- if one likely match exists, propose editing it
- if multiple plausible matches exist, ask which one
- present the exact cron change before editing
- ask for confirmation before touching `.opencode/server.jsonc`

## Guardrails

- Never assume the wrong existing task when the request is fuzzy.
- Never edit `.opencode/server.jsonc` without confirmation.
- Never ask long freeform questions when the `question` tool can gather the answer cleanly.
- Never over-configure a task just because the schema allows it.
- Prefer the simplest correct task that satisfies the Master's request.
