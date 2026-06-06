# collab-spawn Specification

## Purpose

Define the planner-managed session spawning capability for collaboration rooms: OpenCode session creation with explicit agent/model/directory selection, join bootstrap and initial prompt ordering. This spec is layered on top of `collab-core` (room lifecycle, membership governance) and `collab-delivery` (bootstrap-first injection mechanics).

## Requirements

### Requirement: Spawn is planner-managed
The system SHALL allow only active planners to spawn new OpenCode sessions into open rooms, with alias and role validation equivalent to planner-managed member add, per PRD lines 577-609.

#### Scenario: Planner spawns implementer
- **WHEN** an active planner spawns a session with alias, role, and initial prompt
- **THEN** a new OpenCode session is created, joined to the room, and recorded in `spawned_sessions`

#### Scenario: Non-planner spawn rejected
- **WHEN** a non-planner attempts to spawn a room member
- **THEN** the operation is rejected and no OpenCode session is created

### Requirement: Spawn applies agent, model, and directory selection
The spawn operation SHALL use explicit `agent`, `model` (providerID, modelID, variant), and `directory` values when provided, otherwise default from the caller session's last assistant message when available, per PRD lines 603-604. The resolved agent and model SHALL also be stored on the member row for use by the delivery engine.

#### Scenario: Explicit model override
- **WHEN** spawn includes provider, model, and variant ids
- **THEN** the OpenCode session is created with those explicit model values, variant is stored on the delivery row, and the member row stores the same agent/model/variant

#### Scenario: Caller-derived defaults from message history
- **WHEN** spawn omits agent or model
- **THEN** defaults are derived from the planner's last assistant message in session history and stored on the member row

#### Scenario: Spawn stores agent/model on member row
- **WHEN** a planner spawns a session with resolved agent and model
- **THEN** the member row in the `members` table stores the resolved `agent`, `model_provider_id`, `model_id`, and `model_variant` values

### Requirement: Spawn prompt ordering is bootstrap first
The spawned member SHALL receive join bootstrap before the spawn `initial_prompt`, as required by PRD lines 606-607. The join bootstrap SHALL use the resolved `collab.room_join_instruction` content, and the spawn `initial_prompt` SHALL remain a separate post-bootstrap `spawn_initial` delivery when present.

#### Scenario: Bootstrap succeeds before initial prompt
- **WHEN** a spawned member has both bootstrap and initial prompt pending
- **THEN** delivery injects bootstrap first and initial prompt only after bootstrap is delivered

#### Scenario: Room join instruction and initial prompt are not merged
- **WHEN** both room join instruction and spawn initial prompt are present
- **THEN** the room join instruction is delivered in the `join_bootstrap` prompt and the initial prompt is delivered separately in the later `spawn_initial` prompt

#### Scenario: Empty initial prompt skips spawn initial delivery
- **WHEN** spawn has no `initial_prompt`
- **THEN** no `spawn_initial` delivery is created

### Requirement: Spawned session ownership survives compaction handoff
The spawn capability SHALL preserve room ownership for spawned members when their OpenCode session is replaced by a custom compaction continuation session.

#### Scenario: Spawned session record is updated on handoff
- **WHEN** a spawned room member is handed off from `ses_old` to `ses_new`
- **THEN** the `spawned_sessions` record for that room member uses `ses_new` and remains associated with the same room and spawning session

#### Scenario: Non-spawned member handoff does not create spawned ownership
- **WHEN** a non-spawned room member is handed off from `ses_old` to `ses_new`
- **THEN** no new `spawned_sessions` record is created
