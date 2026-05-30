## MODIFIED Requirements

### Requirement: Room creation establishes the first planner
The system SHALL create rooms from an explicit base name and founder alias, persist a unique `{base_name}-{YYYYMMDDHHmmss}` full name, auto-join the founder as `planner`, capture the founder session's effective agent/model/variant from the OpenCode API (last user message), and return the planner password once.

#### Scenario: Successful room creation
- **WHEN** a caller creates a room with `name`, `session_id`, and `from`
- **THEN** the response includes room identity, founder membership, state `open`, and a one-time planner password, and the founder member row stores the founder session's agent/model/variant when available

#### Scenario: Founder already in open room
- **WHEN** a founder session already belongs to another open room
- **THEN** room creation is rejected

#### Scenario: Founder auto-join with unavailable session history
- **WHEN** a caller creates a room and the founder session history is unavailable or empty
- **THEN** the founder becomes an active planner with `NULL` agent/model/variant on the member row

### Requirement: Planner-managed membership is authorized
The system SHALL allow active planners to add or remove members while enforcing one open room per session and at least one remaining planner per open room. When adding a member, the system SHALL capture the target session's effective agent/model/variant from the OpenCode API (last user message) and store it on the member row.

#### Scenario: Planner adds existing session
- **WHEN** an active planner adds a session not already in an open room
- **THEN** the target becomes an active member, a join bootstrap delivery record is queued before later traffic, and the member row stores the target session's agent/model/variant from its last user message

#### Scenario: Removing final planner rejected
- **WHEN** a planner removal or leave would leave an open room with zero planners
- **THEN** the operation is rejected

#### Scenario: Member add with unavailable session history
- **WHEN** an active planner adds a session whose message history is unavailable or empty
- **THEN** the target becomes an active member with `NULL` agent/model/variant on the member row

### Requirement: Password self-join grants planner role
The system SHALL allow sessions with the valid planner password to self-join an open room as `planner`, with explicit alias and one-open-room enforcement. The system SHALL capture the joining session's effective agent/model/variant from the OpenCode API (last user message) and store it on the member row.

#### Scenario: Valid self-join
- **WHEN** a session submits the correct planner password and a valid unused alias
- **THEN** the session joins as an active planner, receives a queued bootstrap delivery, and the member row stores the session's agent/model/variant from its last user message

#### Scenario: Self-join with unavailable session history
- **WHEN** a session self-joins and its message history is unavailable or empty
- **THEN** the session joins as an active planner with `NULL` agent/model/variant on the member row
