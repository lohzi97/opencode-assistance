## Context

The room list endpoint currently accepts only a room state filter and returns every matching room ordered newest-first. Since room transcripts remain in SQLite indefinitely, the number of historical rooms will increase over time. Agents generally need recent rooms first and only occasionally need older pages.

## Goals / Non-Goals

**Goals:**

- Bound room list responses by default.
- Preserve `state=open|closed|all` filtering.
- Support deterministic forward pagination through the newest-first list.
- Keep `agent-collab room list` a thin HTTP wrapper.

**Non-Goals:**

- Add room search by name or project directory.
- Change room retention or archival behavior.
- Change room status response shape except where list entries already use public room representation.

## Decisions

- Use `before=<room_id>` as the pagination cursor for newest-first listings. The server will resolve the cursor room's `(created_at, id)` position and return rooms older than that cursor under the same state filter.
- Keep ordering as `created_at DESC, id DESC`. This matches current newest-first discovery while making ties deterministic.
- Default missing limits to `50` and cap explicit limits at `200` for consistency with transcript pagination.
- Reject cursor rooms outside the selected state filter. This avoids surprising skips when a caller mixes `state` and cursor values.
- Add CLI flags `--before` and `--limit`, leaving all semantic validation to the server.

## Risks / Trade-offs

- Bare `room list` will no longer show every historical room -> mitigate with explicit pagination flags and default recent-first ordering.
- Cursor state mismatch can surprise callers -> mitigate with clear errors rather than silent fallbacks.
- The public room shape includes outstanding failures; list pages can still be heavier than a minimal index -> mitigate separately through the room status failure-bounding change where appropriate.
