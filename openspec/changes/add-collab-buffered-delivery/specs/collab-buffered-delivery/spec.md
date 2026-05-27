## ADDED Requirements

### Requirement: Buffered delivery waits for eligibility
The engine SHALL block buffered delivery when the target session is `busy`, `retry`, has a pending user question, or has an unresolved collab question while the room is open, as described in PRD lines 185-193.

#### Scenario: Busy target blocks buffered backlog
- **WHEN** a target has pending buffered deliveries and session status `busy`
- **THEN** no prompt is injected and deliveries remain `pending`

#### Scenario: Idle eligible target receives backlog
- **WHEN** a target has pending buffered deliveries and no blockers
- **THEN** the full pending backlog is injected in one chronological batch

### Requirement: Join bootstrap precedes later traffic
The engine SHALL deliver the join bootstrap before later room traffic for newly added, spawned, or self-joined members, per PRD lines 215-231.

#### Scenario: Bootstrap before assignment
- **WHEN** a member has a pending bootstrap and a later task message
- **THEN** the injected batch places the bootstrap content before the task message

### Requirement: Collaboration injections are self-contained
Every injected delivery SHALL include room identity, message content or combined batch, current public message when present, and reply instructions according to PRD lines 743-779.

#### Scenario: Buffered prompt format
- **WHEN** buffered messages are injected
- **THEN** the prompt contains room name, message content, separator, and reply instruction
