## ADDED Requirements

### Requirement: CLI wraps room pause and resume commands
The CLI SHALL implement `pause` and `resume` commands that send password-authenticated requests to the collab API for a room. Both commands SHALL support optional `--json` output and SHALL preserve thin-wrapper behavior by leaving password validation, room-state validation, interruption behavior, and resume delivery semantics to the server.

#### Scenario: Pause command sends expected request
- **WHEN** `agent-collab pause` is invoked with `--room` and password input
- **THEN** the CLI sends a pause request to `/room/:room/pause` with the supplied password in the request body

#### Scenario: Resume command sends expected request
- **WHEN** `agent-collab resume` is invoked with `--room` and password input
- **THEN** the CLI sends a resume request to `/room/:room/resume` with the supplied password in the request body

#### Scenario: Server pause error displayed
- **WHEN** the server rejects a pause request because the password is invalid or the room is not pausable
- **THEN** the CLI exits non-zero and displays the server error without rewriting the semantic result

### Requirement: CLI handles pause resume passwords safely
The `pause` and `resume` commands SHALL support `--password-stdin` and SHALL NOT print the supplied password in human-readable output. Inline `--password` MAY be accepted for parity with existing password commands, but documentation SHALL prefer `--password-stdin`.

#### Scenario: Pause reads password from stdin
- **WHEN** `agent-collab pause --password-stdin` is invoked
- **THEN** the CLI reads the password from stdin and does not echo it in output

#### Scenario: Resume reads password from stdin
- **WHEN** `agent-collab resume --password-stdin` is invoked
- **THEN** the CLI reads the password from stdin and does not echo it in output

### Requirement: CLI lists paused rooms
The `room list` command SHALL forward a paused-room state filter to the server when requested by the caller.

#### Scenario: Room list paused request
- **WHEN** `agent-collab room list --paused` is invoked
- **THEN** the CLI sends `state=paused` to `/room/list`
