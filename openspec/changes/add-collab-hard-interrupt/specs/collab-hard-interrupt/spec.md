## ADDED Requirements

### Requirement: Hard interrupt is planner-only and strictly validated
The system SHALL allow hard delivery only from an active planner in an open room to active non-self targets after normal mention validation passes, as specified in PRD lines 823-834.

#### Scenario: Non-planner hard rejected
- **WHEN** a non-planner sends a message with `hard: true`
- **THEN** the operation is rejected and no abort is attempted

#### Scenario: Self-target hard rejected
- **WHEN** a planner hard-targets itself
- **THEN** the operation is rejected before delivery records are created

### Requirement: Multi-target hard delivery is all-or-nothing
The engine SHALL abort all targeted sessions, wait for all to become idle, inject to none if any wait fails, and mark all targeted deliveries failed on barrier failure, per PRD lines 840-849.

#### Scenario: One target fails idle wait
- **WHEN** one target does not become idle before timeout
- **THEN** no target receives the hard prompt and all hard delivery records for the message are marked failed

### Requirement: Hard delivery preserves chronological context
If a hard message is newer than older pending buffered records for the same target, the engine SHALL inject one chronological batch with older buffered items first and the hard message last, per PRD lines 211-212.

#### Scenario: Hard follows buffered backlog
- **WHEN** a target has older buffered messages and a newer hard message
- **THEN** the injected prompt preserves that chronological order after the hard wait succeeds
