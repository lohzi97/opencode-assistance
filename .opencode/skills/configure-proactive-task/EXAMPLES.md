# Canonical Local Examples

The repository already contains example tasks inside `.opencode/server.jsonc`. Read them before proposing edits.

## Example A: Anchor cron task with full lifecycle

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
  "anchor": {
    "duration_ms": 82800000,
    "end_instructions": "Summarize any outstanding observations and close out.",
    "rollover_threshold": 0.7,
    "rollover_instructions": "Summarize the current context for continuation in a fresh anchor session."
  },
  "priority": 0,
  "policy": {
    "no_overlap": true,
    "silence_ok": true,
    "cooldown_ms": 300000,
    "ttl_ms": 1800000
  }
}
```

## Example B: Isolated repeating task with model override and exec precheck

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

## Example C: One-shot exec task

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

## Example D: Event-driven anchor task

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

## Example E: Internal precheck task

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

# Example Request Handling

## Example 1

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

## Example 2

User request:

> i think now there is a 'daily morning report' proactive task, can you change it to run at 7am instead of 8am?

Required behavior:

- inspect current tasks first
- if one likely match exists, propose editing it
- if multiple plausible matches exist, ask which one
- present the exact cron change before editing
- ask for confirmation before touching `.opencode/server.jsonc`
