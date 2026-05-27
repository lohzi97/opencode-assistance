## Why

Once the service APIs exist, agents need CLI access to the live collaboration actions used most often during implementation: sending messages, asking/answering questions, managing the public message, and reading transcripts. This implements the remaining CLI surface from `notes/agent-collaboration.md` lines 698-700 and 714-725.

## What Changes

- Add `agent-collab room public-message set|clear` commands with text, file, and stdin input modes.
- Add `send` command with body text, file, stdin, kind, hard flag, and JSON output support.
- Add `ask`, `answer`, and `messages` commands.
- Preserve the CLI as a thin HTTP wrapper with human-readable defaults and structured JSON mode.

## Capabilities

### New Capabilities
- `agent-collab-cli-messaging`: CLI commands for public messages, sending, asking, answering, and transcript inspection.

### Modified Capabilities
- None.

## Impact

- Completes v1 `agent-collab` CLI coverage from the PRD.
- Depends on room/member CLI foundation and all relevant collab HTTP APIs.
