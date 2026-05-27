## ADDED Requirements

### Requirement: Immediate soft delivery respects soft blockers
The engine SHALL deliver immediate messages during `busy` but SHALL block them during pending user question or `retry`, as specified in PRD lines 194-199.

#### Scenario: Busy target receives immediate message
- **WHEN** a target is `busy` with no pending user question and has an immediate delivery
- **THEN** the engine injects the message

#### Scenario: Retry target blocks immediate message
- **WHEN** a target is in `retry`
- **THEN** immediate delivery remains pending

### Requirement: Immediate delivery preserves older buffered context
If an immediate message is newer than pending buffered deliveries for the same target, the engine SHALL inject one chronological batch containing older buffered items first and the immediate item last, per PRD lines 209-212.

#### Scenario: Buffered backlog before immediate mention
- **WHEN** a target has an older buffered message and a newer immediate mention
- **THEN** one prompt is injected with the buffered message before the immediate message

### Requirement: Message kind does not change urgency
The system SHALL determine immediate urgency from mentions and hard flag only, not from `kind`, per PRD lines 179-180.

#### Scenario: Task assignment without mention is buffered
- **WHEN** a member sends a `task_assignment` message without mentions
- **THEN** delivery records are buffered, not immediate
