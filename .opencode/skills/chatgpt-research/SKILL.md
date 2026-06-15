---
name: chatgpt-research
description: Perform web research through ChatGPT in Chrome using the browser interaction workflow. Use when the user wants research, verification, or question-answering through ChatGPT's website, with findings written to notes for later reuse.
---

# ChatGPT Research

## When To Use

Use this skill when the user wants to research a topic using ChatGPT's web interface.

Typical requests:

- "Research [topic] on ChatGPT."
- "Ask ChatGPT about [question]."
- "Use ChatGPT to find information about [topic]."
- "Look up [topic] via ChatGPT."

## Prerequisites

- Load `browser-interact` first.
- Load `chrome` and start a Chrome instance.
- If either requirement is missing, report the limitation immediately and stop.

## Workflow

### Step 1: Start Chrome and Navigate
1. Load `browser-interact`.
2. Start Chrome if needed.
3. Navigate to `https://chatgpt.com/` using the browser workflow.

### Step 2: Verify Login Status
1. Take a full-desktop screenshot with cursor visible.
2. Look for login indicators:
   - Logged in: user profile name visible, `New chat` sidebar present.
   - Not logged in: `Log in` or `Sign up for free` visible.
3. If not logged in, inform the user and wait for them to log in before continuing.

### Step 3: Submit the Research Query
1. Verify the chat input is visible.
2. Click into the input if focus is uncertain.
3. Type the research query in short chunks, verifying between chunks.
4. Submit with `enter`.
5. Wait for ChatGPT to generate a response and verify the page state.

### Step 4: Read the Full Response
This is the critical step. Read every part of the response.

1. Press `home` to scroll to the top.
2. Verify that the original question is visible at the top of the response.
3. Use `pagedown` to scroll through the response one section at a time.
4. After each `pagedown`, take a full-desktop screenshot to capture the visible content.
5. Continue until you reach the bottom and further scrolling produces no new content.
6. Do not skip sections and do not summarize prematurely.

### Step 5: Document the Findings
1. Write the research findings to `notes/research/<topic-slug>.md`.
2. Use a clear structure with headings, tables, and bullet points as appropriate.
3. Include all key information gathered.

### Step 6: Close Up
1. Close the ChatGPT tab with `Ctrl+W`.
2. Close the Chrome window with `Ctrl+Shift+W`.
3. Kill the Chrome PTY session via `pty_kill`.

## Rules

- Always verify login before interacting.
- Use the browser workflow from `browser-interact`.
- Prefer full-desktop screenshots with cursor visible.
- Read the full response from top to bottom.
- Document findings in `notes/research/` every time.
- If screenshot-based verification is failing, inform the user and pause the task.

## Keyboard Shortcuts Reference

| Action | Shortcut |
| :--- | :--- |
| Scroll to top | `home` |
| Scroll one section | `pagedown` |
| Close tab | `Ctrl + W` |
| Close window | `Ctrl + Shift + W` |
