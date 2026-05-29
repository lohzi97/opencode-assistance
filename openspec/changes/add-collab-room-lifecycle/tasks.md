## 1. Room Creation

- [x] 1.1 Add room creation route and service method, then integration-test required fields, timestamped name format, and founder planner persistence.
- [x] 1.2 Add planner password generation and one-time response behavior, then test no password or hash appears in persisted messages or inspection responses.
- [x] 1.3 Enforce one open room per founder session, then test rejection when the session is already active elsewhere.

## 2. Room Reads And Closure

- [x] 2.1 Add room status and list routes, then test open-only default listing and closed/all list flags.
- [x] 2.2 Add planner-only close route, then test closure message creation and terminal `closed` state.
- [x] 2.3 Add closed-room mutation guard for room lifecycle routes, then test read-only operations still succeed after close.
