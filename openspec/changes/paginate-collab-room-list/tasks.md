## 1. Server Pagination

- [ ] 1.1 Add parsing/validation for room list `before` and `limit` query parameters.
- [ ] 1.2 Update `GET /room/list` routing to pass pagination options into storage.
- [ ] 1.3 Update room list SQL to apply state filtering, newest-first ordering, cursor filtering, default limit, and maximum limit cap.
- [ ] 1.4 Reject unknown cursors and cursors outside the selected state filter with clear errors.

## 2. CLI And Tests

- [ ] 2.1 Add `--before` and `--limit` forwarding to `agent-collab room list`.
- [ ] 2.2 Add server tests for default bounded room list responses.
- [ ] 2.3 Add server tests for state-filtered pagination and `before` cursor behavior.
- [ ] 2.4 Add server tests for invalid cursors and excessive limit capping.
- [ ] 2.5 Add CLI tests proving `room list --before --limit` forwards expected query parameters.

## 3. Validation

- [ ] 3.1 Run the collab server test suite.
- [ ] 3.2 Run the agent-collab CLI test suite.
- [ ] 3.3 Run OpenSpec validation for `paginate-collab-room-list`.
