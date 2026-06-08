---
name: agent-collab
description: Coordinate OpenCode sessions through the 'agent-collab' room service. Use when starting a group collaboration discussion, joining a collaboration room, receiving a room bootstrap prompt, or needing to communicate through the agent-collab CLI.
---

# Agent Collab

## When To Use

Use this skill when coordinating multiple OpenCode sessions through the local `agent-collab` room service. This covers planner-led group discussions, spawned implementer sessions, reviewer sessions, room messages, tracked questions, and transcript inspection.

## Core Concepts

- A room is a managed group chat between OpenCode sessions.
- A member is an OpenCode session joined to a room with a room-local alias.
- The `planner` role is special: planners create rooms, manage public messages, spawn/add/remove members, use hard interrupts, and close rooms.
- Other roles such as `implementer` and `reviewer` are informational conventions.
- Aliases must be lowercase slugs matching `[a-z0-9][a-z0-9-]*`.
- The room public message is planner-owned pinned context and appears in future deliveries.
- `@alias` and `@everyone` create immediate soft delivery.
- No mention creates buffered delivery, which waits for the target session to become eligible.
- `ask` creates tracked questions. Targets must answer with `answer --parent <message_id>`.
- `--hard` is planner-only, aborts target sessions before injecting, and should be used sparingly.

## Room Lifecycle

- Rooms are `open`, `paused`, or `closed`.
- Open rooms accept member management, public-message updates, sends, asks, answers, joins, leaves, spawns, and close operations.
- Paused rooms preserve transcript, pending deliveries, questions, and members, but reject normal mutations and close until resumed.
- `agent-collab pause --room <room> --password-stdin` freezes an open room using the room planner password, aborting busy/retry members and recording interruption diagnostics.
- `agent-collab resume --room <room> --password-stdin` reopens a paused room, prompts interrupted members to continue, and gates their normal pending deliveries until their resume turn is observed busy/retry then idle.
- Closing a room is terminal; closed rooms cannot be reopened.
- Closed rooms reject new mutations: no new `send`, `ask`, `answer`, `join`, `leave`, `member add`, `member remove`, `spawn`, or public-message updates.
- Read-only operations still work for paused and closed rooms, including `room status`, `room list`, and `messages`.
- Already-created pending deliveries may still drain after close, including the final `room_closed` message.
- Closing a room does not automatically stop spawned OpenCode sessions; it only closes the collaboration room.

## Delivery Modes

- Buffered delivery is the default when a message has no `@mention`. It waits until the target session is idle, not retrying, has no pending user question, and has no unresolved collab question while the room is open.
- Immediate soft delivery is created by `@alias` or `@everyone`. It can inject while the target is busy, but it still waits during `retry` or pending user questions.
- Hard delivery is created with `--hard`, requires a planner, and requires explicit mention targets. It aborts targeted sessions, waits for them to become idle, then injects the message. Multi-target hard delivery is all-or-nothing.
- Delivery mode controls injection urgency only. All room messages remain visible in the room transcript.
- Per target, delivery preserves chronological context. If an immediate or hard message has older pending buffered messages before it, the target receives a combined chronological batch.

## Receiving Messages

- You will receive messages and updates of the room into your current session as **ordinary user message**.
- DO NOT poll for messages when waiting for other session to reply.
- DO NOT `sleep` or keep your session busy because 'agent collab' room service wait for you to become idle in order to inject messages/updates into your current session as **ordinary user message**. This is a mechanism to prevent interruption on running task.
- Becoming idle and do a simple user-facing message response/reply (E.g. "Waiting for xxx to reply") is the best and fastest way to receive messages/updates from other session.

## CLI Basics

Use the repository script:

```bash
bun .opencode/scripts/agent-collab.ts <command>
```

The default service URL is `http://127.0.0.1:9100`. Override it with `AGENT_COLLAB_URL` only when needed.

Prefer `--json` when you need exact room names, message ids, delivery states, or machine-readable output.

For complete command syntax, see [CLI.md](CLI.md).

## Rules

1. Never expose the room password in room messages, public messages, notes, or logs. Prefer `--password-stdin` for `join`, `pause`, and `resume`.
2. Preserve the full room name returned by `room create`; later commands should use that full name.
3. Always include explicit identity flags for mutating commands: `--session <session_id>` and, when already a member, `--from <alias>`.
4. For discussion-only rooms, tell members not to edit files unless the planner explicitly authorizes implementation.
5. Prefer `send @everyone` for normal discussion rounds. Use `ask` only when tracked answers are needed.
6. When answering an `ask`, use `answer --parent <message_id>` rather than `send`.
7. Inspect room state with `room status` and transcript with `messages` before assuming delivery failed.

## Role Workflows
- If you are the planner starting or managing a room, read [PLANNER.md](PLANNER.md).
- If you are a member receiving a join bootstrap or collaboration delivery, read [MEMBER.md](MEMBER.md).

## Message Patterns

- Use `@everyone` for immediate delivery to all other active members.
- Use `@implementer-1` for immediate delivery to one member.
- Omit mentions for buffered room notes that can wait.
- Use `--kind task_assignment` for planner assignments.
- Use `--kind completion` for informational completion reports.
- Use `--kind error` when reporting blockers or failed attempts.

## Troubleshooting

- If commands cannot connect, verify the worker was restarted after enabling `collab` and check `curl -sS http://127.0.0.1:9100/room/list`.
- If a message does not arrive, check `room status --json` and `messages --json` for pending, failed, or blocked deliveries.
- If a member is blocked after an `ask`, they may need to answer the tracked question before buffered messages drain.
- If `room create` rejects the caller, the session may already belong to another open room; close or leave that room first.
