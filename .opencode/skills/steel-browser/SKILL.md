---
name: steel-browser
description: Use for browser automation, interactive site workflows, screenshots, PDFs, or markdown-first page extraction through the local Steel Browser runtime at `http://localhost:3000/v1`. Use ONLY for this repository's Steel-driven browser path.
---

# Steel Browser

## When To Use

Use this skill for browser work in this repository when Master needs:

- interactive website navigation
- form filling or click flows
- page extraction in markdown or readability form
- screenshots or PDFs from a rendered page
- a browser session that persists across multiple terminal commands

## Core Rule

This repository's browser workflow is the local Steel path, not `chrome-devtools`.

Use the fixed local API endpoint directly:

```text
http://localhost:3000/v1
```

Do not fall back to another browser-capable tool when Steel is unavailable.

If Steel commands fail:

1. troubleshoot Steel first
2. if troubleshooting still fails, report the issue and pause instead of guessing

## Decision Guide

- Prefer `steel scrape` for read-only extraction.
- Prefer `steel screenshot` for a rendered visual capture.
- Prefer `steel pdf` when Master explicitly needs a PDF artifact.
- Prefer `steel browser ... --session ... --api-url http://localhost:3000/v1` for interactive workflows.

## Session Discipline

For interactive work:

1. create a named session with pattern `sebastian-<purpose>-<YYYYMMDDHHmmss>`
2. keep the same session name on every browser command in that workflow
3. stop the session explicitly when done
4. clean up any leftover Steel sessions you notice later

Sanitize `<purpose>` to lowercase kebab-case.

## Minimal Workflow

Read-only extraction:

```bash
steel scrape https://example.com --format markdown --api-url http://localhost:3000/v1
```

Interactive session:

```bash
SESSION="sebastian-example-task-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

## Supporting Files

- `REFERENCE.md`: stable command patterns and workflow rules
- `EXAMPLES.md`: copyable end-to-end command sequences
- `TROUBLESHOOTING.md`: failure handling and pause/report rules
