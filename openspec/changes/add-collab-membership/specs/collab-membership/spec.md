## ADDED Requirements

### Requirement: Member aliases are strict immutable room slugs
The system SHALL require aliases matching `[a-z0-9][a-z0-9-]*`, reject collisions within a room, and treat aliases as immutable in v1 per PRD lines 94-103.

#### Scenario: Alias collision rejected
- **WHEN** a planner adds a member with an alias already active in the room
- **THEN** the operation is rejected and no membership row is created

### Requirement: Planner-managed membership is authorized
The system SHALL allow active planners to add or remove members while enforcing one open room per session and at least one remaining planner per open room, per PRD lines 484-576.

#### Scenario: Planner adds existing session
- **WHEN** an active planner adds a session not already in an open room
- **THEN** the target becomes an active member and a join bootstrap delivery record is queued before later traffic

#### Scenario: Removing final planner rejected
- **WHEN** a planner removal or leave would leave an open room with zero planners
- **THEN** the operation is rejected

### Requirement: Password self-join grants planner role
The system SHALL allow sessions with the valid planner password to self-join an open room as `planner`, with explicit alias and one-open-room enforcement as specified in PRD lines 508-531.

#### Scenario: Valid self-join
- **WHEN** a session submits the correct planner password and a valid unused alias
- **THEN** the session joins as an active planner and receives a queued bootstrap delivery

### Requirement: Leaving or removal cancels targeted pending work
The system SHALL cancel pending deliveries to a leaving or removed member, and SHALL cancel unresolved question targets for removed members per PRD lines 550 and 573-574.

#### Scenario: Member removed with pending deliveries
- **WHEN** a planner removes an active member with pending deliveries
- **THEN** those deliveries are marked `cancelled` and remaining members receive a system message
