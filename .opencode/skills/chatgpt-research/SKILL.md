---
name: chatgpt-research
description: Perform web research through ChatGPT using the local camofox-browser workflow and optional noVNC login. Use when the user wants research, verification, or question-answering through ChatGPT's website.
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

- Load `camofox-browser` first.
- If a human login step is needed, use the noVNC path from `camofox-browser`.

## Workflow

### Step 1: Start Camofox And Navigate
1. Load `camofox-browser`.
2. Reuse a healthy local Camofox server when possible; otherwise start it locally.
3. Create or reuse a ChatGPT tab at `https://chatgpt.com/` using a stable durable `userId` such as `general`.

### Step 2: Verify Login Status
1. Read the page with a Camofox snapshot.
2. Look for login indicators:
   - Logged in: profile menu present, chat history visible, no primary `Log in` prompt blocking use.
   - Not logged in: `Log in`, `Sign up`, or auth page visible.
3. If not logged in:
   - start or restart VNC through the `camofox-browser` workflow, preferring `lohzi-apps start vnc` for public access,
   - first try the normal ChatGPT login path,
   - if clicking `Log in` from `chatgpt.com` does not produce a usable auth flow in snapshots, navigate directly to `https://auth.openai.com/log-in`,
   - direct Master to the noVNC URL from `camofox-browser`, using `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify` when Master is outside the Linux Mint machine,
   - wait for Master to complete login,
   - then re-check the snapshot.
4. If the login flow destroys or replaces the tab/session, recreate it with the same durable `userId` and then verify login state again.
5. Even after Master successfully logs in during the current run, do not assume future recreated sessions will still be authenticated. Reopen or recreate and verify explicitly whenever continuity matters.

### Step 3: Submit the Research Query
1. Verify the chat input ref is visible in the snapshot.
2. Type the research query through the Camofox `type` endpoint.
3. Submit with `pressEnter=true`.
4. Wait for ChatGPT to generate a response and verify the conversation URL/state.
5. Prefer waiting until the response visibly stabilizes and the input area appears idle again rather than assuming the first visible answer is complete.
6. Do not start extracting findings until generation is complete; otherwise you may capture a partial answer.

### Step 4: Read the Full Response
This is the critical step. Read every part of the response.

1. Fetch a snapshot and read the response from the `main` content area.
2. If the snapshot is truncated, continue with `offset=nextOffset` until complete.
3. If the response extends beyond the current viewport, scroll with the Camofox `scroll` endpoint and fetch a fresh snapshot.
4. Continue until you reach the bottom and further scrolling produces no new content.
5. Do not skip sections and do not summarize prematurely.

### Step 5: Document the Findings
1. Write the research findings to `notes/research/<topic-slug>.md`.
2. Use a clear structure with headings, tables, and bullet points as appropriate.
3. Include all key information gathered.
4. If extraction became partial because the browser state failed mid-run, report that plainly, include whatever was successfully captured, and record the conversation URL if available.

### Step 6: Close Up
1. Close the ChatGPT session/tab when done.
2. Unless Master explicitly asks to keep the browser warm, stop the managed VNC app with `lohzi-apps stop vnc` when it was used, or kill the Camofox PTY session for manual runs.
3. Verify cleanup of leftover `Xvfb`, `x11vnc`, and `websockify` processes and confirm ports `9377`, `6080`, and `5900` are closed when the browser is meant to be stopped.

## Rules

- Always verify login before interacting.
- Always use the `camofox-browser` workflow.
- Read the full response from top to bottom.
- Document findings in `notes/research/` every time.
- If noVNC is needed and fails, follow the `camofox-browser` troubleshooting guidance and pause if recovery is unclear.
- If browser instability interrupts extraction, report partial capture clearly instead of pretending the full answer was read.

## Session Convention

- Recommended ChatGPT session keys: `chatgpt-research`, `chatgpt-login`, or another stable task label
- Recommended durable ChatGPT profile: reuse the same `userId`, e.g. `general`, across login, retries, and future research runs when shared browser history/login continuity is desired.
