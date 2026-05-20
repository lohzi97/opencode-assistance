# Steel Browser Reference

## Runtime Contract

- Local API endpoint: `http://localhost:3000/v1`
- Repo-managed container name: `opencode-assistant-steel-browser`
- Repo-managed runtime image: `ghcr.io/steel-dev/steel-browser:latest`
- Expected container ports: `3000` and `9223`
- Runtime lifecycle owner: `./start.sh` and `./stop.sh`

Normal workflows should assume the endpoint above directly.

Do not inspect Docker first during routine work.

Use Docker checks only in troubleshooting when Steel commands fail.

## Read-Only Preference Order

For read-only work, prefer:

1. `steel scrape`
2. `steel screenshot`
3. `steel pdf`

Use `steel browser` only when the task is interactive or stateful.

## Interactive Session Contract

Session naming pattern:

```text
sebastian-<purpose>-<YYYYMMDDHHmmss>
```

Rules:

1. sanitize `<purpose>` to lowercase kebab-case
2. keep the same `--session` value across the whole workflow
3. include `--api-url http://localhost:3000/v1` explicitly
4. stop the session explicitly at the end

## Stable Command Patterns

### Scrape

Markdown-first extraction:

```bash
steel scrape https://example.com --format markdown --api-url http://localhost:3000/v1
```

Readability-focused extraction:

```bash
steel scrape https://example.com --format readability,markdown --api-url http://localhost:3000/v1
```

Structured output when parsing matters:

```bash
steel scrape https://example.com --raw --api-url http://localhost:3000/v1
```

### Screenshot

Ad hoc output:

```bash
steel screenshot https://example.com --full-page --api-url http://localhost:3000/v1
```

This returns the hosted screenshot URL or the response payload.

If a saved local artifact is explicitly needed, use a short browser session and save into `/tmp`:

```bash
SESSION="sebastian-example-screenshot-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser screenshot /tmp/steel-example.png --full --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

### PDF

Ad hoc output:

```bash
steel pdf https://example.com --api-url http://localhost:3000/v1
```

This returns the hosted PDF URL or the response payload.

If a saved local artifact is explicitly needed, use a short browser session and save into `/tmp`:

```bash
SESSION="sebastian-example-pdf-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser pdf /tmp/steel-example.pdf --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

### Start Or Attach An Interactive Session

```bash
SESSION="sebastian-some-purpose-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
```

### Open A Page

```bash
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
```

Standardize on `steel browser open`, not `navigate`.

### Snapshot Discipline

Prefer compact interactive snapshots first:

```bash
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
```

Only increase depth or drop compact mode when the page structure requires it.

Take a fresh snapshot after meaningful DOM changes before using element references again.

### Common Interactive Actions

```bash
steel browser click @e1 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser fill @e2 "value" --session "$SESSION" --api-url http://localhost:3000/v1
steel browser press Enter --session "$SESSION" --api-url http://localhost:3000/v1
steel browser wait --text "Success" --session "$SESSION" --api-url http://localhost:3000/v1
steel browser screenshot --full --session "$SESSION" --api-url http://localhost:3000/v1
```

### Stop The Session

```bash
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

## Snapshot And Batching Rules

- Prefer one good snapshot over repeated noisy probing.
- Reuse the same session for a coherent task.
- Re-snapshot after clicks, fills, navigation, or page transitions.
- Avoid stale references by not reusing old `@e...` handles after the DOM changes.

## Local Artifact Rule

If a saved screenshot or PDF is explicitly needed, write it under `/tmp`.

If no persistent artifact is needed, use ad hoc output instead.

## Unsupported Workflow In This Repository

- do not use `steel dev start`
- do not use `steel dev stop`
- do not rely on Steel cloud login or cloud-only setup guidance
- do not silently fall back to `chrome-devtools`
