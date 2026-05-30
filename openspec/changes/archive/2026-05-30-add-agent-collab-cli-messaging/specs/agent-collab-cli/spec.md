## ADDED Requirements

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
The CLI SHALL implement `ask`, `answer`, and `messages` with flags matching PRD lines 721-725.

#### Scenario: Member-scoped messages request
- **WHEN** `agent-collab messages` is invoked with `--member implementer-1`, `--since`, and `--limit`
- **THEN** the CLI sends the corresponding query parameters and prints the server response

### Requirement: Messaging CLI preserves thin-wrapper behavior
The CLI SHALL NOT perform local mention validation, authorization, or delivery simulation; it SHALL rely on server responses for collaboration semantics.

#### Scenario: Server validation error displayed
- **WHEN** the server rejects a send request for an unknown mention
- **THEN** the CLI exits non-zero and displays the server error without rewriting it into a different semantic result
