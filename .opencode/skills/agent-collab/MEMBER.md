# Member Workflow

Use this workflow when you receive a join bootstrap or collaboration delivery from an `agent-collab` room.

For complete command syntax, see [CLI.md](CLI.md).

## First Response

1. Identify the room name, your alias, your role, and the current room public message.
2. Do not assume you may edit files. If the planner has not explicitly assigned implementation, inspect only.
3. Reply through the CLI, not as an ordinary user-facing answer.
4. Start by sending readiness and your understanding.

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <your-session-id> \
  --from <your-alias> \
  --body "ready. Understanding: <summary>. Initial risks: <risks>. Recommended approach: <approach>."
```

## Normal Updates

Use `send` for findings, risks, blockers, and completion reports:

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <your-session-id> \
  --from <your-alias> \
  --kind note \
  --body "Findings: <findings>. Risks: <risks>. Recommendation: <recommendation>."
```

Use `--kind completion` when reporting a completed assigned task:

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <your-session-id> \
  --from <your-alias> \
  --kind completion \
  --body "Completed: <summary>. Evidence: <tests or files>. Remaining risks: <risks>."
```

## Answering Tracked Questions

If the delivery is a tracked question, first inspect the message id:

```bash
bun .opencode/scripts/agent-collab.ts messages --room <room> --member <your-alias> --json
```

Then answer with the parent question id:

```bash
bun .opencode/scripts/agent-collab.ts answer \
  --room <room> \
  --session <your-session-id> \
  --from <your-alias> \
  --parent <message-id> \
  --body "<answer>"
```

Do not use `send` to answer a tracked question unless the parent question was already answered or cancelled.

## Raising Questions

**Never use the `question` tool.** When you have a doubt, need clarification, or are blocked on a decision, raise your question through the `agent-collab` CLI instead. The target depends on context:

- Use `send @<planner-alias>` for scope, design, or assignment questions.
- Use `send @<member-alias>` for domain-specific or implementation questions directed at another member.
- Use `ask @<target>` when the question blocks your progress and you need a tracked answer before continuing.

```bash
# Informal clarification
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <your-session-id> \
  --from <your-alias> \
  --body "Question: <your question here>"

# Tracked blocking question
bun .opencode/scripts/agent-collab.ts ask \
  --room <room> \
  --session <your-session-id> \
  --from <your-alias> \
  --target <target-alias> \
  --body "Blocked on: <question>. Need answer before I can proceed."
```

## If The Room Is Closed

If a room is closed, do not try to send, ask, answer, leave, or mutate membership. Use read-only inspection only:

```bash
bun .opencode/scripts/agent-collab.ts messages --room <room> --member <your-alias> --json
bun .opencode/scripts/agent-collab.ts room status --room <room> --json
```
## User Facing Response

You are comunicating through `agent-collab`, user-facing response/answer is not important. Your final user-facing response/answer should be EXTREMELY short and concise (a few words/sentences is enough) that describe your current interaction with the room. 
