## Why

Closed-room retention is indefinite, so `GET /room/list` can grow without bound over time. Returning every matching room is unnecessary for normal agent workflows and can make room discovery slow or noisy.

## What Changes

- Make `GET /room/list` support bounded pagination for open, closed, and all room listings.
- Add query parameters for `limit` and cursor-based continuation while preserving the existing `state` filter.
- Apply a safe default limit and a maximum cap.
- Extend the CLI room list command to forward pagination flags while remaining a thin wrapper.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: Room listing requirements now include bounded, cursor-style pagination.
- `collab-cli`: `room list` forwards pagination options to the server.

## Impact

- Affected code: `.opencode/server/collab.ts`, `.opencode/server/collab.test.ts`, `.opencode/scripts/agent-collab.ts`, and `.opencode/scripts/agent-collab.test.ts`.
- Affected APIs: `GET /room/list` query semantics.
- No new dependencies or storage migrations are expected.
