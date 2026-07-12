---
name: ralph-loop
description: Run an autonomous Ralph Loop to fully implement and verify any task (plan, PRD, spec, or feature) by repeatedly spawning fresh-context implementer sessions via agent-collab until an implementer makes zero file changes. Use when the user says "Ralph loop", "Ralph Wiggum loop", asks to implement something by repeatedly spawning fresh implementers until nothing more changes, or wants a large task driven to convergence with fresh context per iteration.
---

# Ralph Loop

## When to use me

Use when the Master wants a task (typically a plan/PRD/spec file, or a described feature) implemented to completion via a **Ralph Loop**: a persistent outer harness (you, the planner) that spawns a *fresh-context* implementer session each iteration, lets it run to its own completion, evaluates the result, and repeats until convergence.

## Core idea

- **You** are the persistent outer loop (the planner in an `agent-collab` room). Your context holds only lightweight orchestration state.
- **Each implementer** is a disposable, fresh-context worker spawned into the target project. No implementer inherits the previous one's chat history. This avoids context rot.
- **Cross-iteration memory is the working tree + git history**, not chat. Each fresh implementer reads the task file and inspects `git status`/recent log, so accumulated (even uncommitted) work carries forward naturally.
- **Convergence signal is objective:** the loop stops only when an implementer makes **zero file changes** in its run. Self-assessed "done" claims are unreliable.

Load the `agent-collab` skill for room/spawn/message mechanics. This skill only defines the loop doctrine.

## Preconditions

1. Know the **target project directory**.
2. Know the **agent that exists in the target project**. Check `<target>/.opencode/agents/`. You MUST pass `--agent <that agent>` explicitly at spawn (see Rules).
3. Know the **model**: provider, model id, and variant the Master wants (e.g. `deepseek` / `deepseek-v4-pro` / `max`).
4. Know the **task file or description** (e.g. path to the plan/PRD).
5. Confirm **max iterations** (default 25) and **stuck threshold** (default: 2 consecutive same-blocker iterations).

## The loop

### 0. Setup (once)
Create a persistent `agent-collab` room as planner in the target project. No public message is needed (it is noise). Keep the room open across all iterations.

### 1. Spawn a fresh implementer
Same prompt every iteration. Example:

```bash
PROMPT=$(cat <<'EOF'
Implement `<TASK_FILE>`.

<Testing requirements: e.g. "Do layer 1 and layer 2 testing throughout. Skip layer 3 until layer 2 is clean.">
<Available test resources: e.g. "A bot is running in dev under <account> — feel free to use it.">
Commit only after you have finished implementing.
Do not ask questions; implement until it is finished. Make reasonable assumptions and judgements on your own, and state them in your final report.

In your final report: (1) list every file you modified or created (or explicitly state "no file changes required" if nothing needed changing); (2) state explicitly whether the task has been fully implemented and verified, or whether work remains. If everything is done and working correctly, say so unambiguously.
EOF
)
bun .opencode/scripts/agent-collab.ts spawn \
  --room <room> --session <planner-session> --from planner \
  --name implementer-<N> --role implementer \
  --agent <project-agent> \
  --provider <provider> --model <model> --variant <variant> \
  --dir <target-project-dir> \
  --initial-prompt "$PROMPT" --json
```

The `(1) list files modified OR "no file changes required"` clause is mandatory — it is how you judge convergence.

### 2. Wait, do not poll
Go idle. The implementer's report arrives as an ordinary user message. Do not poll, do not sleep, do not keep your session busy.

### 3. Evaluate the report (objective, not subjective)
Cross-check the implementer's "files modified" claim against git:
- new commit on the target branch, or
- a dirty working tree (uncommitted changes).

Then decide:
- **File changes were made** (new commit or dirty tree) -> remove the implementer, spawn the next fresh one. The loop continues. Do NOT stop on a "fully done" claim.
- **Implementer reports "no file changes required" AND the tree is clean/landed** -> candidate stop. Require convergence: prefer at least one confirming no-change pass, because a single no-change pass can be a false positive (a prior pass may have missed gaps the next one catches). Stop when gaps-found-per-pass has decayed to 0 across consecutive passes.

### 4. Repeat until stop or guardrail fires.

## Inactivity protocol (critical)

An inactivity notice does NOT mean the implementer is finished or stuck.
- **1st inactivity notice:** send the implementer a `send` message asking for a brief status report. Wait. Do NOT remove it and do NOT check files yet.
- **Still no reply by the 2nd inactivity notice:** only then inspect git / the transcript and decide (nudge harder, or remove + respawn).

Never remove a quiet implementer on the first notice — it may still be mid-work.

## Guardrails

- **Max iterations:** hard cap (default 25). Halt and report to the Master.
- **Stuck detection:** if 2 consecutive iterations hit the same blocker with no progress, halt and report.

## Rules (hard-won)

1. **Always pass `--agent` explicitly**, matching an agent that exists in the target project. Omitting it derives the planner's agent, which usually does not exist in the target project and crashes context assembly with an opaque `UnknownError` at `createUserMessage`.
2. **Never interrupt a working implementer** with a status check or question — it ends their turn prematurely. Only nudge on an inactivity notice.
3. **Stop on file changes, not on "done" claims.** Every implementer claims the task is fully done; take it with a grain of salt. One no-change pass is not enough — confirm convergence.
4. **Implementers will not commit pre-existing uncommitted work** they did not author. If verified-complete work sits uncommitted across passes, direct a final implementer (via a planner `send` message, not a prompt change) to commit all complete verified work so the tree is clean. The harness itself stays out of the target repo's git.
5. **Same spawn prompt every iteration.** You may refine wording slightly with the Master's permission, but meaning must stay the same.
6. **Cross-check objectively with git.** Don't trust the report alone — verify new commit / dirty tree.
7. **Keep one persistent room;** increment implementer aliases (`implementer-1`, `-2`, ...). Remove a finished implementer before spawning the next.

## Worked example and failure modes
See [REFERENCE.md](REFERENCE.md) for the full narrative from the first run, including the spawn crash root cause, the false-positive no-change pass, and the commit loose-end resolution.
