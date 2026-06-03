## MODIFIED Requirements

### Requirement: CLI wraps room lifecycle commands
The CLI SHALL implement `room create`, `room status`, `room list`, and `room close` with default human-readable output, optional `--json`, and base URL default/override behavior from PRD lines 691-700 and 727-733. The `room list` command SHALL forward `--before` and `--limit` query parameters when supplied and SHALL leave pagination semantics to the server.

#### Scenario: Room create shows one-time password warning
- **WHEN** `agent-collab room create` succeeds without `--json`
- **THEN** output prominently includes full room name, founder alias, planner password, and warning that the password will not be shown again

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

#### Scenario: Room list pagination request
- **WHEN** `agent-collab room list` is invoked with `--closed`, `--before`, and `--limit`
- **THEN** the CLI sends `state=closed`, `before`, and `limit` query parameters to `/room/list`
