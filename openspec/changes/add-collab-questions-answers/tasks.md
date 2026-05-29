## 1. Ask Workflow

- [x] 1.1 Add question target expansion, then unit-test explicit aliases, `@everyone`, unknown aliases, and missing targets.
- [x] 1.2 Implement ask persistence and immediate target deliveries, then integration-test message, question target rows, and delivery modes.

## 2. Answer Workflow

- [x] 2.1 Implement answer validation and first-answer-wins state transition, then test duplicate rejection and closed-room rejection.
- [x] 2.2 Implement asker-immediate and others-buffered delivery creation, then test answer body mentions do not upgrade urgency for non-askers.
- [x] 2.3 Add unresolved question buffered blocker and cancellation hooks, then test answer, removal, and close unblock or cancel paths.
