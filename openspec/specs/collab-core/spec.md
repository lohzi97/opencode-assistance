# collab-core Specification

## Purpose

Define the durable core contract for the agent collaboration service: configuration, storage, room lifecycle, membership governance, member-authored messages, mention targeting, and transcript inspection. This spec intentionally excludes delivery-engine execution details, public-message behavior, question/answer workflow, hard interrupt, spawning, and CLI behavior, which are separate capabilities.

## Requirements

### Requirement: Collab configuration loads safely
The worker SHALL load `collab` configuration with defaults, `.opencode/server.jsonc` values, and `AGENT_COLLAB_PORT`, `AGENT_COLLAB_DB_PATH`, and `AGENT_COLLAB_POLL_INTERVAL` overrides as described in the agent collaboration PRD.

#### Scenario: Default disabled-safe startup
- **WHEN** the worker starts without explicit collab configuration
- **THEN** the collab module initializes without exposing room APIs or creating delivery activity

#### Scenario: Invalid hard timeout configuration
- **WHEN** `hard_abort_wait_max_ms` is lower than `hard_abort_wait_ms`
- **THEN** configuration validation fails with a clear error

### Requirement: Collab schema initializes durably
The system SHALL create the SQLite database at the configured path with `rooms`, `members`, `messages`, `deliveries`, `spawned_sessions`, and `question_targets` tables and their required primary and unique constraints.

#### Scenario: Fresh database initialization
- **WHEN** CollabService starts with an empty state directory
- **THEN** it creates all required tables and primary/unique constraints

### Requirement: Planner secrets are hash-only after generation
The persistence layer SHALL store planner passwords only as hashes and SHALL NOT expose hash fields through inspection helpers.

#### Scenario: Password hash storage
- **WHEN** a planner password is hashed for storage
- **THEN** the stored value differs from the plaintext and can verify the plaintext without returning it

### Requirement: Instruction templates resolve predictably
The service SHALL load `room_join_instruction` and `reply_instruction` from either text or file config, with built-in fallback templates and no merge behavior. The resolved `room_join_instruction` SHALL be used for join bootstrap content, and the resolved `reply_instruction` SHALL be used wherever collaboration prompt reply guidance is rendered.

#### Scenario: Configured file replaces fallback
- **WHEN** a template file is configured
- **THEN** its content fully replaces the built-in fallback template

#### Scenario: Configured reply instruction is operational
- **WHEN** `collab.reply_instruction` is configured
- **THEN** collaboration prompt reply guidance uses that configured template instead of the built-in fallback

#### Scenario: Configured room join instruction is operational
- **WHEN** `collab.room_join_instruction` is configured
- **THEN** join bootstrap content uses that configured template instead of the built-in fallback

#### Scenario: Legacy spawn instruction is not a room join template
- **WHEN** only `collab.spawn_instruction` is configured
- **THEN** the service does not use it as the join bootstrap template

### Requirement: Room creation establishes the first planner
The system SHALL create rooms from an explicit base name and founder alias, persist a unique `{base_name}-{YYYYMMDDHHmmss}` full name, auto-join the founder as `planner`, and return the planner password once.

#### Scenario: Successful room creation
- **WHEN** a caller creates a room with `name`, `session_id`, and `from`
- **THEN** the response includes room identity, founder membership, state `open`, and a one-time planner password

#### Scenario: Founder already in open room
- **WHEN** a founder session already belongs to another open room
- **THEN** room creation is rejected

### Requirement: Room inspection never exposes password data
Room status and list responses SHALL NOT include planner passwords or password hashes.

#### Scenario: Status after room creation
- **WHEN** status is requested for a room
- **THEN** the response includes room identity, state, public-message fields, and active members without password fields

### Requirement: Room closure is terminal
The system SHALL allow planners to close open rooms, create a final closure room message, reject future room mutations, and keep read operations available.

#### Scenario: Planner closes room
- **WHEN** an active planner closes an open room
- **THEN** the room state becomes `closed`, `closed_at` is set, and a `room_closed` system message is stored

#### Scenario: Non-planner close rejected
- **WHEN** a non-planner attempts to close a room
- **THEN** the operation is rejected and the room remains open

### Requirement: Member aliases are strict immutable room slugs
The system SHALL require aliases matching `[a-z0-9][a-z0-9-]*`, reject collisions within a room, and treat aliases as immutable in v1.

#### Scenario: Alias collision rejected
- **WHEN** a planner adds a member with an alias already active in the room
- **THEN** the operation is rejected and no membership row is created

### Requirement: Planner-managed membership is authorized
The system SHALL allow active planners to add or remove members while enforcing one open room per session and at least one remaining planner per open room.

#### Scenario: Planner adds existing session
- **WHEN** an active planner adds a session not already in an open room
- **THEN** the target becomes an active member and a join bootstrap delivery record is queued before later traffic

#### Scenario: Removing final planner rejected
- **WHEN** a planner removal or leave would leave an open room with zero planners
- **THEN** the operation is rejected

### Requirement: Password self-join grants planner role
The system SHALL allow sessions with the valid planner password to self-join an open room as `planner`, with explicit alias and one-open-room enforcement.

#### Scenario: Valid self-join
- **WHEN** a session submits the correct planner password and a valid unused alias
- **THEN** the session joins as an active planner and receives a queued bootstrap delivery

### Requirement: Leaving or removal cancels targeted pending work
The system SHALL cancel pending deliveries to a leaving or removed member and SHALL cancel unresolved question targets for removed members.

#### Scenario: Member removed with pending deliveries
- **WHEN** a planner removes an active member with pending deliveries
- **THEN** those deliveries are marked `cancelled` and remaining members receive a system message

### Requirement: Member-authored messages validate room identity
The system SHALL accept messages only from active members whose `session_id + alias` match the room membership.

#### Scenario: Valid member sends note
- **WHEN** an active member sends a message with matching `session_id` and `from`
- **THEN** the message is persisted with sender type `member`, sender alias, kind, body, and creation time

#### Scenario: Mismatched sender rejected
- **WHEN** a session id and alias do not match one active member
- **THEN** the message is rejected and no deliveries are created

### Requirement: Mentions determine delivery targets and base mode
The system SHALL route no-mention messages as buffered deliveries to all other active members, and mention messages as immediate deliveries to mentioned active members, skipping self-delivery and rejecting unknown mentions.

#### Scenario: Unknown mention rejects message
- **WHEN** a body mentions an alias that is not an active member
- **THEN** the entire message is rejected

#### Scenario: Everyone mention excludes sender
- **WHEN** a member sends `@everyone`
- **THEN** immediate delivery records are created for all active members except the sender

### Requirement: Transcripts are visible with delivery annotations
The system SHALL provide room-wide transcript and member-scoped delivery views with delivery state annotations.

#### Scenario: Member-scoped messages view
- **WHEN** messages are requested for a member alias
- **THEN** the response shows messages targeted to that member and each delivery state
