## ADDED Requirements

### Requirement: Pending deliveries follow compaction session handoff
The delivery engine SHALL retarget pending deliveries for a handed-off member from the superseded session id to the continuation session id before future delivery flushes.

#### Scenario: Buffered backlog targets continuation session
- **WHEN** a room member with pending buffered deliveries is handed off from `ses_old` to `ses_new`
- **THEN** those pending delivery rows target `ses_new` and the next eligible flush injects the backlog into `ses_new`

#### Scenario: Immediate backlog targets continuation session
- **WHEN** a room member with pending immediate deliveries is handed off from `ses_old` to `ses_new`
- **THEN** those pending delivery rows target `ses_new` and future injection attempts call `promptAsync` for `ses_new`

#### Scenario: Hard backlog targets continuation session
- **WHEN** a room member with pending hard deliveries is handed off from `ses_old` to `ses_new`
- **THEN** hard delivery abort and injection attempts use `ses_new` rather than `ses_old`

### Requirement: Continuation receives collaboration handoff reminder
After a successful session handoff, the delivery engine SHALL queue a reminder delivery to the continuation session containing the room name, member alias, role, old session id, new session id, and reply instructions.

#### Scenario: Reminder is delivered to continuation
- **WHEN** a member is handed off from `ses_old` to `ses_new`
- **THEN** a pending reminder delivery exists for `ses_new` and its injected prompt tells the agent its room, alias, role, and reply guidance

#### Scenario: Reminder preserves member routing options
- **WHEN** a handoff reminder is injected for a member with stored agent and model metadata
- **THEN** the `promptAsync` call includes the member's stored agent, model, and variant values

### Requirement: Handoff retargeting is atomic with delivery state
The system SHALL update member routing, pending deliveries, pending question targets, spawned-session ownership, handoff history, transcript message, and reminder delivery in one storage transaction.

#### Scenario: Failed handoff leaves deliveries unchanged
- **WHEN** a session handoff fails validation before commit
- **THEN** no pending deliveries are retargeted, no member route is changed, and no handoff transcript or reminder delivery is created
