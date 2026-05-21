---
name: configure-proactive-task
description: Help configure, add, or edit proactive tasks by explaining all task options, collecting missing details with questions, inspecting existing tasks, and asking for confirmation before updating server.jsonc.
---

# Configure Proactive Task

## When to use me

Use this skill when the Master wants help setting up, modifying, or understanding a proactive task in `.opencode/server.jsonc`.

Typical requests:

- "Help me set up a proactive task that runs once per day at 9pm and teaches me database knowledge."
- "I think there is a daily morning report proactive task. Can you change it to run at 7am instead of 8am?"
- "Show me how to configure an event-based proactive task."

## Source Of Truth

- `.opencode/server.jsonc`
- `.opencode/server/config.ts`
- `.opencode/server/proactive.ts`

Prefer the current repository behavior over vague generalities.

## Reference Files

- **[SCHEMA.md](SCHEMA.md)** — full task schema, field guide, trigger/mode/anchor/precheck/policy shapes
- **[EXAMPLES.md](EXAMPLES.md)** — 5 canonical task examples and example request handling patterns

Load these when you need to explain specific fields or show concrete task patterns.

## Operating Rules

Follow this workflow in order.

### 1. Inspect First

Read `.opencode/server.jsonc` and inspect `proactive.tasks` before asking questions. Look for:

- direct matches by task name or ID
- semantically similar tasks that may need editing instead of adding
- examples you can reuse as a template

### 2. Explain Briefly, Not Endlessly

When the Master is unsure, explain the relevant task shape in a short practical way. Prefer: what trigger, what mode, minimal required fields, relevant policy knobs. Avoid dumping the entire schema unless asked.

### 3. Collect Missing Information With `question`

Ask only for details that actually matter. Common things to clarify:

- new task or edit
- desired schedule and trigger kind
- desired execution mode
- enable immediately or keep disabled
- silence acceptable
- anchor or isolated behavior

When ambiguous about add-vs-edit, present both options explicitly.

### 4. Decide Add vs Edit

- clearly refers to an existing task by ID or unmistakable name → edit
- clearly describes new behavior → add
- ambiguous → ask the Master with `question`

Never silently replace the wrong task.

### 5. Present The Proposed Config Before Editing

Show the Master: add or edit, task ID affected, important fields. Ask for confirmation. Do not edit `.opencode/server.jsonc` until confirmed.

### 6. Edit Carefully

After confirmation: use `apply_patch`, keep comments intact, preserve JSONC style, make the smallest correct change, avoid changing unrelated tasks.

### 7. Validate After Editing

```sh
bun -e 'import { loadWorkerConfig } from "./.opencode/server/config.ts"; const cfg = await loadWorkerConfig(); console.log(cfg.proactive.tasks.map(t => t.id))'
```

### 8. Final Report

Report: what was added or changed, whether enabled, trigger and mode used, notable policy settings, whether validation passed.

## Intake Template

Use this checklist internally when gathering missing information.

- `id`, `name`, `enabled`, `purpose`
- `trigger.kind` + schedule details
- `mode`, `instructions`
- optional `anchor` block (required when `mode` is `anchor-session`)
- optional `agent`, `model`, `priority`, `precheck`
- policy overrides that matter

Do not force every optional field. Minimal correct config is preferred.

## Recommendation Heuristics

- prefer `cron` for daily/weekly schedules, `every` for intervals, `at` for one-shot, `event` only when genuinely event-driven
- prefer `isolated-session` for heavier analysis or content generation
- prefer `anchor-session` for continuity-preserving work with rollover/retrigger/end lifecycle
- prefer omitting `agent`, `model`, `precheck`, and extra policy fields unless there is a real need

## Guardrails

- Never assume the wrong existing task when the request is fuzzy.
- Never edit `.opencode/server.jsonc` without confirmation.
- Never ask long freeform questions when the `question` tool can gather the answer cleanly.
- Never over-configure a task just because the schema allows it.
- Never add a global `proactive.anchor` block; it is rejected by the config parser.
- Prefer the simplest correct task that satisfies the Master's request.
