## 1. Public Message API

- [ ] 1.1 Add planner-only set endpoint, then integration-test full replacement, updater alias, timestamp, and transcript message.
- [ ] 1.2 Add planner-only clear endpoint, then integration-test cleared room fields and `room_public_message_cleared` transcript message.
- [ ] 1.3 Extend room status public-message fields, then test populated and null status responses.

## 2. Notification And Prompt Context

- [ ] 2.1 Create immediate notification deliveries for set/clear operations, then test all other active members are targeted and sender is skipped.
- [ ] 2.2 Extend prompt formatting to include current public message, then test buffered and immediate injections include the latest text when present.
- [ ] 2.3 Test closed-room public-message mutations are rejected while read APIs remain available.
