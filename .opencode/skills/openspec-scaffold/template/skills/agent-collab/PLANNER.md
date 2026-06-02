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

Set a public message before adding others. The public message is a planner-only, pinned blurb attached to the room. It is included in every future delivery to members, so each participant sees the current public message alongside each room message they receive.

```bash
bun .opencode/scripts/agent-collab.ts room public-message set \
  --room <room> \
  --session <planner-session-id> \
  --from planner \
  --text "Topic: <topic>. Goal: discuss only, no edits unless explicitly assigned. Report findings, risks, and recommendation."
```

### Public Message Guidelines

**Use as a standing room contract.** Define the scope, constraints, and rules of the collaboration. This ensures every participant is reminded of the ground rules on each delivery, even if they joined late or the discussion has drifted.

**Use as an evolving task board.** As decisions are made and work progresses, update the public message to reflect the current state -- for example, switching from "discuss only" to specific assignments. Members receive the updated context on their next delivery without needing to read the full transcript.

**Use as a scope guardrail.** If the room is discussion-only, the public message is the single source of truth that says "no edits." If someone starts editing despite that, the public message serves as the agreed-upon constraint that justifies corrective action.

**Keep it concise.** The public message is prepended to every delivery. A verbose public message wastes context window on every single message a member receives. Keep it to a few sentences covering scope, goal, and current assignments.

**Do not put transient discussion in the public message.** Questions, responses, and general discussion belong in regular `send` or `ask` messages. The public message should only contain high-signal, persistent context: rules, scope, and current assignment state.

**Update at transition points.** Update the public message when the room transitions between phases (discussion to implementation, implementation to review) or when the scope changes. This keeps everyone aligned without the planner repeating instructions in every message.

Clear the public message when it is no longer needed:

```bash
bun .opencode/scripts/agent-collab.ts room public-message clear \
  --room <room> \
  --session <planner-session-id> \
  --from planner \
  --json
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
