# Agent Collab CLI Reference

Use the repository script:

```bash
bun .opencode/scripts/agent-collab.ts <command>
```

Default base URL: `http://127.0.0.1:9100`.

Override base URL when needed:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:9100 bun .opencode/scripts/agent-collab.ts <command>
```

Add `--json` when exact ids, delivery states, or raw server responses are needed.

## Room Commands

Create a room and join the caller as planner:

```bash
bun .opencode/scripts/agent-collab.ts room create \
  --name <base-room-name> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --project-dir <project-dir> \
  --json
```

Show room status:

```bash
bun .opencode/scripts/agent-collab.ts room status --room <room> --json
```

List rooms:

```bash
bun .opencode/scripts/agent-collab.ts room list --json
bun .opencode/scripts/agent-collab.ts room list --paused --json
bun .opencode/scripts/agent-collab.ts room list --closed --json
bun .opencode/scripts/agent-collab.ts room list --all --json
```

Pause or resume a room with the planner password. Prefer `--password-stdin` so the password is not stored in shell history:

```bash
printf '%s\n' '<room-password>' | bun .opencode/scripts/agent-collab.ts pause --room <room> --password-stdin --json
printf '%s\n' '<room-password>' | bun .opencode/scripts/agent-collab.ts resume --room <room> --password-stdin --json
```

Paused rooms reject normal mutations and close operations while preserving read-only status/list/transcript inspection. Resume prompts interrupted members before normal pending deliveries drain.

Close a room:

```bash
bun .opencode/scripts/agent-collab.ts room close \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --json
```

## Public Message Commands

Set the room public message from inline text:

```bash
bun .opencode/scripts/agent-collab.ts room public-message set \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --text "<public-message>" \
  --json
```

Set from a file or stdin:

```bash
bun .opencode/scripts/agent-collab.ts room public-message set \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --file <path> \
  --json

bun .opencode/scripts/agent-collab.ts room public-message set \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --stdin \
  --json
```

Clear the public message:

```bash
bun .opencode/scripts/agent-collab.ts room public-message clear \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --json
```

## Membership Commands

Add an existing session to a room:

```bash
bun .opencode/scripts/agent-collab.ts member add \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --target-session <target-session-id> \
  --name <target-alias> \
  --role <role> \
  --json
```

Remove a member:

```bash
bun .opencode/scripts/agent-collab.ts member remove \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --target <target-alias> \
  --json
```

Self-join as planner with the one-time room password:

```bash
bun .opencode/scripts/agent-collab.ts join \
  --room <room> \
  --session <session-id> \
  --name <alias> \
  --password <room-password> \
  --json
```

Read the room password from stdin:

```bash
bun .opencode/scripts/agent-collab.ts join \
  --room <room> \
  --session <session-id> \
  --name <alias> \
  --password-stdin \
  --json
```

Leave a room:

```bash
bun .opencode/scripts/agent-collab.ts leave \
  --room <room> \
  --session <session-id> \
  --from <alias> \
  --json
```

## Spawn Command

Spawn a new OpenCode session and add it to the room:

```bash
bun .opencode/scripts/agent-collab.ts spawn \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --name <alias> \
  --role <role> \
  --agent <agent> \
  --provider <provider-id> \
  --model <model-id> \
  --variant <variant> \
  --dir <project-dir> \
  --initial-prompt "<prompt>" \
  --json
```

Notes:

- `--provider` and `--model` must be supplied together.
- `--variant` requires both `--provider` and `--model`.
- If `--agent`, model, or directory are omitted, the service tries to derive defaults from the planner session.
- The spawned member receives join bootstrap first; the spawn initial prompt follows after bootstrap delivery.

## Messaging Commands

Send a message from inline body:

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <session-id> \
  --from <alias> \
  --body "<message>" \
  --kind note \
  --json
```

Send from a file or stdin:

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <session-id> \
  --from <alias> \
  --body-file <path> \
  --kind note \
  --json

bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <session-id> \
  --from <alias> \
  --body - \
  --kind note \
  --json
```

Send a hard interrupt as planner:

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <planner-session-id> \
  --from <planner-alias> \
  --body "@<target-alias> <message>" \
  --kind task_assignment \
  --hard \
  --json
```

Ask a tracked question:

```bash
bun .opencode/scripts/agent-collab.ts ask \
  --room <room> \
  --session <session-id> \
  --from <alias> \
  --body "@<target-alias> <question>" \
  --json
```

Answer a tracked question:

```bash
bun .opencode/scripts/agent-collab.ts answer \
  --room <room> \
  --session <session-id> \
  --from <alias> \
  --parent <message-id> \
  --body "<answer>" \
  --json
```

## Transcript Commands

Read the full room transcript:

```bash
bun .opencode/scripts/agent-collab.ts messages --room <room> --json
```

Read deliveries for a member alias or session id:

```bash
bun .opencode/scripts/agent-collab.ts messages --room <room> --member <alias> --json
bun .opencode/scripts/agent-collab.ts messages --room <room> --session <session-id> --json
```

Read a limited or incremental view:

```bash
bun .opencode/scripts/agent-collab.ts messages \
  --room <room> \
  --member <alias> \
  --since <message-id> \
  --limit <n> \
  --json
```

## Body Input Rules

- `send` accepts exactly one of `--body <text>`, `--body-file <path>`, or `--body -`.
- `ask` accepts `--body <text>` or `--body -`.
- `answer` accepts `--body <text>` or `--body -`.
- `public-message set` accepts exactly one of `--text <text>`, `--file <path>`, or `--stdin`.
- `join`, `pause`, and `resume` accept exactly one of `--password <value>` or `--password-stdin`; prefer `--password-stdin`.

## Common Error Meanings

- `collab service disabled`: worker did not load enabled collab config or needs restart.
- `room is closed`: the room no longer accepts mutations; use read-only commands.
- `room is paused`: resume the room before mutating or closing it; read-only commands remain available.
- `active member required`: supplied `--session` and `--from` alias do not match an active member.
- `planner role required`: the command requires a planner member.
- `unknown mention`: the message references an alias that is not active in the room.
- `question target is required`: `ask` or planner hard delivery needs explicit `@alias` or `@everyone` targets.
