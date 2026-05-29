## 1. Immediate Eligibility

- [x] 1.1 Add immediate eligibility checks, then unit-test busy allowed, retry blocked, and pending user question blocked.
- [x] 1.2 Extend delivery selection to mixed buffered/immediate queues, then test per-target chronological ordering.

## 2. Immediate Injection

- [x] 2.1 Add immediate prompt labeling and injection, then integration-test prompt content for sender, room, kind, and body.
- [x] 2.2 Add combined batch injection when older buffered records exist, then test a newer immediate message flushes exactly one ordered batch.
- [x] 2.3 Test `kind` remains informational by verifying mentioned notes are immediate and unmentioned task assignments are buffered.
