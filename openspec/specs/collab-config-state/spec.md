# collab-config-state Specification

## Purpose
TBD - created by archiving change add-collab-config-state. Update Purpose after archive.
## Requirements
### Requirement: Collab configuration loads safely
The worker SHALL load `collab` configuration with defaults, `.opencode/server.jsonc` values, and `AGENT_COLLAB_PORT`, `AGENT_COLLAB_DB_PATH`, and `AGENT_COLLAB_POLL_INTERVAL` overrides as described in PRD lines 880-919.

#### Scenario: Default disabled-safe startup
- **WHEN** the worker starts without explicit collab configuration
- **THEN** the collab module initializes without exposing room APIs or creating delivery activity

#### Scenario: Invalid hard timeout configuration
- **WHEN** `hard_abort_wait_max_ms` is lower than `hard_abort_wait_ms`
- **THEN** configuration validation fails with a clear error

### Requirement: Collab schema initializes durably
The system SHALL create the SQLite database at the configured path with `rooms`, `members`, `messages`, `deliveries`, `spawned_sessions`, and `question_targets` matching PRD lines 258-331.

#### Scenario: Fresh database initialization
- **WHEN** CollabService starts with an empty state directory
- **THEN** it creates all required tables and primary/unique constraints

### Requirement: Planner secrets are hash-only after generation
The persistence layer SHALL store planner passwords only as hashes and SHALL NOT expose hash fields through inspection helpers.

#### Scenario: Password hash storage
- **WHEN** a planner password is hashed for storage
- **THEN** the stored value differs from the plaintext and can verify the plaintext without returning it

### Requirement: Instruction templates resolve predictably
The service SHALL load `spawn_instruction` and `reply_instruction` from either text or file config, with built-in fallback templates and no merge behavior per PRD lines 894-910.

#### Scenario: Configured file replaces fallback
- **WHEN** a template file is configured
- **THEN** its content fully replaces the built-in fallback template

