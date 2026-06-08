## ADDED Requirements

### Requirement: Rooms can be paused and resumed with planner password
The system SHALL allow a room operator with the valid planner password to pause an `open` room and resume a `paused` room without requiring the operator to be an active room member. Pause SHALL set the room state to `paused`, persist pause metadata, create a transcript audit system message without creating normal deliveries, and preserve existing members, messages, deliveries, question targets, and planner password hash. Resume SHALL set the room state back to `open`, persist resume metadata, and create a transcript audit system message. Closed rooms SHALL NOT be pausable or resumable. Wrong-state lifecycle requests, including pause for an already paused room and resume for an open room, SHALL be rejected deterministically without changing room state.

#### Scenario: Password pauses open room
- **WHEN** a caller submits the valid planner password for an open room pause
- **THEN** the room state becomes `paused`, pause metadata is persisted, and existing pending deliveries remain `pending`

#### Scenario: Invalid pause password rejected
- **WHEN** a caller submits an invalid planner password for room pause
- **THEN** the operation is rejected and the room state is unchanged

#### Scenario: Password resumes paused room
- **WHEN** a caller submits the valid planner password for a paused room resume
- **THEN** the room state becomes `open` and resume metadata is persisted

#### Scenario: Closed room pause rejected
- **WHEN** a caller attempts to pause or resume a closed room
- **THEN** the operation is rejected and the room remains `closed`

#### Scenario: Already paused room pause rejected
- **WHEN** a caller submits the valid planner password for room pause on an already paused room
- **THEN** the operation is rejected with a wrong-state error and the existing pause metadata remains unchanged

#### Scenario: Open room resume rejected
- **WHEN** a caller submits the valid planner password for room resume on an open room
- **THEN** the operation is rejected with a wrong-state error and the room remains `open`

#### Scenario: Pause and resume transcript audit messages recorded
- **WHEN** a room is paused and later resumed with the valid planner password
- **THEN** room messages include system audit entries for the pause and resume lifecycle events without creating normal paused-room deliveries

### Requirement: Pause records member interruption state
When pausing a room, the system SHALL inspect active room members, attempt to abort active member sessions that are `busy` or `retry`, and persist a per-member pause record indicating whether that member was interrupted. The pause operation SHALL include planners and non-planners. Idle or missing sessions SHALL be recorded as not interrupted. Abort failures SHALL be recorded for status diagnostics without cancelling pending deliveries.

#### Scenario: Busy planner and implementer are interrupted
- **WHEN** a room with a busy planner and busy implementer is paused with the valid planner password
- **THEN** abort is attempted for both sessions and both members are recorded as interrupted when abort succeeds

#### Scenario: Idle member is not interrupted
- **WHEN** a room pause sees an active member session in `idle` status
- **THEN** no abort is required for that member and the pause member record marks the member as not interrupted

#### Scenario: Abort failure is recorded
- **WHEN** aborting an active member fails during pause
- **THEN** the room still becomes `paused`, the member pause record stores the interrupt error, and pending deliveries for that member remain `pending`

### Requirement: Paused rooms reject normal mutations
While a room is `paused`, the system SHALL reject normal room mutations, including send, ask, answer, join, leave, member add, member remove, spawn, public-message set, public-message clear, and planner-identity room close. Read-only status, list, and transcript operations SHALL remain available. Resume SHALL remain available with the valid planner password. A paused room SHALL need to be resumed before the existing planner-identity close operation can be used.

#### Scenario: Send rejected while paused
- **WHEN** an active member attempts to send a message to a paused room
- **THEN** the operation is rejected and no message or delivery record is created

#### Scenario: Member changes rejected while paused
- **WHEN** a caller attempts to join, leave, add, remove, or spawn a member in a paused room
- **THEN** the operation is rejected and room membership is unchanged

#### Scenario: Read-only inspection works while paused
- **WHEN** room status or room messages are requested for a paused room
- **THEN** the request succeeds and the response reports state `paused`

#### Scenario: Close rejected while paused
- **WHEN** a planner attempts to close a paused room using the existing planner-identity close operation
- **THEN** the operation is rejected and the room remains `paused`

### Requirement: Pause tracking follows session handoff
When an active room member session is handed off or continued while the room has an active pause, the system SHALL retarget active pause-member records and resume-gate diagnostics from the old session id to the continuation session id in the same lifecycle as existing member, delivery, question target, and spawned-session retargeting.

#### Scenario: Interrupted paused member handoff remains resumable
- **WHEN** an interrupted member session is handed off to a continuation session while the room is paused
- **THEN** the latest active pause-member record references the continuation session id and resume prompt/gate behavior applies to that continuation session

#### Scenario: Paused non-interrupted member handoff remains tracked
- **WHEN** a non-interrupted active member session is handed off to a continuation session while the room is paused
- **THEN** the pause-member record references the continuation session id and the member remains eligible for normal delivery after resume according to non-interrupted rules

### Requirement: Room listings support paused rooms
Room list state filtering SHALL support `paused` in addition to `open`, `closed`, and `all`. Cursor validation SHALL treat a paused cursor as valid only when the selected state filter is `paused` or `all`.

#### Scenario: Paused room listed by paused filter
- **WHEN** rooms are listed with `state=paused`
- **THEN** the response includes paused rooms ordered by the existing newest-first pagination rules

#### Scenario: Paused cursor rejected for open filter
- **WHEN** rooms are listed with `state=open` and `before` references a paused room
- **THEN** the request is rejected with a clear cursor-state error
