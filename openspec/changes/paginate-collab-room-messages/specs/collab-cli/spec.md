## MODIFIED Requirements

### Requirement: CLI supports questions, answers, and transcript reads
The CLI SHALL implement `ask`, `answer`, and `messages` with flags matching PRD lines 721-725. The `messages` command SHALL forward `--since` and `--limit` query parameters without locally enforcing pagination semantics.

#### Scenario: Member-scoped messages request
- **WHEN** `agent-collab messages` is invoked with `--member implementer-1`, `--since`, and `--limit`
- **THEN** the CLI sends the corresponding query parameters and prints the server response

#### Scenario: Room messages pagination request
- **WHEN** `agent-collab messages` is invoked with `--room`, `--since`, and `--limit`
- **THEN** the CLI sends the corresponding query parameters and does not locally filter or reorder the server response
