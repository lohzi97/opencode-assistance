# Steel Browser Troubleshooting

## Rule First

If Steel commands fail, troubleshoot Steel first.

If the checks below do not resolve the issue, report the problem clearly and pause.

Do not guess.

Do not fall back to `chrome-devtools` or any other browser-capable tool.

## 1. Steel CLI Missing

Check:

```bash
steel --version
```

If that fails, the Steel CLI is unavailable in this shell.

Report that the repo's required browser CLI is missing and pause.

## 2. Local Runtime Not Running

Check the endpoint first:

```bash
curl http://localhost:3000/v1/health
```

If that fails, check whether the repo-managed container is running:

```bash
docker ps --filter name=opencode-assistant-steel-browser
```

If needed, inspect recent logs:

```bash
docker logs opencode-assistant-steel-browser
```

Useful human-facing check:

```text
http://localhost:3000/ui
```

## 3. Stale Element References

Symptoms:

- click or fill targets no longer exist
- refs from an earlier snapshot stop working

Fix:

1. take a fresh snapshot
2. use the new refs

Preferred refresh command:

```bash
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
```

## 4. Session Confusion

Symptoms:

- commands appear to operate on the wrong page
- state disappears between commands
- stop does not target the intended session

Fix:

1. verify the exact session name
2. reuse the same `--session` value on every command
3. inspect current sessions if needed

```bash
steel browser sessions --api-url http://localhost:3000/v1
```

If there are leftover sessions from earlier work, clean them up explicitly.

## 5. Browser Command Failure

When a specific `steel browser` command fails:

1. confirm the session exists
2. confirm the endpoint responds
3. re-run with the same session and a fresh snapshot if the page changed

Minimal checks:

```bash
steel browser sessions --api-url http://localhost:3000/v1
curl http://localhost:3000/v1/health
```

## 6. Port Or Container Problem

If the local runtime is unavailable, common causes include:

- Docker unavailable
- Docker daemon down
- port `3000` already occupied
- failed image pull with no usable local image

Diagnostic checks:

```bash
docker ps -a --filter name=opencode-assistant-steel-browser
docker logs opencode-assistant-steel-browser
curl http://localhost:3000/v1/health
```

## 7. Pause And Report Condition

Pause and report when:

- `steel --version` fails
- `curl http://localhost:3000/v1/health` fails and runtime checks do not recover it
- session commands keep failing after a fresh snapshot and session verification
- the repo-managed Steel container is missing or unhealthy and the problem is not self-evident

Report plainly:

1. what command failed
2. what checks you ran
3. what the blocking Steel issue is
