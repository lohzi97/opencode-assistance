## 1. Server Pagination

- [ ] 1.1 Add shared parsing/validation for message `since` and `limit` query parameters, including default and maximum page sizes.
- [ ] 1.2 Update room-wide message queries to resolve cursor position and return only the requested page.
- [ ] 1.3 Update member-scoped message queries to paginate targeted messages before loading delivery annotations.
- [ ] 1.4 Ensure delivery annotations are loaded only for the bounded message page.

## 2. CLI And Tests

- [ ] 2.1 Add server tests for default bounded room transcript reads.
- [ ] 2.2 Add server tests for room-wide `since` plus `limit` behavior.
- [ ] 2.3 Add server tests for member-scoped `since` plus `limit` behavior.
- [ ] 2.4 Add server tests for invalid cursors and excessive limit capping.
- [ ] 2.5 Verify existing CLI tests still prove `--since` and `--limit` are forwarded without local filtering.

## 3. Validation

- [ ] 3.1 Run the collab server test suite.
- [ ] 3.2 Run the agent-collab CLI test suite.
- [ ] 3.3 Run OpenSpec validation for `paginate-collab-room-messages`.
