## ADDED Requirements

### Requirement: CLI wraps room lifecycle commands
The CLI SHALL implement `room create`, `room status`, and `room list` with default human-readable output, optional `--json`, and base URL default/override behavior from PRD lines 691-700 and 727-733.

#### Scenario: Room create shows one-time password warning
- **WHEN** `agent-collab room create` succeeds without `--json`
- **THEN** output prominently includes full room name, founder alias, planner password, and warning that the password will not be shown again

### Requirement: CLI wraps membership commands
The CLI SHALL implement `member add`, `member remove`, `join`, `leave`, and `spawn` with explicit identity flags and arguments matching PRD lines 702-712.

#### Scenario: Member add sends expected request
- **WHEN** `agent-collab member add` is invoked with room, session, from, target-session, name, and role
- **THEN** the CLI sends the corresponding HTTP request body to the collab API

### Requirement: CLI handles planner password input safely
Self-join SHALL support `--password` and `--password-stdin`, per PRD line 741, without printing the supplied password except server-returned creation output.

#### Scenario: Password stdin join
- **WHEN** `agent-collab join` is invoked with `--password-stdin`
- **THEN** the CLI reads the password from stdin and does not echo it in logs or human-readable output
