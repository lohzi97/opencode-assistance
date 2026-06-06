## Why

Agent collaboration rooms can become silently stuck when an implementer, reviewer, or planner forgets to report back with `agent-collab send`, `ask`, or `answer`. Because room prompts are only injected when delivery activity exists, prolonged silence is indistinguishable from valid ongoing work unless the planner manually checks the room.

## What Changes

- Add configurable inactivity nudges for open collaboration rooms.
- Detect rooms with no meaningful member activity for a configured duration.
- Inject a system-authored inactivity notice to active planners only, so orchestration can recover without interrupting implementers by default.
- Rate-limit repeated notices separately from normal room activity.
- Exclude inactivity notices themselves from meaningful-activity calculations to avoid self-sustaining heartbeat noise.
- Include inactivity timing fields in room status so planners can inspect when a room last had activity and when the next nudge may occur.
- Keep closed rooms and already-draining delivery backlogs unaffected.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: Add configuration, persistence, transcript/status semantics, and meaningful-activity definitions for room inactivity nudges.
- `collab-delivery`: Add delivery-engine behavior for creating and injecting planner inactivity notices without disturbing existing delivery ordering and blocker rules.

## Impact

- Affected code: Collab service configuration loading, SQLite migrations/state access, room status response construction, message persistence, and delivery engine fallback tick/watch loop.
- Affected APIs: `GET /room/:room_id/status` gains inactivity metadata fields. No breaking request changes.
- Affected storage: Additive SQLite migration for room-level inactivity nudge tracking, or equivalent durable state.
- Affected tests: Unit and integration coverage for inactivity detection, notice rate limiting, planner targeting, closed-room exclusion, and prompt injection behavior.
- Dependencies: No new external dependencies expected.
