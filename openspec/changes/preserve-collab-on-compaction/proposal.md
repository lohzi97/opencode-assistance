## Why

Custom compaction intentionally continues work in a brand-new OpenCode session, but `agent-collab` currently treats `session_id` as the active member identity and delivery target. When a room member rolls over, the room can keep routing messages, questions, hard interrupts, and sender validation to the superseded session, breaking collaboration for long-running rooms.

## What Changes

- Add a collab session handoff path that is invoked when custom compaction creates a continuation session.
- Preserve a room member's alias, role, prompt routing metadata, pending deliveries, pending question targets, and spawned-session ownership across session rollover.
- Record an auditable old-session to new-session handoff history for room members.
- Insert a room system message and bootstrap/reminder delivery so the continuation session knows its collaboration identity.
- Keep the handoff internal to the worker services; no new public CLI command is required for v1.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: active room membership must support session handoff without changing the member alias or role.
- `collab-delivery`: pending and future delivery routing must target the continuation session after handoff.
- `collab-questions-answers`: pending question targets must follow the logical member through handoff.
- `collab-spawn`: spawned collaboration sessions must remain associated with the room after compaction rollover.

## Impact

- Affected code: `.opencode/server/compaction.ts`, `.opencode/server/collab.ts`, `.opencode/server/index.ts`, and related tests.
- Affected storage: additive SQLite migration for collab member session handoff history.
- Affected behavior: custom compaction emits an internal session-superseded notification to collab after a continuation session is created successfully.
- No breaking changes to the `agent-collab` CLI or existing room HTTP API are planned.
