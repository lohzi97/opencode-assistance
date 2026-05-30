# Capability: Collab Questions & Answers

## Purpose

Define the collaboration question and answer workflow: explicit targets, per-target first-answer-wins semantics, asker notification, buffered visibility for other members, and unresolved-question delivery blocking while rooms remain open.

## Requirements

### Requirement: Questions require explicit targets
The system SHALL create room questions only when the caller is valid and targets one or more explicit aliases or `@everyone`, expanding `@everyone` to all other active members as specified in PRD lines 653-665.

#### Scenario: Question targets everyone except asker
- **WHEN** a member asks a question with `@everyone`
- **THEN** question target rows and immediate deliveries are created for all other active members

#### Scenario: Question without targets rejected
- **WHEN** a member asks without any explicit alias or `@everyone`
- **THEN** the ask operation is rejected

### Requirement: Answers are first-answer-wins per target
The system SHALL accept only the first answer from each pending target, reject duplicate answers, notify the asker immediately, and buffer the answer for other members per PRD lines 666-679.

#### Scenario: Target answers once
- **WHEN** a pending target answers a question
- **THEN** the target is marked answered, an answer message is stored with `parent_id`, and the asker receives an immediate delivery

#### Scenario: Duplicate answer rejected
- **WHEN** the same target answers the same question again
- **THEN** the duplicate is rejected and the first answer remains authoritative

### Requirement: Unresolved questions block buffered delivery while open
Buffered delivery SHALL be blocked for a target with unresolved collab questions while the room is open, per PRD line 192.

#### Scenario: Pending question blocks buffered backlog
- **WHEN** a member has a pending question target and buffered deliveries
- **THEN** buffered deliveries remain pending until the question is answered or cancelled
