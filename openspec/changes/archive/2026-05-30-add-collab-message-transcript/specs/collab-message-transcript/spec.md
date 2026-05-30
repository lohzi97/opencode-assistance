## ADDED Requirements

### Requirement: Member-authored messages validate room identity
The system SHALL accept messages only from active members whose `session_id + alias` match the room membership, as specified in PRD lines 138 and 628-635.

#### Scenario: Valid member sends note
- **WHEN** an active member sends a message with matching `session_id` and `from`
- **THEN** the message is persisted with sender type `member`, sender alias, kind, body, and creation time

#### Scenario: Mismatched sender rejected
- **WHEN** a session id and alias do not match one active member
- **THEN** the message is rejected and no deliveries are created

### Requirement: Mentions determine delivery targets and mode
The system SHALL route no-mention messages as buffered deliveries to all other active members, and mention messages as immediate deliveries to mentioned active members, skipping self-delivery and rejecting unknown mentions per PRD lines 164-184.

#### Scenario: Unknown mention rejects message
- **WHEN** a body mentions an alias that is not an active member
- **THEN** the entire message is rejected

#### Scenario: Everyone mention excludes sender
- **WHEN** a member sends `@everyone`
- **THEN** immediate delivery records are created for all active members except the sender

### Requirement: Transcripts are visible with delivery annotations
The system SHALL provide room-wide transcript and member-scoped delivery views with delivery state annotations, per PRD lines 637-650.

#### Scenario: Member-scoped messages view
- **WHEN** messages are requested for a member alias
- **THEN** the response shows messages targeted to that member and each delivery state
