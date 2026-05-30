## 1. CLI Command Surface

- [x] 1.1 Add `room close` dispatch to `.opencode/scripts/agent-collab.ts`, requiring `--room`, `--session`, and `--from`.
- [x] 1.2 Implement the `DELETE /room/:room` request body for room close and preserve raw JSON output in `--json` mode.
- [x] 1.3 Add human-readable room close output that clearly reports the room as closed.

## 2. Tests And Validation

- [x] 2.1 Add CLI tests for `room close` request shape, JSON output, human-readable output, and server error passthrough.
- [x] 2.2 Run the relevant Bun test suite for collaboration CLI and server behavior.
- [x] 2.3 Run `openspec validate add-agent-collab-room-close --strict` and fix any proposal/spec issues.
