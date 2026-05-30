# E2E Testing Issues

## HIGH: `messages --member` spec scenario fails without `--session`

### Summary

Confirmed during E2E testing on 20260530. The spec scenario says `agent-collab messages` with `--member`, `--since`, and `--limit` should send the corresponding query parameters and print the server response, but the real CLI process exits non-zero when `--member` is used without `--session`.

### Expected

`agent-collab messages --room <room> --member worker --since <message_id> --limit 2 --json` should succeed for the member-scoped transcript scenario described in `openspec/changes/add-agent-collab-cli-messaging/specs/agent-collab-cli-messaging/spec.md` lines 20-22.

### Actual

The command exits with code `1` and prints the server validation error:

```json
{
  "error": "session_id is required for member message view",
  "details": {
    "error": "session_id is required for member message view"
  }
}
```

### Reproduction

1. Start a disposable `CollabService` on localhost with an isolated SQLite DB.
2. Create a room through the real CLI:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts room create --name cli-msg-e2e-20260530082633 --session ses_planner_20260530082633 --from planner --project-dir /home/lohzi/Projects/opencode-assistant --json
```

3. Add a worker through the real CLI:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts member add --room <room> --session ses_planner_20260530082633 --from planner --target-session ses_worker_20260530082633 --name worker --role implementer --json
```

4. Create at least one message and capture its `id`:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts send --room <room> --session ses_planner_20260530082633 --from planner --body "Buffered hello" --kind note --json
```

5. Run the member-scoped spec scenario without `--session`:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts messages --room <room> --member worker --since <message_id> --limit 2 --json
```

### Evidence

E2E harness check `T14` failed:

```json
{
  "id": "T14",
  "result": "FAIL",
  "detail": "messages supports spec scenario with --member, --since, and --limit without --session",
  "evidence": {
    "exitCode": 1,
    "stdout": "",
    "stderr": "{\n  \"error\": \"session_id is required for member message view\",\n  \"details\": {\n    \"error\": \"session_id is required for member message view\"\n  }\n}\n"
  }
}
```

Related passing control case: `messages --room <room> --session ses_worker_20260530082633 --member worker --json` passed and returned a member delivery view.

### Affected Requirement

- `agent-collab-cli-messaging` spec: Requirement "CLI supports questions, answers, and transcript reads", scenario "Member-scoped messages request".
- PRD CLI syntax in `notes/agent-collaboration.md` lists `agent-collab messages --room <name> [--session <session_id> | --member <alias>] [--since <message_id>] [--limit <n>] [--json]`, implying either selector should be accepted.

### Recommended Follow-Up

Run `/opsx-fix add-agent-collab-cli-messaging repair messages --member without --session behavior`.

### Retest 20260530

Status: PASS after fix.

The previously failing real CLI scenario now succeeds against a disposable localhost `CollabService` with isolated SQLite state. The retest used a temporary Bun harness, removed after cleanup, to start the service and invoke the real CLI as subprocesses equivalent to:

`AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts messages --room <room> --member worker --since <message_id> --limit 2 --json`

Key retest evidence:

- `agent-collab messages --room <room> --member worker --since <message_id> --limit 2 --json` exited `0` without `--session`.
- The JSON response included `member.session_id` for the worker session and `member.name: "worker"`.
- The response included the worker-targeted message body `@worker please implement`.
- The response did not include the reviewer-targeted control message `@reviewer please review`.
- Control checks passed for session-only transcript reads, room-wide transcript reads, and server-authored validation for mismatched `--session`/`--member`.

No new issues were found during this focused E2E retest.
