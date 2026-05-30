## ADDED Requirements

### Requirement: Room creation establishes the first planner
The system SHALL create rooms from an explicit base name and founder alias, persist a unique `{base_name}-{YYYYMMDDHHmmss}` full name, auto-join the founder as `planner`, and return the planner password once as specified in PRD lines 351-394.

#### Scenario: Successful room creation
- **WHEN** a caller creates a room with `name`, `session_id`, and `from`
- **THEN** the response includes room identity, founder membership, state `open`, and a one-time planner password

#### Scenario: Founder already in open room
- **WHEN** a founder session already belongs to another open room
- **THEN** room creation is rejected

### Requirement: Room inspection never exposes password data
Room status and list responses SHALL NOT include planner passwords or password hashes, per PRD lines 412-415 and 428-430.

#### Scenario: Status after room creation
- **WHEN** status is requested for a room
- **THEN** the response includes room identity, state, public-message fields, and active members without password fields

### Requirement: Room closure is terminal
The system SHALL allow planners to close open rooms, create a final closure room message, reject future room mutations, and keep read operations available as described in PRD lines 432-444 and 236-247.

#### Scenario: Planner closes room
- **WHEN** an active planner closes an open room
- **THEN** the room state becomes `closed`, `closed_at` is set, and a `room_closed` system message is stored

#### Scenario: Non-planner close rejected
- **WHEN** a non-planner attempts to close a room
- **THEN** the operation is rejected and the room remains open
