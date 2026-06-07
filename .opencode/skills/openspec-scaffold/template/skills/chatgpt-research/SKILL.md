---
name: chatgpt-research
description: Perform web research via ChatGPT using Chrome and computer-control MCP. Use when user wants to research a topic through ChatGPT, ask ChatGPT a question, or gather information from ChatGPT's web interface.
---

# ChatGPT Research

## When To Use

Use this skill when the user wants to research a topic using ChatGPT's web interface. This skill combines the `chrome` skill (to launch a browser) with the `computer-control` MCP (to interact with the page like a human).

Typical requests:

- "Research [topic] on ChatGPT."
- "Ask ChatGPT about [question]."
- "Use ChatGPT to find information about [topic]."
- "Look up [topic] via ChatGPT."

## Prerequisites

- **chrome skill** — must be loaded first to start the browser.
- **computer-control MCP** — required for all page interaction (mouse, keyboard, screenshots with OCR).
- If either is missing, report the limitation to the user immediately and do not proceed.

## Workflow

### Step 1: Start Chrome and Navigate

1. Load the `chrome` skill and start a Chrome instance.
2. Navigate to `https://chatgpt.com/` by clicking the address bar and typing the URL.

### Step 2: Verify Login Status

1. Take an OCR screenshot (`take_screenshot_with_ocr`).
2. Look for login indicators:
   - **Logged in:** User profile name visible, "New chat" sidebar present.
   - **Not logged in:** "Log in" or "Sign up for free" buttons visible.
3. If not logged in, inform the user and wait for them to log in before continuing.

### Step 3: Submit the Research Query

1. Click on the "Ask anything" input field (roughly center-bottom of the page).
2. Type the research question using `type_text`.
3. Press `Enter` to submit.
4. Wait 10-15 seconds for ChatGPT to generate a response.

### Step 4: Read the Full Response

**This is the most critical step. You MUST read every part of the response.**

1. Press `Home` key to scroll to the top of the page.
2. Verify that the original question is visible at the top of the response.
3. Use `PageDown` to scroll through the response one section at a time.
4. After each `PageDown`, take an OCR screenshot to capture the visible content.
5. Continue scrolling until you reach the bottom of the page (no new content appears).
6. Do NOT skip sections. Do NOT summarize prematurely. Read every part.

### Step 5: Document the Findings

1. Write the research findings to `notes/research/<topic-slug>.md`.
2. Use a clear structure with headings, tables, and bullet points as appropriate.
3. Include all key information gathered — do not omit details.

### Step 6: Close Up

1. Close the ChatGPT tab: `press_keys` with `[["ctrl", "w"]]`.
2. Close the Chrome window: `press_keys` with `[["ctrl", "shift", "w"]]`.
3. Kill the Chrome PTY session via `pty_kill`.

## Rules

- **Always verify login before interacting.** Never assume the user is logged in.
- **Always use OCR to read page content.** Do not guess or assume what is on screen.
- **Read the FULL response.** Scroll through every section using `PageDown`. Never skip content.
- **Document findings in a file.** Never return research results only in chat — always write them to `notes/research/`.
- **Use computer-control MCP exclusively** for all page interaction (not chrome-devtools MCP). This ensures human-like browsing behavior.
- **If OCR is unavailable or failing**, inform the user and pause the task.

## Keyboard Shortcuts Reference

| Action | Shortcut |
| :--- | :--- |
| Scroll to top | `Home` |
| Scroll one section | `PageDown` |
| Close tab | `Ctrl + W` |
| Close window | `Ctrl + Shift + W` |
