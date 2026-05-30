## ADDED Requirements

### Requirement: CLI closes rooms
The CLI SHALL implement `room close --room <name> --session <planner_session_id> --from <planner_alias> [--json]` as a thin wrapper over the existing room close API.

#### Scenario: Planner closes room through CLI
- **WHEN** `agent-collab room close` is invoked with room, session, and from flags
- **THEN** the CLI sends a `DELETE` request to `/room/:room` with the supplied planner identity in the request body

#### Scenario: Room close human output
- **WHEN** `agent-collab room close` succeeds without `--json`
- **THEN** the output identifies the room and reports that it is closed

#### Scenario: Room close JSON output
- **WHEN** `agent-collab room close` succeeds with `--json`
- **THEN** the CLI prints the raw server response as formatted JSON

#### Scenario: Room close authorization error
- **WHEN** the server rejects `room close` because the caller is not an active planner
- **THEN** the CLI exits non-zero and displays the server error without rewriting the authorization semantics
