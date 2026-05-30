## 1. Eligibility And Ordering

- [x] 1.1 Add OpenCodeClient methods for session status, pending questions, and async prompt injection, then unit-test mocked success and transient failure responses.
- [x] 1.2 Add buffered eligibility checks, then unit-test each blocker and the eligible idle case.
- [x] 1.3 Add per-target chronological backlog loading, then integration-test multiple pending messages flush in creation order.

## 2. Injection Engine

- [x] 2.1 Add event/tick delivery loop entry points, then test direct flush execution without relying on timers.
- [x] 2.2 Add join bootstrap prompt formatting and delivery, then test bootstrap precedes later room traffic.
- [x] 2.3 Mark delivered records after successful injection, then test idempotent retry does not duplicate delivered records.
