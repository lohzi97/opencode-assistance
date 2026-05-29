## 1. Identity And Authorization

- [x] 1.1 Add alias validation utilities, then unit-test valid aliases, invalid aliases, and collisions.
- [x] 1.2 Add active member and planner authorization checks, then integration-test planner-only and member-self operations.
- [x] 1.3 Enforce one open room per session, then test add and self-join rejection for sessions already active elsewhere.

## 2. Membership Mutations

- [x] 2.1 Implement planner member add with system message and bootstrap delivery record, then test persisted member/message/delivery ordering.
- [x] 2.2 Implement password self-join as planner, then test valid password, invalid password, missing alias, and no password leakage.
- [x] 2.3 Implement leave and planner removal, then test final-planner rejection and pending delivery/question cancellation.
