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

#### Scenario: Existing database receives agent/model columns
- **WHEN** the collab service starts with an existing database that lacks agent/model columns on the `members` table
- **THEN** the columns (`agent`, `model_provider_id`, `model_id`, `model_variant`) are added via additive migration using the existing `ensureColumn` pattern without data loss, and existing rows have `NULL` values

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

### Requirement: Room listings are bounded and cursorable
The system SHALL provide room list responses using bounded newest-first pagination. Room list requests SHALL preserve the existing state filter, support `limit=<n>`, and support `before=<room_id>` as a cursor that returns rooms older than the cursor under the same filter. When `limit` is omitted, the system SHALL apply a default limit. When `limit` exceeds the configured maximum, the system SHALL cap it to that maximum.

#### Scenario: Default room list is bounded
- **WHEN** rooms are listed without an explicit limit
- **THEN** the response includes at most the default page size of rooms ordered by newest first

#### Scenario: Room list honors state filter and limit
- **WHEN** closed rooms are listed with `state=closed` and `limit=2`
- **THEN** the response includes at most two closed rooms ordered by newest first

#### Scenario: Room list honors before cursor
- **WHEN** rooms are listed with `before` set to a room from the first page
- **THEN** the response includes rooms older than that cursor under the selected state filter

#### Scenario: Invalid room list cursor is rejected
- **WHEN** rooms are listed with `before` set to an unknown room id or a room outside the selected state filter
- **THEN** the request is rejected with a clear error and no room page is returned

#### Scenario: Excessive room list limit is capped
- **WHEN** rooms are listed with `limit` greater than the maximum allowed page size
- **THEN** the response includes no more than the maximum allowed page size of rooms

### Requirement: Member aliases are strict immutable room slugs
The system SHALL require aliases matching `[a-z0-9][a-z0-9-]*`, reject collisions within a room, and treat aliases as immutable in v1.

#### Scenario: Alias collision rejected
- **WHEN** a planner adds a member with an alias already active in the room
- **THEN** the operation is rejected and no membership row is created

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
The system SHALL provide bounded room-wide transcript and member-scoped delivery views with delivery state annotations. Transcript reads SHALL support `since=<message_id>` as a forward cursor and `limit=<n>` as a maximum number of messages to return. When `limit` is omitted, the system SHALL apply a default limit. When `limit` exceeds the configured maximum, the system SHALL cap it to that maximum. Results SHALL remain ordered by message creation time ascending with message id as the deterministic tie-breaker.

#### Scenario: Member-scoped messages view
- **WHEN** messages are requested for a member alias
- **THEN** the response shows only messages targeted to that member and each delivery state

#### Scenario: Room messages default page is bounded
- **WHEN** room-wide messages are requested without `limit`
- **THEN** the response includes at most the default page size of messages in chronological order

#### Scenario: Room messages honor cursor and limit
- **WHEN** room-wide messages are requested with `since` set to a message in the room and `limit` set to `2`
- **THEN** the response includes at most two messages strictly after the cursor message in chronological order

#### Scenario: Member messages honor cursor and limit
- **WHEN** member-scoped messages are requested with `since` set to a targeted message and `limit` set to `2`
- **THEN** the response includes at most two targeted messages strictly after the cursor message in chronological order

#### Scenario: Invalid transcript cursor is rejected
- **WHEN** messages are requested with `since` set to a message id that does not belong to the room
- **THEN** the request is rejected with a clear error and no transcript page is returned

#### Scenario: Excessive transcript limit is capped
- **WHEN** messages are requested with `limit` greater than the maximum allowed page size
- **THEN** the response includes no more than the maximum allowed page size of messages

### Requirement: Inactivity nudge configuration loads safely
The worker SHALL load optional `collab.inactivity_nudge` configuration with disabled-safe defaults, validating that `threshold_ms` and `repeat_ms` are positive when inactivity nudges are enabled. The inactivity nudge message SHALL support built-in fallback content and optional configured text or file content using the same instruction-source style as existing collaboration templates.

#### Scenario: Default inactivity nudge configuration
- **WHEN** the worker starts without `collab.inactivity_nudge` configuration
- **THEN** collab startup succeeds and inactivity nudges use the built-in default policy

#### Scenario: Invalid inactivity threshold rejected
- **WHEN** inactivity nudges are enabled with `threshold_ms` less than or equal to zero
- **THEN** configuration validation fails with a clear error

#### Scenario: Configured inactivity message replaces fallback
- **WHEN** `collab.inactivity_nudge.message` is configured from text or file
- **THEN** inactivity notice prompts use the configured template instead of the built-in fallback

### Requirement: Room status exposes inactivity metadata
Room status SHALL expose inactivity metadata for every room: `last_meaningful_activity_at`, `last_inactivity_nudge_at`, `inactive_for_ms`, and `next_inactivity_nudge_at`. `last_meaningful_activity_at` SHALL be calculated from room messages excluding `inactivity_notice` messages, and `last_inactivity_nudge_at` SHALL be tracked separately.

#### Scenario: Status for active room with member activity
- **WHEN** status is requested for an open room with at least one non-`inactivity_notice` message
- **THEN** the response includes the latest meaningful activity timestamp and computed inactivity duration

#### Scenario: Inactivity notices do not reset meaningful activity
- **WHEN** an `inactivity_notice` message is the newest room message
- **THEN** `last_meaningful_activity_at` remains the timestamp of the latest non-`inactivity_notice` message

#### Scenario: Next nudge timestamp shown when rate limited
- **WHEN** a room has already received an inactivity notice and no later meaningful activity occurred
- **THEN** status includes `last_inactivity_nudge_at` and `next_inactivity_nudge_at` based on the configured repeat interval

### Requirement: Inactivity notices are system-authored transcript entries
The system SHALL persist inactivity nudges as system-authored room messages with kind `inactivity_notice`, sender name `system`, and body rendered from the resolved inactivity message template. These messages SHALL remain visible through transcript APIs but SHALL NOT count as meaningful room activity.

#### Scenario: Inactivity notice is persisted
- **WHEN** an open room qualifies for an inactivity nudge
- **THEN** a system message with kind `inactivity_notice` is stored in that room transcript

#### Scenario: Transcript includes inactivity notice kind
- **WHEN** room messages are requested after an inactivity notice is created
- **THEN** the notice appears with sender `system` and kind `inactivity_notice`
