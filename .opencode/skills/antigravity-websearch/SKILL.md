---
name: antigravity-websearch
description: Perform web searches using Antigravity CLI (agy) via agent-tui, capturing Gemini-powered web search results as readable text. Use it by default whenever a web search is needed.
---

# Antigravity Web Search

## When to use me

Use this skill whenever a web search is needed — for research, fact-checking, looking up documentation, comparing options, or any task requiring internet-sourced information.

## Prerequisites

- `agent-tui` installed globally (`bun add -g agent-tui`).
- `agy` (Antigravity CLI) installed and authenticated.
- No existing agent-tui session running (only one session at a time).

## Rules

- Always check for an existing daemon/session before starting a new one. If a session exists, kill it first.
- Always resize to a large viewport before taking the final screenshot to capture the full response.
- Always kill the session when done. Never leave a dangling agent-tui session.
- Phrase the query as a web search request: "Do a google search on: xxx"
- Wait for the response to fully generate before capturing. The loading indicator (`⣷ Working...` or `⣯ Generating...`) must be gone.
- If the response is cut off, increase the rows further and re-screenshot.

## Workflow

### 1. Start session

```bash
agent-tui daemon start 2>&1          # Start daemon (idempotent)
agent-tui run agy 2>&1               # Launch Antigravity CLI
```

Verify the TUI is ready:

```bash
agent-tui screenshot 2>&1
```

Look for the input prompt `>` and the model indicator at the bottom.

### 2. Submit search query

```bash
agent-tui type "Can you help me do a web search on '<QUERY>'" 2>&1
agent-tui press Enter 2>&1
```

Replace `<QUERY>` with the actual search topic.

### 3. Wait for response

```bash
sleep 15
agent-tui screenshot 2>&1
```

Check the output for a loading indicator. If still generating (`⣷`, `⣯`, `Generating...`, `Working...`), wait another 10-15 seconds and retry. Continue until the indicator is gone and the response is complete.

### 4. Capture full response

Resize to a large viewport to capture the entire response in one screenshot:

```bash
agent-tui resize --cols 150 --rows 300 2>&1
agent-tui screenshot 2>&1
```

If the response is still truncated, increase rows further (e.g., `--rows 500`).

### 5. Clean up

```bash
agent-tui kill 2>&1
```

Always kill the session when the search is complete.

## Notes

- Antigravity TUI blocks scroll/PageUp/ArrowUp keypresses, so resizing is the only way to capture content beyond the visible viewport.
- The default viewport size is the terminal size. Always resize before the final screenshot.
- Antigravity uses Gemini with Google Search grounding, so results may differ in each different run.
- Antigravity may perform multiple tool calls (WebSearch, ListDir, Read) before generating the final answer. These are visible in the screenshot but the final response is what matters.
