## 1. Server Bounding

- [ ] 1.1 Add parsing/validation for status `failure_limit` query parameter with default and maximum values.
- [ ] 1.2 Update `GET /room/:room/status` routing to pass failure sample options into storage/public room rendering.
- [ ] 1.3 Update public room rendering to include `outstanding_failure_count` and bounded `outstanding_failures`.
- [ ] 1.4 Update failed-delivery SQL to return newest-first bounded samples with deterministic tie-breaking.

## 2. CLI And Tests

- [ ] 2.1 Add `--failure-limit` forwarding to `agent-collab room status`.
- [ ] 2.2 Add server tests for default bounded failure samples and total counts.
- [ ] 2.3 Add server tests for explicit failure limits and excessive limit capping.
- [ ] 2.4 Add server tests that password data remains excluded from status and list responses.
- [ ] 2.5 Add CLI tests proving `room status --failure-limit` forwards the expected query parameter.

## 3. Validation

- [ ] 3.1 Run the collab server test suite.
- [ ] 3.2 Run the agent-collab CLI test suite.
- [ ] 3.3 Run OpenSpec validation for `bound-collab-room-status-failures`.
