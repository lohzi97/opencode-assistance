## Context

The collab service stores rooms, members, messages, deliveries, questions, and spawned session metadata in `.opencode/server/state/collab.sqlite`. The worker delivery tick currently flushes pending deliveries and creates inactivity nudges for `open` rooms, while `closed` rooms reject new mutations but allow pre-close backlog to drain.

This change adds an operator-controlled pause lifecycle for rooms that should survive process restarts, PC shutdowns, and manually interrupted planner sessions. The operator may run the pause/resume CLI outside the room, so pause/resume cannot depend on an active planner session identity.

## Goals / Non-Goals

**Goals:**

- Add a durable `paused` room state that freezes delivery and inactivity-nudge activity without closing the room.
- Authenticate pause/resume with the room planner password rather than caller membership.
- Abort all active room members during pause, including planners, and record which members were actually interrupted.
- Resume interrupted members with a dedicated continue prompt while preventing pending deliveries from racing ahead of that prompt.
- Preserve existing pending deliveries, questions, members, transcripts, and room password behavior.
- Keep pause/resume available from the thin CLI using safe password input.

**Non-Goals:**

- Do not add a room UI or scheduler.
- Do not delete or archive interrupted OpenCode sessions.
- Do not cancel deliveries or question targets on pause.
- Do not allow editing membership or sending normal room traffic while paused.
- Do not make closed rooms resumable.
- Do not add password-authenticated close in this change; paused rooms must be resumed before the existing planner-identity close flow can be used.

## Decisions

1. **Use `rooms.state = 'paused'` as the lifecycle marker.**

   Rationale: Delivery queries and inactivity scans already key off `rooms.state = 'open'`, so a paused room naturally suppresses delivery and nudges if it is neither `open` nor `closed`. This keeps the core state model simple and restart-safe.

   Alternative considered: Store pause as a boolean column while keeping state `open`. That would require every open-room query to remember an additional predicate and is easier to miss.

2. **Authenticate pause/resume with the existing room planner password.**

   Rationale: The operator may pause the room from a non-member session or shell while the planner itself is busy or about to be interrupted. The existing password is already hash-only in storage and verified by self-join.

   Alternative considered: Require `session_id` and `from` planner identity. That makes pause/resume depend on exactly the session that may need to be stopped.

3. **Add per-pause member records for interruption and resume gating.**

   Rationale: Resume behavior depends on whether a member was actually interrupted. Interrupted members need a continue prompt first, then normal pending deliveries only after the session has run that prompt and returned idle. Non-interrupted members can resume normal delivery immediately.

   Proposed storage shape:

   ```sql
   CREATE TABLE room_pause_members (
     room_id                 TEXT NOT NULL,
     pause_id                TEXT NOT NULL,
     session_id              TEXT NOT NULL,
     name                    TEXT NOT NULL,
     was_interrupted          INTEGER NOT NULL,
     status_at_pause          TEXT,
     resume_prompted_at       INTEGER,
     resume_gate_seen_busy_at INTEGER,
     resume_gate_cleared_at   INTEGER,
     interrupt_error          TEXT,
     resume_error             TEXT,
     PRIMARY KEY (room_id, pause_id, session_id)
   );
   ```

   Additive room metadata may include `paused_at`, `paused_by`, `resumed_at`, and `active_pause_id`.

4. **Pause aborts all active members and records best-effort results.**

   Rationale: The intent is to freeze the whole room, including planner sessions. Abort failures should be surfaced, but a transient abort failure should not make the room impossible to pause if state freezing is the primary safety mechanism.

   The service should inspect `sessionStatus()` before aborting. Sessions in `busy` or `retry` are candidates for interruption. Idle or missing sessions are recorded but do not need a resume prompt.

5. **Resume prompt is not a normal room delivery.**

    Rationale: Normal deliveries are intentionally frozen while paused. The resume prompt is an administrative injection that reactivates interrupted members. It should use stored member route options (`directory`, `agent`, `model`, `variant`) and not create a pending normal delivery that would itself be blocked by the paused state.

6. **Pause/resume writes transcript audit messages without normal paused deliveries.**

   Rationale: Operators need a visible audit trail when reading room status or messages after an intentional pause. Pause and resume should insert system messages such as `room_paused` and `room_resumed`; these messages must not create normal deliveries while the room is paused.

7. **Resume gate blocks normal delivery until busy-then-idle is observed.**

    Rationale: `promptAsync()` can return before status reflects the queued resume prompt. Without an explicit gate, pending deliveries may flush immediately after resume and overtake the continue prompt.

    Gate clearing rule: after resume prompt injection, a member remains delivery-blocked until the service observes that session become `busy` or `retry`, then later `idle`. If the session is already idle and no busy transition is ever observed, the gate remains visible in status for diagnosis instead of guessing.

8. **Session handoff retargets active pause tracking.**

   Rationale: Existing collab handoff retargets members, deliveries, question targets, and spawned session records from an old session id to a continuation session id. Active pause-member records and resume-gate diagnostics must be retargeted the same way so interrupted members still receive resume prompts after compaction or continuation while the room is paused.

9. **Paused rooms reject all normal mutations.**

    Rationale: A paused room should be operationally stable. Allowing join/remove/send while paused would alter the exact state the operator intended to freeze.

    Read-only operations remain available, and `resume` remains available. Normal member-managed close is rejected while paused; operators must resume the room before using the existing close flow.

10. **Wrong-state lifecycle requests are rejected deterministically.**

    Rationale: Pause and resume are explicit lifecycle transitions rather than idempotent inspection calls. Pause on an already paused room and resume on an open room should return stable wrong-state errors without changing room metadata.

## Risks / Trade-offs

- **Risk: Resume gate never clears if OpenCode status does not expose the busy transition.** → Mitigation: expose gate state in room status and keep the behavior conservative; implementation can clear only on observed busy-then-idle to avoid delivery races.
- **Risk: Abort failure leaves a member running after the room is marked paused.** → Mitigation: record `interrupt_error` and expose it through status; the room still suppresses further collab delivery and nudges.
- **Risk: Password copied into shell history.** → Mitigation: CLI SHALL support and document `--password-stdin`; inline `--password` may exist for parity with join but is not preferred.
- **Risk: Existing code treats non-closed rooms as mutable.** → Mitigation: replace broad `openRoom()` usage in mutating operations with helpers that require `state = 'open'` and add tests for paused rejections.
- **Risk: Session handoff during pause loses resume tracking.** → Mitigation: retarget latest active pause-member records in the same transaction as existing member, delivery, question target, and spawned-session handoff updates.

## Migration Plan

- Additive SQLite migration adds pause metadata columns and pause member table without rewriting existing rooms.
- Existing `open` and `closed` rooms keep their current behavior.
- Rollback can ignore the new table/columns; any room left in `paused` would need manual state correction before running older code.

## Open Questions

None for proposal purposes. The review clarified that paused-session handoff records should be retargeted, paused rooms cannot be closed until resumed, wrong-state pause/resume requests should be rejected, and pause/resume should write transcript audit messages.
