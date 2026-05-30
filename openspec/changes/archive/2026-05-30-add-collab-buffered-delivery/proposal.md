## Why

Buffered delivery is the safe default collaboration path and must respect session availability before interruptive modes are added. This implements PRD delivery blockers, join bootstrap format, chronological ordering, and engine flow from `notes/agent-collaboration.md` lines 185-214, 215-235, 743-779, and 781-817.

## What Changes

- Add event/tick delivery engine for pending buffered deliveries.
- Use `GET /session/status`, `GET /question`, and shared SSE refresh points to evaluate blockers.
- Inject full chronological buffered backlogs through OpenCode `POST /session/:id/prompt_async`.
- Deliver join bootstrap before later room traffic and include reply instructions.

## Capabilities

### New Capabilities
- `collab-buffered-delivery`: Availability-aware buffered delivery, join bootstrap injection, and per-target chronological backlog flushing.

### Modified Capabilities
- None.

## Impact

- Requires a mocked/testable OpenCodeClient boundary.
- Starts the first active room watcher inside CollabService.
