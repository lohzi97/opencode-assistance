## 1. Close Drain

- [ ] 1.1 Extend close operation to cancel unresolved question targets and queue closure deliveries, then integration-test target cancellation and closure message creation.
- [ ] 1.2 Add closed-room drain selection, then test existing buffered, immediate, and pre-close hard records drain chronologically.
- [ ] 1.3 Adjust close-drain blockers, then test unresolved collab questions are ignored while busy, retry, and pending user question still block.

## 2. Failure Handling

- [ ] 2.1 Add retry classification for transport/backend versus validation failures, then unit-test each classification path.
- [ ] 2.2 Persist attempt count and last error updates, then integration-test retry and permanent failed transitions.
- [ ] 2.3 Extend status and message views with outstanding failures, then test failed deliveries remain visible after close without creating new room messages.
