## 1. Server Pagination

- [x] 1.1 Add parsing/validation for room list `before` and `limit` query parameters.
- [x] 1.2 Update `GET /room/list` routing to pass pagination options into storage.
- [x] 1.3 Update room list SQL to apply state filtering, newest-first ordering, cursor filtering, default limit, and maximum limit cap.
- [x] 1.4 Reject unknown cursors and cursors outside the selected state filter with clear errors.
- [x] 2.1 Add `--before` and `--limit` forwarding to `agent-collab room list`.
- [x] 2.2 Add server tests for default bounded room list responses.
- [x] 2.3 Add server tests for state-filtered pagination and `before` cursor behavior.
- [x] 2.4 Add server tests for invalid cursors and excessive limit capping.
- [x] 2.5 Add CLI tests proving `room list --before --limit` forwards expected query parameters.
- [x] 3.1 Run the collab server test suite.
- [x] 3.2 Run the agent-collab CLI test suite.
- [x] 3.3 Run OpenSpec validation for `paginate-collab-room-list`.
