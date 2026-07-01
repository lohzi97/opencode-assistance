# Agent Collab — Operator Notes

> This file is a personal record for the operator (the human). It is deliberately
> **not** referenced by `SKILL.md`, `CLI.md`, `MEMBER.md`, or `PLANNER.md`, and
> agents are not expected to load or rely on it. It exists to capture design
> intent that the agent-facing documentation intentionally omits.
>
> Last updated: 20260701

## Design intent: `pause` / `resume` are operator-only controls

`pause` and `resume` are meant to be run **by the operator from the CLI**, not by
an agent on its own initiative. They exist as a human-controlled safety valve for
freezing and thawing a collaboration room without terminating it.

The reason these two commands are password-protected (while `close` is not) is to
signal and enforce that operator-only intent: the room password is something the
operator holds and consciously supplies.

### Asymmetry with `close`

- `close` takes `--session` / `--from` and **no password**. It is a terminal
  action available to the planner agent. Once closed, a room can never be
  reopened.
- `pause` / `resume` take `--password-stdin` (or `--password`). They are
  reversible and operator-scoped.

Caveat to remember: the planner session that creates a room does receive the room
password at creation time, so the password gate is a strong intent signal rather
than a hard cryptographic barrier against that planner. The real enforcement is
**procedural** — no agent workflow documents or instructs agents to pause/resume.
Keep it that way.

## Why no agent skill documents pausing a workflow

The agent-facing docs (`SKILL.md`, `PLANNER.md`, `MEMBER.md`, `CLI.md`) describe
`pause` / `resume` only as low-level CLI primitives. None of them — and notably
not `openspec-orchestrate` — wires pause/resume into an agent workflow such as
"when the user says pause the orchestration, run `pause`."

This omission is **intentional**. If an agent believes it should pause on the
user's behalf, it tends to:

1. Misremember the syntax (e.g. `room pause` instead of the top-level `pause`)
   and hit `unknown command`.
2. Fall back to `close` as a workaround, which is terminal and destroys room
   continuity.
3. Trigger freezes the operator did not ask to own.

The desired behavior when a user says "pause the workflow" is for the agent to
**stop its own work, leave the room open, and let the operator decide** whether
to freeze the room from the CLI. The operator remains the only one who runs
`pause` / `resume`.

## Operator commands

Run these yourself from the repo root. Prefer `--password-stdin` so the password
is not stored in shell history:

```bash
printf '%s\n' '<room-password>' | bun .opencode/scripts/agent-collab.ts pause  --room <room> --password-stdin --json
printf '%s\n' '<room-password>' | bun .opencode/scripts/agent-collab.ts resume --room <room> --password-stdin --json
```

What each does:

- `pause` — freezes an open room. Rejects mutations and close; preserves
  transcript, pending deliveries, questions, and members. Paused rooms are
  invisible to the inactivity-nudge loop, so nudges stop. Pending deliveries are
  held and do not drain. State persists across `./stop.sh` / `./start.sh`.
- `resume` — reopens a paused room, prompts interrupted members to continue, and
  gates their pending deliveries until their resume turn is observed.

Find rooms and passwords as needed:

```bash
bun .opencode/scripts/agent-collab.ts room list --paused --json
bun .opencode/scripts/agent-collab.ts room status --room <room> --json
```
