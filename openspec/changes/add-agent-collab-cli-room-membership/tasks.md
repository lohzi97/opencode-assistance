## 1. CLI Foundation

- [ ] 1.1 Add CLI entry point, argument parser, base URL default, and `AGENT_COLLAB_URL` override, then unit-test URL resolution.
- [ ] 1.2 Add shared HTTP request/error handling and `--json` output mode, then unit-test success and non-2xx responses.

## 2. Room And Membership Commands

- [ ] 2.1 Implement room create/status/list commands, then test request payloads and human-readable room-create password warning.
- [ ] 2.2 Implement member add/remove and leave commands, then test required identity flags and request payloads.
- [ ] 2.3 Implement join password modes, then test `--password`, `--password-stdin`, and no password echoing.
- [ ] 2.4 Implement spawn command arguments, then test explicit agent/model/directory/initial-prompt request mapping.
