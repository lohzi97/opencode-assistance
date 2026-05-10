---
name: restart-opencode
description: Restart the local opencode-assistant stack through `restart.sh --detached`, then let the resumed session confirm restart completion.
---

# Restart OpenCode

## When To Use

Use this skill when Master asks for OpenCode itself to restart and continue afterward in the same session.

Typical requests:

- "Restart opencode-assistant and continue this session afterward."
- "Restart yourself and let me know when you are back."
- "Restart OpenCode for the change to take effect."

## What This Skill Does

This workflow hands restart off to a detached helper process that survives the backend shutdown.

The helper will:

1. use the explicit triggering session id supplied by the agent
2. record the restart request under `.opencode/server/state/restart/`
3. run `./stop.sh`
4. run `./start.sh --no-tui`
5. post a follow-up prompt back into the original session after services are healthy again

## Required Inputs

Collect or infer these values before launching the helper:

- the current session id
- a short plain-English reason

The current session id must be passed explicitly. Do not rely on auto-detection.

Keep the reason short and accurate.

## Canonical Command

Run the detached restart from the repository root:

```bash
./restart.sh --detached --session-id ses_1234567890example --reason "restart opencode-assistant"
```

Example with a more specific reason:

```bash
./restart.sh --detached --session-id ses_1234567890example --reason "apply recent OpenCode configuration changes"
```

## Operator Guidance

Before launching the helper:

1. obtain the current session id from runtime context and pass it explicitly via `--session-id`
2. explain that the current runtime will be interrupted during restart
3. explain that a follow-up message should appear in the same session once restart completes
4. pass only `--session-id` and `--reason`

After launching the helper:

1. report that the helper was launched successfully
2. include the log path printed by `./restart.sh --detached` when available
3. do not claim the restart has already completed in the same message

## Expectations After Success

If restart succeeds, the detached helper posts a prompt back into the triggering session.

That resumed turn should:

1. tell Master that restart completed
2. mention the restart reason if it helps with context
3. state plainly if any visible post-restart problem remains

## Source Files

Treat these as the authoritative local references:

- `start.sh`
- `restart.sh`
- `.opencode/scripts/restart-opencode.ts`
