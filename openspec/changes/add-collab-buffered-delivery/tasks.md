## 1. Eligibility And Ordering

- [ ] 1.1 Add OpenCodeClient methods for session status, pending questions, and async prompt injection, then unit-test mocked success and transient failure responses.
- [ ] 1.2 Add buffered eligibility checks, then unit-test each blocker and the eligible idle case.
- [ ] 1.3 Add per-target chronological backlog loading, then integration-test multiple pending messages flush in creation order.

## 2. Injection Engine

- [ ] 2.1 Add event/tick delivery loop entry points, then test direct flush execution without relying on timers.
- [ ] 2.2 Add join bootstrap prompt formatting and delivery, then test bootstrap precedes later room traffic.
- [ ] 2.3 Mark delivered records after successful injection, then test idempotent retry does not duplicate delivered records.
