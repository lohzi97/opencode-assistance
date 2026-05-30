# collab-delivery Specification

## Purpose

Define the durable contract for collaboration message delivery execution: buffered delivery, immediate soft delivery, blocker handling, chronological batching, self-contained prompt injection, and close-drain/failure semantics. This spec assumes core rooms, members, messages, and delivery records exist under `collab-core`.

## Requirements

### Requirement: Buffered delivery waits for eligibility
The engine SHALL block buffered delivery when the target session is `busy`, `retry`, has a pending user question, or has an unresolved collab question while the room is open.

#### Scenario: Busy target blocks buffered backlog
- **WHEN** a target has pending buffered deliveries and session status `busy`
- **THEN** no prompt is injected and deliveries remain `pending`

#### Scenario: Idle eligible target receives backlog
- **WHEN** a target has pending buffered deliveries and no blockers
- **THEN** the full pending backlog is injected in one chronological batch

### Requirement: Join bootstrap precedes later traffic
The engine SHALL deliver the join bootstrap before later room traffic for newly added, spawned, or self-joined members.

#### Scenario: Bootstrap before assignment
- **WHEN** a member has a pending bootstrap and a later task message
- **THEN** the injected batch places the bootstrap content before the task message

### Requirement: Collaboration injections are self-contained
Every injected delivery SHALL include room identity, message content or combined batch, current public message when present, and reply instructions.

#### Scenario: Buffered prompt format
- **WHEN** buffered messages are injected
- **THEN** the prompt contains room name, message content, separator, and reply instruction

### Requirement: Immediate soft delivery respects soft blockers
The engine SHALL deliver immediate messages during `busy` but SHALL block them during pending user question or `retry`.

#### Scenario: Busy target receives immediate message
- **WHEN** a target is `busy` with no pending user question and has an immediate delivery
- **THEN** the engine injects the message

#### Scenario: Retry target blocks immediate message
- **WHEN** a target is in `retry`
- **THEN** immediate delivery remains pending

### Requirement: Immediate delivery preserves older buffered context
If an immediate message is newer than pending buffered deliveries for the same target, the engine SHALL inject one chronological batch containing older buffered items first and the immediate item last.

#### Scenario: Buffered backlog before immediate mention
- **WHEN** a target has an older buffered message and a newer immediate mention
- **THEN** one prompt is injected with the buffered message before the immediate message

### Requirement: Message kind does not change urgency
The system SHALL determine immediate urgency from mentions and hard flag only, not from `kind`.

#### Scenario: Task assignment without mention is buffered
- **WHEN** a member sends a `task_assignment` message without mentions
- **THEN** delivery records are buffered, not immediate
