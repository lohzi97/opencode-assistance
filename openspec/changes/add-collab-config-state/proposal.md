## Why

The Agent Collaboration Service needs a safe foundation before any room behavior can be built: configuration, persistent state, and service startup boundaries. This directly implements the PRD architecture and data model foundation in `notes/agent-collaboration.md` lines 22-67, 254-333, and 880-919.

## What Changes

- Add `collab` worker configuration with disabled-by-default safe startup behavior, host/port/db path/poll/hard-timeout settings, and environment overrides.
- Add SQLite state at `.opencode/server/state/collab.sqlite` with the PRD tables for rooms, members, messages, deliveries, spawned sessions, and question targets.
- Add password hashing and template-loading primitives without exposing planner passwords after creation.
- Add a CollabService module skeleton that can be started, stopped, and tested without enabling room APIs yet.

## Capabilities

### New Capabilities
- `collab-config-state`: Configuration, schema, persistence, password hashing, and service lifecycle foundation for `agent-collab`.

### Modified Capabilities
- None.

## Impact

- Affects `.opencode/server/index.ts`, server configuration loading, worker startup, SQLite dependencies, and state directory management.
- Establishes storage contracts required by every later `agent-collab` change.
