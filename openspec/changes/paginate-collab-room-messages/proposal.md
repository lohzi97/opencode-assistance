## Why

Room transcripts can grow quickly during agent collaboration, but `GET /room/:room/messages` currently returns the full matching message set. This creates large responses, wastes context when agents inspect rooms, and drifts from the intended API contract where `since` and `limit` are supported.

## What Changes

- Make `GET /room/:room/messages` honor `since` and `limit` query parameters for both room-wide and member-scoped transcript reads.
- Apply a safe default limit when no explicit limit is supplied.
- Cap explicit limits to prevent unexpectedly large responses.
- Preserve chronological response ordering and delivery annotations.
- Keep the existing CLI `agent-collab messages --since --limit` behavior as a thin wrapper and add server-side verification that the flags are honored.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: Transcript inspection requirements now include bounded, cursor-style pagination for room-wide and member-scoped message views.
- `collab-cli`: Transcript read behavior is verified against the paginated server contract while preserving thin-wrapper semantics.

## Impact

- Affected code: `.opencode/server/collab.ts`, `.opencode/server/collab.test.ts`, and possibly `.opencode/scripts/agent-collab.test.ts`.
- Affected APIs: `GET /room/:room/messages` query semantics.
- No new dependencies or storage tables are expected.
