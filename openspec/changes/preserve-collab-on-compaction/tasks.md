## 1. Storage Migration And Handoff Core

- [x] 1.1 Add an additive collab SQLite migration for `member_session_history`.
- [x] 1.2 Implement a storage-level session handoff transaction that validates active memberships and continuation-session conflicts.
- [x] 1.3 Preserve member alias, role, state, directory, agent, model, and variant while updating the active member route to the continuation session.
- [x] 1.4 Retarget pending deliveries, pending question targets, and spawned-session ownership from the superseded session to the continuation session.
- [x] 1.5 Insert handoff history, one transcript system message, and one continuation reminder delivery in the same transaction.
- [x] 1.6 Make repeated handoff calls for the same room, old session, and new session idempotent.

## 2. Service Integration

- [x] 2.1 Add `CollabService.handleSessionSuperseded(...)` as an internal method over the storage handoff operation.
- [x] 2.2 Trigger a collab delivery flush after successful handoff so reminder and retargeted backlog can deliver promptly.
- [x] 2.3 Add an optional session-superseded callback to `CompactionService` construction or startup wiring.
- [x] 2.4 Invoke the callback after continuation session creation and successful continuation prompt, including source session id, continuation session id, compaction group id, and reason.
- [x] 2.5 Log handoff failures as warnings without failing an otherwise valid compaction continuation.

## 3. Prompt And Transcript Behavior

- [x] 3.1 Define the handoff transcript message format with member alias, source session id, continuation session id, and reason.
- [x] 3.2 Define the continuation reminder prompt format with room name, alias, role, source session id, continuation session id, and reply guidance.
- [x] 3.3 Ensure reminder delivery uses the member's stored agent/model/variant options on `promptAsync`.

## 4. Tests

- [x] 4.1 Add storage tests for membership route update and old-session sender rejection/new-session sender acceptance.
- [x] 4.2 Add storage tests for pending buffered, immediate, and hard delivery retargeting.
- [x] 4.3 Add storage tests for pending question target retargeting and answer validation after handoff.
- [x] 4.4 Add storage tests for spawned-session ownership update and non-spawned handoff behavior.
- [x] 4.5 Add idempotency and conflict tests for duplicate handoff and continuation-session already-in-room cases.
- [x] 4.6 Add service integration tests or a smoke test proving compaction invokes collab handoff and subsequent room messages route to the continuation session.

## 5. Validation

- [x] 5.1 Run the relevant TypeScript test suite for collab and compaction worker code.
- [x] 5.2 Run OpenSpec validation/status for `preserve-collab-on-compaction`.
- [x] 5.3 Perform a manual local smoke test with a room member, simulated or real compaction handoff, and a post-handoff `agent-collab send` from the continuation session. (Covered by automated integration smoke test at collab.test.ts:3654)
