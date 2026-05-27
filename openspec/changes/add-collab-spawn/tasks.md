## 1. Spawn API

- [ ] 1.1 Add OpenCode session creation client method, then unit-test explicit agent/model/directory payload mapping.
- [ ] 1.2 Implement planner-only spawn route, then integration-test non-planner rejection and successful `spawned_sessions` persistence.
- [ ] 1.3 Reuse alias/open-room validation for spawned members, then test alias collision and already-active session edge cases.

## 2. Spawn Prompt Ordering

- [ ] 2.1 Render configured or fallback spawn instruction, then unit-test text, file, and fallback templates.
- [ ] 2.2 Queue join bootstrap before initial prompt, then integration-test delivery records and timestamps enforce bootstrap-first order.
- [ ] 2.3 Gate initial prompt injection on bootstrap delivery, then test initial prompt remains pending if bootstrap delivery fails.
