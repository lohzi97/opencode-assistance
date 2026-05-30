# collab-spawn Specification

## Purpose

Define the planner-managed session spawning capability for collaboration rooms: OpenCode session creation with explicit agent/model/directory selection, join bootstrap and initial prompt ordering, and template-rendered spawn instructions. This spec is layered on top of `collab-core` (room lifecycle, membership governance) and `collab-delivery` (bootstrap-first injection mechanics).

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
The spawn operation SHALL use explicit `agent`, `model` (providerID, modelID, variant), and `directory` values when provided, otherwise default from the caller session's last assistant message when available, per PRD lines 603-604.

#### Scenario: Explicit model override
- **WHEN** spawn includes provider, model, and variant ids
- **THEN** the OpenCode session is created with those explicit model values and variant is stored on the delivery row

#### Scenario: Caller-derived defaults from message history
- **WHEN** spawn omits agent or model
- **THEN** defaults are derived from the planner's last assistant message in session history

### Requirement: Spawn prompt ordering is bootstrap first
The spawned member SHALL receive join bootstrap before the spawn `initial_prompt`, as required by PRD lines 606-607.

#### Scenario: Bootstrap succeeds before initial prompt
- **WHEN** a spawned member has both bootstrap and initial prompt pending
- **THEN** delivery injects bootstrap first and initial prompt only after bootstrap is delivered

#### Scenario: Spawn instruction and initial prompt are merged
- **WHEN** both spawn instruction and initial prompt are present
- **THEN** they are concatenated into a single `spawn_initial` message and delivery

#### Scenario: Empty prompt body skips delivery
- **WHEN** neither spawn instruction nor initial prompt produces content
- **THEN** no `spawn_initial` delivery is created

### Requirement: Spawn instruction is template-rendered
The spawn instruction SHALL be rendered from configured text or file template sources, falling back to a built-in template. Template variables include `{room}`, `{alias}`, `{role}`, and `{from}`.

#### Scenario: Configured text template
- **WHEN** spawn instruction is configured with `{ text: "..." }`
- **THEN** the template is rendered with room, alias, role, and from variables

#### Scenario: Configured file template
- **WHEN** spawn instruction is configured with `{ file: "/path" }`
- **THEN** the file contents are loaded and rendered as a template

#### Scenario: Fallback template
- **WHEN** no spawn instruction is configured
- **THEN** the built-in fallback template is used with variable substitution
