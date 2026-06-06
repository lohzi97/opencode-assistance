## Context

`GET /room/:room/messages` currently accepts query parameters through the CLI, but the server only uses `session_id` and `from`. It returns every room message for room-wide views and every targeted delivery for member-scoped views. The collaboration PRD already defines `since` and `limit`, so this change completes the intended contract rather than introducing a new access pattern.

## Goals / Non-Goals

**Goals:**

- Bound transcript responses by default.
- Honor `since=<message_id>` as a forward cursor for both room-wide and member-scoped reads.
- Honor `limit=<n>` with validation and a maximum cap.
- Preserve chronological ordering and existing public response shapes.
- Keep the CLI as a thin wrapper.

**Non-Goals:**

- Add reverse pagination or arbitrary offsets.
- Add full-text search or filtering by kind/sender.
- Change message retention.
- Change delivery behavior or buffered flush batching.

## Decisions

- Use cursor-style pagination by message id. The server will resolve `since` to that message's `(created_at, id)` position in the requested room and return messages strictly after it. This avoids offset instability and matches the existing CLI flag.
- Default missing limits to `50` and cap explicit limits at `200`. This keeps normal agent usage concise while allowing larger manual inspection when needed.
- Reject invalid `since` values for the requested room. Returning from the start on a bad cursor would hide caller mistakes and could unexpectedly return large data.
- Apply pagination before loading delivery annotations. The implementation should first select bounded message ids, then load deliveries only for that page.
- Preserve ascending chronological output. Agents can use the last returned message id as the next cursor without reordering results.

## Risks / Trade-offs

- Invalid cursors can break older ad-hoc callers that pass arbitrary ids -> mitigate with a clear `400` error.
- A default limit changes bare `agent-collab messages --room ...` from full transcript to first page -> mitigate by documenting/useful `--limit` behavior and keeping explicit larger limits available.
- Identical timestamps require deterministic tie-breaking -> mitigate by ordering and cursoring with `(created_at, id)`.
