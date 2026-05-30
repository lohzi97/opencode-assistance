## Context

The current delivery formatter in `.opencode/server/collab.ts` renders each pending delivery with `formatDeliverySection()` and joins those full sections in `formatDeliveryPrompt()`. This preserves chronological order but causes combined backlogs to repeat the room header, public message, and reply instruction for every delivered message.

The room transcript itself is already readable in `agent-collab messages`; the injected prompt should mirror that transcript shape when a backlog flushes. The public message and reply instruction are room-level context for the target prompt, not per-message content.

## Goals / Non-Goals

**Goals:**

- Make normal combined deliveries easy to scan as one compact chronological transcript.
- Preserve delivery ordering, blockers, targeting, state transitions, and reply-instruction template rendering.
- Keep public-message context present in every collaboration injection, but render it once per injected prompt.
- Keep join bootstrap onboarding understandable and first in mixed bootstrap-plus-message batches.

**Non-Goals:**

- Change HTTP APIs, CLI commands, SQLite schema, routing, blocker rules, or delivery modes.
- Change room transcript storage or `agent-collab messages` output.
- Remove delivery modes from database records or API delivery annotations.
- Redesign question/answer semantics.

## Decisions

1. Use one normal delivery wrapper per injected prompt.

   Normal delivered room messages should render under one wrapper:

   ```markdown
   [Room: <room-name>]

   [Public Message]
   <public-message>

   [Message]

   [<YYYYMMDDHHmmss>|<kind>] <from>:

   <message>

   ---
   <reply_instruction>
   ```

   Rationale: this removes duplicated room-level context while keeping the prompt self-contained. The alternative was to keep one section per message and only shorten the header, but that would still duplicate public context and reply instructions.

2. Treat delivery mode as non-rendered metadata for normal injected text.

   Delivery mode remains in persistence and inspection APIs, but normal prompt text will show only timestamp, kind, sender, and body. Rationale: agents reason about the discussion content, not whether the service used buffered, immediate, or hard routing to wake them. Tests can still assert delivery mode through delivery records.

3. Use existing timestamp formatting semantics.

   The message entry timestamp should be derived from each message `created_at` using the existing local-time `YYYYMMDDHHmmss` formatter used for room names. Rationale: this matches repository date preferences and avoids adding a new time dependency or timezone policy.

4. Keep bootstrap special but avoid repeated reply guidance.

   Join bootstrap content should stay first and include alias/role onboarding. If a batch contains bootstrap and later normal messages, render the bootstrap block first, then render later messages in the compact transcript block, and render the reply instruction once at the end of the whole injected prompt. Rationale: bootstrap is not a normal chat message, but repeated reply guidance is the same readability problem.

5. Preserve configured reply instruction rendering.

   Continue resolving `collab.reply_instruction` once per target prompt and rendering it with target variables. For compact batches, `{from}` should be rendered from the last delivered normal message sender when normal messages exist, matching the effective latest message that prompted the reply. For bootstrap-only prompts, `{from}` remains the bootstrap sender (`system`).

## Risks / Trade-offs

- [Risk] Tests or downstream manual expectations look for `Delivery: immediate` or `Delivery: hard` in prompt text. -> Mitigation: update tests to assert delivery mode in delivery records and assert prompt text omits delivery labels intentionally.
- [Risk] Mixed bootstrap-plus-message batches become ambiguous if bootstrap and transcript share one `[Message]` block. -> Mitigation: keep bootstrap as a distinct onboarding block before the compact normal message transcript.
- [Risk] Rendering public message once could hide which historical message saw which public-message state. -> Mitigation: this is already the current latest public message by design, not a historical snapshot per message; the transcript message bodies retain public-message update events when relevant.
- [Risk] `{from}` in reply instruction is less obvious for multi-message batches. -> Mitigation: use the last delivered normal message sender because it is the most recent conversational turn; document and test that behavior.
