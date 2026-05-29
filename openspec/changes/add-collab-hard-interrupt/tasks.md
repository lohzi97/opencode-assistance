## 1. Hard Validation

- [x] 1.1 Add hard flag handling to message creation, then test planner-only, active-target, unknown-target, and self-target validation.
- [x] 1.2 Add OpenCode abort client method, then unit-test mocked abort success and transport failure classification.

## 2. Hard Execution

- [x] 2.1 Implement multi-target abort and idle wait barrier, then integration-test all targets aborted before any injection.
- [x] 2.2 Implement timeout scaling with cap, then unit-test one, many, and capped target counts.
- [x] 2.3 Implement all-or-nothing failure marking and chronological batch injection, then test success and one-target-timeout scenarios.
