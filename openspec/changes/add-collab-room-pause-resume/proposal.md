## Why

Active collaboration rooms currently resume delivery and inactivity-nudge behavior automatically after the worker restarts, which makes it difficult for Master to intentionally pause a room before shutting down, interrupting a planner, or taking a break. A first-class pause/resume lifecycle gives explicit operator control without closing the room or losing pending collaboration context.

## What Changes

- Add a password-authenticated room pause operation that freezes an open room without closing it.
- Add a password-authenticated room resume operation that reopens a paused room and restarts interrupted members deliberately.
- Pause SHALL abort all active room members, including planners, and record which sessions were actually interrupted.
- Paused rooms SHALL keep existing deliveries pending, suppress inactivity nudges, reject new room mutations, and reject close until the room is resumed.
- Resume SHALL inject a dedicated continue prompt into members interrupted by the pause.
- Resume SHALL delay normal pending delivery flushes for interrupted members until they have run the resume prompt and become idle again.
- Resume SHALL allow non-interrupted members to receive pending deliveries immediately, subject to existing delivery blockers.
- Pause/resume lifecycle events SHALL be visible in the room transcript as system messages without creating normal deliveries while paused.
- Session handoff while paused SHALL retarget pause/resume tracking records to the continuation session.
- Add CLI commands for pause/resume with safe room-password input.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `collab-core`: Add paused room lifecycle state, room-password authentication for pause/resume, paused-room mutation restrictions, and pause bookkeeping.
- `collab-delivery`: Suppress delivery and inactivity nudge processing for paused rooms, inject resume prompts for interrupted members, and gate pending delivery flushes until interrupted members become idle after resume.
- `collab-cli`: Add `pause` and `resume` commands with safe password input and thin-wrapper HTTP behavior.

## Impact

- Affected code: `.opencode/server/collab.ts`, `.opencode/scripts/agent-collab.ts`, and collab tests.
- Affected API: add pause/resume room endpoints under the local collab service.
- Affected storage: additive SQLite migration for room pause metadata and per-member pause/resume tracking.
- Affected docs: agent-collab CLI/skill documentation should describe paused room behavior and password handling.
- No external service dependency changes.
