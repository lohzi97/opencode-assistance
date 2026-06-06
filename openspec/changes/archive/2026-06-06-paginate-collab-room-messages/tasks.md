## 1. Server Pagination

- [x] 1.1 Add shared parsing/validation for message `since` and `limit` query parameters, including default and maximum page sizes.
- [x] 1.2 Update room-wide message queries to resolve cursor position and return only the requested page.
- [x] 1.3 Update member-scoped message queries to paginate targeted messages before loading delivery annotations.
- [x] 1.4 Ensure delivery annotations are loaded only for the bounded message page.

## 2. CLI And Tests

- [x] 2.1 Add server tests for default bounded room transcript reads.
- [x] 2.2 Add server tests for room-wide `since` plus `limit` behavior.
- [x] 2.3 Add server tests for member-scoped `since` plus `limit` behavior.
- [x] 2.4 Add server tests for invalid cursors and excessive limit capping.
- [x] 2.5 Verify existing CLI tests still prove `--since` and `--limit` are forwarded without local filtering.

## 3. Validation

- [x] 3.1 Run the collab server test suite.
- [x] 3.2 Run the agent-collab CLI test suite.
- [x] 3.3 Run OpenSpec validation for `paginate-collab-room-messages`.
