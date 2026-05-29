# E2E Testing Issues

Last tested: 20260530

## RESOLVED: `join --password-stdin` fails in the real CLI process

Retest on 20260530 confirms the fix works in a real Bun CLI process against a disposable localhost `CollabService` with an isolated SQLite DB. The original failure record is preserved below for traceability.

### What Happened

Running the actual `agent-collab` CLI with `join --password-stdin` exits with status `1` before sending a successful join request. The CLI reports that `io.stdin.text` is not available in the real Bun process.

### Expected

Per `specs/agent-collab-cli-room-membership/spec.md` requirement "CLI handles planner password input safely" and scenario "Password stdin join", `agent-collab join --password-stdin` should read the planner password from stdin, join the room, and avoid echoing the password in stdout or stderr.

### Reproduction

1. Start a disposable `CollabService` on localhost with an isolated SQLite DB.
2. Create a room through the real CLI:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts room create --name cli-e2e-20260530002640 --session ses_planner --from planner --project-dir /home/lohzi/Projects/opencode-assistant
```

3. Copy the one-time planner password from the `room create` output.
4. Pipe the password to the real CLI stdin join path:

```bash
printf '%s\n' '<planner-password>' | AGENT_COLLAB_URL=http://127.0.0.1:<port> bun .opencode/scripts/agent-collab.ts join --room <room-name> --session ses_stdin --name stdinplanner --password-stdin
```

### Evidence

E2E run on 20260530 produced:

```json
{
  "case": "join --password-stdin",
  "exitCode": 1,
  "stderr": "Error: io.stdin.text is not a function. (In 'io.stdin.text()', 'io.stdin.text' is undefined)",
  "stdout": ""
}
```

The same E2E run verified that the password was not echoed in stdout or stderr during this failure, but the join operation did not succeed.

### Affected Requirement

- `openspec/changes/add-agent-collab-cli-room-membership/specs/agent-collab-cli-room-membership/spec.md`: Requirement "CLI handles planner password input safely", scenario "Password stdin join".
- `tasks.md` item `2.3`: Implement join password modes and test `--password-stdin`.

### Recommended Follow-Up

No further fix is recommended for this issue. The prior recommendation to run `/opsx-fix add-agent-collab-cli-room-membership repair real-process password-stdin handling in agent-collab CLI` is superseded by the passing retest below.

### Retest Evidence

Focused E2E retest on 20260530:

1. Ran `openspec validate add-agent-collab-cli-room-membership --strict` and confirmed the change is valid.
2. Ran `bun test ./.opencode/scripts/agent-collab.test.ts` and confirmed `12 pass`, `0 fail`.
3. Started a disposable `CollabService` on `127.0.0.1:19132` with isolated DB `/tmp/agent-collab-stdin-e2e-Futs1L/collab.sqlite`.
4. Created a room through the real CLI and captured the server-generated room name plus one-time planner password from stdout.
5. Piped the planner password to the real CLI process:

```bash
AGENT_COLLAB_URL=http://127.0.0.1:19132 bun .opencode/scripts/agent-collab.ts join --room cli-e2e-stdin-20260530004310-20260530004158 --session ses_stdin_20260530004310 --name stdinplanner --password-stdin
```

Observed result:

```json
{
  "join": {
    "exitCode": 0,
    "stdout": "Room cli-e2e-stdin-20260530004310-20260530004158 is open.\n",
    "stderr": "",
    "leakedPassword": false
  },
  "status": {
    "exitCode": 0,
    "joinedMemberPresent": true,
    "memberCount": 2,
    "state": "open",
    "name": "cli-e2e-stdin-20260530004310-20260530004158"
  }
}
```

Room status confirmed the stdin-joined member exists as planner:

```json
{
  "session_id": "ses_stdin_20260530004310",
  "name": "stdinplanner",
  "role": "planner",
  "state": "active"
}
```

Cleanup completed by shutting down the disposable service and removing the temporary DB directory.
