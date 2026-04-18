20260418

- Requirement clarified: a command-specific auto compaction prompt should be bound only when the session's first user interaction is that custom command.
- OpenCode source confirmation:
  - `packages/opencode/src/session/prompt.ts`: `command.execute.before` fires before `prompt()` creates and saves the command-generated user message.
  - `packages/opencode/src/session/prompt.ts`: `chat.message` fires from `createUserMessage()` while the user message is being created.
  - `packages/opencode/src/session/index.ts` and `packages/opencode/test/server/session-messages.test.ts`: `Session.messages()` exposes existing history; a fresh session has zero messages.
- Root cause remains the same: the plugin forgot the command on continuation messages, so interrupted `/write-diary` sessions lost the command-specific auto prompt.
- Correction to the first patch: merely making command tracking sticky for any later command is too broad.
- Proper fix:
  - only bind a session to a command-specific auto prompt when `command.execute.before` sees the session has no existing messages
  - only bind commands that actually have an entry under `auto.commands`
  - once bound, keep that initial command for the rest of the session
  - ignore legacy state entries that do not record this stricter `session-start` binding
