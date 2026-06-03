## ADDED Requirements

### Requirement: Active members survive compaction session handoff
The system SHALL provide an internal session handoff operation that updates active room membership from a superseded OpenCode session id to its continuation session id while preserving the member alias, role, state, joined timestamp, directory, agent, model, and variant.

#### Scenario: Active member route is updated
- **WHEN** custom compaction reports that source session `ses_old` continued as `ses_new` and `ses_old` is an active member of an open room as alias `worker-1`
- **THEN** the active member row for `worker-1` uses `ses_new` as its session id and preserves its alias, role, state, directory, agent, model, and variant

#### Scenario: Old session can no longer send as member
- **WHEN** a member handoff has updated alias `worker-1` from `ses_old` to `ses_new`
- **THEN** member-authored messages from `ses_old` with `from=worker-1` are rejected and messages from `ses_new` with `from=worker-1` are accepted

#### Scenario: Continuation already in open room is rejected
- **WHEN** custom compaction reports a handoff to a continuation session that already belongs to another open room
- **THEN** the handoff is rejected for the conflicting room and no membership rows are partially updated

### Requirement: Session handoff is auditable and idempotent
The system SHALL persist session handoff history for each affected room member and SHALL treat a repeated handoff for the same room, old session, and new session as successful without duplicating transcript or reminder messages.

#### Scenario: Handoff history is recorded
- **WHEN** an active room member is handed off from `ses_old` to `ses_new`
- **THEN** a `member_session_history` record stores the room id, member alias, old session id, new session id, reason, and creation time

#### Scenario: Repeated handoff does not duplicate effects
- **WHEN** the same handoff is reported again for the same room member, old session id, and new session id
- **THEN** the operation returns successfully without inserting duplicate history rows, duplicate system transcript messages, or duplicate continuation reminder deliveries

### Requirement: Session handoff appears in room transcript
The system SHALL insert a system room message when a member session handoff succeeds, identifying the member alias, old session id, new session id, and handoff reason.

#### Scenario: Room transcript includes handoff message
- **WHEN** a room member is handed off after custom compaction
- **THEN** the room messages view includes a system message documenting the handoff
