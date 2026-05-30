# Planner Workflow

Use this workflow when you are the planner starting or managing an `agent-collab` room.

For complete command syntax, see [CLI.md](CLI.md).

## 1. Create The Room

Use the current planner session id and an explicit planner alias:

```bash
bun .opencode/scripts/agent-collab.ts room create \
  --name <base-room-name> \
  --session <planner-session-id> \
  --from planner \
  --project-dir <project-dir> \
  --json
```

Save the returned `name` as `<room>` and keep the one-time `planner_password` private.

## 2. Set Shared Context

Set a concise public message before adding others:

```bash
bun .opencode/scripts/agent-collab.ts room public-message set \
  --room <room> \
  --session <planner-session-id> \
  --from planner \
  --text "Topic: <topic>. Goal: discuss only, no edits unless explicitly assigned. Report findings, risks, and recommendation."
```

## 3. Spawn Participants

Spawn implementers or reviewers with explicit aliases and roles:

```bash
bun .opencode/scripts/agent-collab.ts spawn \
  --room <room> \
  --session <planner-session-id> \
  --from planner \
  --name implementer-1 \
  --role implementer \
  --agent sebastian \
  --dir <project-dir> \
  --initial-prompt "Inspect the relevant context for the topic. Do not edit files. Reply with ready, your understanding, key risks, and recommended approach."
```

Repeat with aliases such as `implementer-2`, `reviewer`, or `researcher`.

You will recieve a ordinary user message that shows the participant reply. You don't need to poll for room status or transcript to confirm the participant availablility.

## 4. Start The Discussion

Use a mentioned message for an immediate first discussion round:

```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room> \
  --session <planner-session-id> \
  --from planner \
  --kind task_assignment \
  --body "@everyone Please inspect the topic and respond with your findings, risks, and recommendation. Do not edit files."
```

Use `ask` when you need tracked answers:

```bash
bun .opencode/scripts/agent-collab.ts ask \
  --room <room> \
  --session <planner-session-id> \
  --from planner \
  --body "@everyone Which approach should we choose, and why?"
```

## 5. Monitor And Synthesize

Read the transcript and delivery states:

```bash
bun .opencode/scripts/agent-collab.ts messages --room <room> --json
bun .opencode/scripts/agent-collab.ts room status --room <room> --json
```

After members respond, synthesize the final decision, implementation sequence, risks, and next actions for the user.

## 6. Close The Room

Close rooms when coordination is finished:

```bash
bun .opencode/scripts/agent-collab.ts room close \
  --room <room> \
  --session <planner-session-id> \
  --from planner
```
