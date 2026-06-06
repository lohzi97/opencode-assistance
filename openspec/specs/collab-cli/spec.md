# collab-cli Specification

## Purpose

Define the durable contract for the agent-collab CLI adapter: command structure, argument parsing, HTTP transport, and human-readable output conventions. This spec covers the thin-wrapper CLI that exposes collaboration server capabilities (rooms, membership, messaging, spawning) as subcommands. It intentionally excludes server-side collaboration semantics, which live in `collab-core`, `collab-delivery`, and related capability specs.

## Requirements

### Requirement: CLI wraps room lifecycle commands
The CLI SHALL implement `room create`, `room status`, `room list`, and `room close` with default human-readable output, optional `--json`, and base URL default/override behavior from PRD lines 691-700 and 727-733.

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

### Requirement: CLI manages public messages
The CLI SHALL implement `room public-message set` with `--text`, `--file`, or `--stdin`, and `room public-message clear`, matching PRD lines 698-700.

#### Scenario: Public message from file
- **WHEN** the set command is invoked with `--file`
- **THEN** the CLI reads the file content and sends it as the public-message body

### Requirement: CLI sends room messages
The CLI SHALL implement `send` with `--body`, `--body-file`, or `--body -`, optional `--kind`, optional `--hard`, and optional `--json`, matching PRD lines 716-720.

#### Scenario: Hard send request
- **WHEN** `agent-collab send` is invoked with `--hard`
- **THEN** the CLI sends `hard: true` in the HTTP request and leaves authorization to the server

### Requirement: CLI supports questions, answers, and transcript reads
The CLI SHALL implement `ask`, `answer`, and `messages` with flags matching PRD lines 721-725. The `messages` command SHALL forward `--since` and `--limit` query parameters without locally enforcing pagination semantics.

#### Scenario: Member-scoped messages request
- **WHEN** `agent-collab messages` is invoked with `--member implementer-1`, `--since`, and `--limit`
- **THEN** the CLI sends the corresponding query parameters and prints the server response

#### Scenario: Room messages pagination request
- **WHEN** `agent-collab messages` is invoked with `--room`, `--since`, and `--limit`
- **THEN** the CLI sends the corresponding query parameters and does not locally filter or reorder the server response

### Requirement: Messaging CLI preserves thin-wrapper behavior
The CLI SHALL NOT perform local mention validation, authorization, or delivery simulation; it SHALL rely on server responses for collaboration semantics.

#### Scenario: Server validation error displayed
- **WHEN** the server rejects a send request for an unknown mention
- **THEN** the CLI exits non-zero and displays the server error without rewriting it into a different semantic result
