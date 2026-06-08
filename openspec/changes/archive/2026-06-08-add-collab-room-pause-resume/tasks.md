## 1. Storage And State Model

- [x] 1.1 Extend room state types and room-list parsing to include `paused`.
- [x] 1.2 Add additive SQLite migration for room pause metadata and `room_pause_members` tracking records.
- [x] 1.3 Add storage helpers to resolve pausable, resumable, running, and read-only rooms without treating paused rooms as mutable open rooms.
- [x] 1.4 Expose paused state, pause metadata, and resume gate diagnostics through room status without exposing planner password data.
- [x] 1.5 Retarget active pause-member records and resume-gate diagnostics during session handoff/continuation.

## 2. Pause API

- [x] 2.1 Add `POST /room/:room/pause` route that verifies the planner password hash instead of caller membership.
- [x] 2.2 Implement pause logic that inspects active member statuses and aborts busy/retry members, including planners.
- [x] 2.3 Persist per-member pause records with interruption status and abort errors while preserving deliveries and question targets.
- [x] 2.4 Reject pause for closed or already paused rooms with deterministic wrong-state errors.
- [x] 2.5 Persist pause transcript audit messages without creating normal deliveries while paused.

## 3. Resume API And Delivery Gates

- [x] 3.1 Add `POST /room/:room/resume` route that verifies the planner password hash and resumes only paused rooms, rejecting open or closed rooms with deterministic wrong-state errors.
- [x] 3.2 Implement administrative resume prompt injection for active members interrupted by the latest pause using stored member routing options.
- [x] 3.3 Add resume gate checks so interrupted members do not receive normal pending deliveries until observed busy/retry after resume and later idle.
- [x] 3.4 Ensure non-interrupted members can flush pending deliveries immediately after resume under existing delivery blockers.
- [x] 3.5 Persist resume transcript audit messages before normal post-resume delivery flushing.

## 4. Paused Room Behavior

- [x] 4.1 Suppress delivery flushes and inactivity notice creation for paused rooms.
- [x] 4.2 Reject send, ask, answer, join, leave, member add/remove, spawn, public-message changes, and planner-identity close while paused; require resume before close.
- [x] 4.3 Keep read-only room status, room list, and transcript APIs available for paused rooms.

## 5. CLI And Documentation

- [x] 5.1 Add `agent-collab pause` and `agent-collab resume` commands with `--password` and `--password-stdin` support.
- [x] 5.2 Add `agent-collab room list --paused` and forward `state=paused` to the server.
- [x] 5.3 Update agent-collab skill/CLI documentation in both the active skill and openspec-scaffold template copies to describe paused lifecycle behavior and prefer `--password-stdin`.

## 6. Verification

- [x] 6.1 Add server tests for password-authenticated pause/resume state transitions, wrong-state rejection, mutation rejection, read-only inspection, transcript audit messages, and paused-session handoff retargeting.
- [x] 6.2 Add delivery tests for paused suppression, resume prompt injection, resume gate clearing, and non-interrupted member delivery flushing.
- [x] 6.3 Add CLI tests for pause/resume requests, password stdin handling, error passthrough, and paused room listing.
- [x] 6.4 Run the relevant Bun test suite and OpenSpec validation for `add-collab-room-pause-resume`.
