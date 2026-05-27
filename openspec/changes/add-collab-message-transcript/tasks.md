## 1. Message Creation

- [ ] 1.1 Add sender identity validation, then integration-test valid, inactive, and mismatched member send attempts.
- [ ] 1.2 Add mention parser and target expansion, then unit-test no mention, single mention, multiple mentions, `@everyone`, unknown mention, and self-skip cases.
- [ ] 1.3 Persist messages and delivery records, then test buffered versus immediate mode selection and chronological timestamps.

## 2. Transcript Reads

- [ ] 2.1 Add room-wide messages endpoint, then test all member-authored and system messages appear with delivery annotations.
- [ ] 2.2 Add member/session-scoped messages endpoint, then test targeted deliveries and delivery states are filtered correctly.
