## Why

Buffered collaboration backlogs are currently injected as repeated standalone delivery sections. When several buffered messages flush together, the prompt repeats the room identity, public message, and reply instruction for every item, making the transcript harder for agents to scan and reason about.

This change makes combined collaboration injections read like a compact room transcript while preserving the same delivery ordering, public context, and reply guidance.

## What Changes

- Render normal message backlogs as one self-contained room prompt with a single `[Room: <room-name>]` header.
- Include the current public message at most once per injected prompt, before the message transcript.
- Render all non-bootstrap delivered messages under one `[Message]` block as chronological entries in the form `[<YYYYMMDDHHmmss>|<kind>] <from>:` followed by the message body.
- Remove delivery mode from the injected text because it is an internal routing detail rather than useful discussion context.
- Render the resolved reply instruction once at the end of the injected prompt.
- Keep join bootstrap prompts explicitly self-contained and compatible with existing onboarding semantics.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `collab-delivery`: Change the required collaboration injection format for normal and combined deliveries so batches are grouped under one room/public-message/reply-instruction wrapper with per-message timestamp/kind/sender entries.

## Impact

- Affected code: `.opencode/server/collab.ts`, especially `formatDeliveryPrompt()` and related delivery prompt rendering.
- Affected tests: `.opencode/server/collab.test.ts` should assert the compact batch format, absence of repeated public-message/reply-instruction blocks, chronological message entries, and continued bootstrap behavior.
- Affected specs: `openspec/specs/collab-delivery/spec.md`.
- No HTTP API, CLI command, storage schema, delivery ordering, or routing behavior changes are expected.
