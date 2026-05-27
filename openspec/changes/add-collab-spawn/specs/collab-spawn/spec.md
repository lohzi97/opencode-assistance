## ADDED Requirements

### Requirement: Spawn is planner-managed
The system SHALL allow only active planners to spawn new OpenCode sessions into open rooms, with alias and role validation equivalent to planner-managed member add, per PRD lines 577-609.

#### Scenario: Planner spawns implementer
- **WHEN** an active planner spawns a session with alias, role, and initial prompt
- **THEN** a new OpenCode session is created, joined to the room, and recorded in `spawned_sessions`

#### Scenario: Non-planner spawn rejected
- **WHEN** a non-planner attempts to spawn a room member
- **THEN** the operation is rejected and no OpenCode session is created

### Requirement: Spawn applies agent, model, and directory selection
The spawn operation SHALL use explicit `agent`, `model`, and `directory` values when provided, otherwise default from the caller session when available, per PRD lines 603-604.

#### Scenario: Explicit model override
- **WHEN** spawn includes provider and model ids
- **THEN** the OpenCode session is created with those explicit model values

### Requirement: Spawn prompt ordering is bootstrap first
The spawned member SHALL receive join bootstrap before the spawn `initial_prompt`, as required by PRD lines 606-607.

#### Scenario: Bootstrap succeeds before initial prompt
- **WHEN** a spawned member has both bootstrap and initial prompt pending
- **THEN** delivery injects bootstrap first and initial prompt only after bootstrap is delivered
