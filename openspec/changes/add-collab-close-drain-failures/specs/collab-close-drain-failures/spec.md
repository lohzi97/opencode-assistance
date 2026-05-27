## ADDED Requirements

### Requirement: Closed rooms reject new mutations but drain existing backlog
After close, the system SHALL reject new send, ask, answer, join, leave, member add/remove, spawn, and public-message mutations while allowing already-created deliveries and the closure message to drain, per PRD lines 850-870.

#### Scenario: Mutation after close rejected
- **WHEN** a member sends a new message after room closure
- **THEN** the operation is rejected and no message or delivery record is created

#### Scenario: Existing backlog drains after close
- **WHEN** buffered deliveries existed before close and the target later becomes eligible
- **THEN** those deliveries and the closure message drain chronologically

### Requirement: Close drain adjusts blockers correctly
During close drain, unresolved collab questions SHALL NOT block final buffered delivery, while busy, retry, and pending user-question blockers still apply, per PRD lines 867-870.

#### Scenario: Unanswered collab question does not block close drain
- **WHEN** a closed room has an unresolved collab question and pending buffered backlog
- **THEN** the backlog may drain once other session blockers are clear

### Requirement: Delivery failures are retried or surfaced
The engine SHALL retry transient transport/backend failures, not retry validation failures, allow pre-close pending deliveries to retry after close, and surface permanent failures in status and message views per PRD lines 872-879.

#### Scenario: Permanent failure visible in status
- **WHEN** a delivery fails with a validation error
- **THEN** it is marked failed and appears in room status outstanding failure data
