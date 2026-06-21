---
name: deepseek-research
description: Perform web-grounded research through DeepSeek's chat web app using Instant mode with DeepThink and Search enabled, then verify cited sources via camofox browser. Use when the user wants research, synthesis, or question-answering through DeepSeek, or explicitly mentions DeepSeek research.
---

# DeepSeek Research

## When To Use

Use this skill when the user wants to research a topic using DeepSeek's web interface.

Typical requests:

- "Research [topic] on DeepSeek."
- "Ask DeepSeek about [question]."
- "Use DeepSeek to find information about [topic]."
- "Look up [topic] via DeepSeek."
- Master explicitly mentions DeepSeek and research in the same request.

## Prerequisites

- Load `camofox-browser` first.
- If a human login step is needed, use the noVNC path from `camofox-browser`.

## Workflow

### Step 1: Start Camofox And Navigate

1. Load `camofox-browser`.
2. Reuse a healthy local Camofox server when possible; otherwise start it locally.
3. Create or reuse a DeepSeek tab at `https://chat.deepseek.com/` using a stable durable `userId` of `general`.

### Step 2: Verify Login Status

1. Read the page with a Camofox snapshot.
2. Look for login indicators:
   - Logged in: chat history visible (e.g. "New chat"), mode selector (Instant/Expert/Vision) present, textbox "Message DeepSeek" present.
   - Not logged in: `Log in`, `Sign up`, or auth page visible.
3. If not logged in:
   - start or restart VNC through the `camofox-browser` workflow, preferring `lohzi-apps start vnc` for public access,
   - direct Master to the noVNC URL from `camofox-browser`, using `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify` when Master is outside the Linux Mint machine,
   - wait for Master to complete login,
   - then re-check the snapshot.
4. Re-verify login whenever a session is recreated.

### Step 3: Enforce Research Mode (Critical)

DeepSeek has several modes. For research, **always** verify all three before submitting the query:

1. **Model**: `Instant` must be the selected radio. Do not use Expert or Vision unless Master explicitly asks.
2. **DeepThink**: must be enabled (toggle pressed).
3. **Search**: must be enabled (toggle pressed).

Verification method — take a snapshot and confirm:
- `Instant` appears as the active model (not Expert, not Vision).
- `DeepThink` and `Search` toggles are in pressed/selected state.

For DOM-level confirmation, use the `evaluate` endpoint:

```bash
curl -X POST http://localhost:9377/tabs/<tabId>/evaluate \
  -H 'Content-Type: application/json' \
  -d '{"userId":"general","expression":"(() => ({ instantSelected: document.querySelector(\"[data-model-type=default]\")?.getAttribute(\"aria-checked\"), deepthinkPressed: document.evaluate(\"count(//div[contains(@class,\"ds-toggle-button\") and normalize-space(.)=\"DeepThink\" and @aria-pressed=\"true\"]\", document, null, XPathResult.NUMBER_TYPE, null).numberValue > 0, searchPressed: document.evaluate(\"count(//div[contains(@class,\"ds-toggle-button\") and normalize-space(.)=\"Search\" and @aria-pressed=\"true\"]\", document, null, XPathResult.NUMBER_TYPE, null).numberValue > 0 }))()"}}'
```

Expected: `instantSelected: "true"`, `deepthinkPressed: true`, `searchPressed: true`.

If any mode is wrong, click the corresponding toggle/radio and re-verify before proceeding.

This step is mandatory. Never submit a research query without verifying all three.

### Step 4: Submit the Research Query

1. Verify the chat input is visible. Selector: `textarea[placeholder="Message DeepSeek"]`.
2. Type the research query through the Camofox `type` endpoint with `pressEnter: true`.
3. Phrase the query to request:
   - a concise synthesis
   - a taxonomy or structured breakdown
   - specific examples/tools/frameworks
   - source links for important claims
4. Wait for DeepSeek to start generating (look for "Thinking" indicator or search activity).

### Step 5: Read the Full Response (Extraction Loop)

DeepSeek responses are long and the webapp renders incrementally. **You must loop until the response is complete.** This is a known limitation of driving the webapp via camofox; the flow is not difficult, just repetitive.

Repeat until no new content appears on two consecutive passes:

1. `POST /tabs/:tabId/wait` with `timeoutMs` between 8000 and 20000.
2. `GET /tabs/:tabId/snapshot?userId=general`.
3. Check whether content is still streaming (e.g. "Thinking" indicator still present, partial paragraphs, copy/download buttons not yet rendered at the end).
4. `POST /tabs/:tabId/scroll` with `deltaY` around 1500 to reveal more.
5. `GET /tabs/:tabId/snapshot?userId=general` again.

Continue until:
- the input area is idle (no streaming indicator),
- further scrolling produces no new content,
- every section, table, and code block has been read from top to bottom.

**Do not summarize prematurely.** A partial read produces a partial answer.

### Step 6: Verify Cited Sources

DeepSeek cites sources inline as numbered links. Verify the important claims against primary sources.

**Standardize on camofox browser for verification, not `webfetch`.**

Rationale:
- `webfetch` returns raw HTML cluttered with nav chrome and cannot handle JavaScript or bot detection.
- camofox snapshots are accessibility-tree extractions — already clean semantic text.
- camofox handles JavaScript-rendered pages and bot-protected sources.

Verification procedure per source:

1. **GitHub README / docs**: open a new tab and navigate to `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` for pure markdown, then snapshot. This avoids GitHub's nav chrome entirely.
2. **Static docs sites** (mdbook, sphinx, docusaurus): navigate and snapshot.
3. **JS-rendered / SPA sources**: navigate and snapshot (the only reliable option).
4. **Bot-protected sources**: navigate and snapshot (stealth handles it).
5. **Known-clean raw URLs** (plain text endpoints, raw markdown): `webfetch` is acceptable as a fast path, since the output is already clean.

For each cited claim worth verifying, record:
- the claim
- DeepSeek's source URL
- verification status: confirmed / partial / not found / contradicted
- confidence

### Step 7: Document the Findings

1. Write the research findings to `notes/research/<YYYYMMDD>-<topic-slug>.md`.
2. Recommended structure:
   - Goal
   - Main conclusion / synthesis
   - Verified findings (with source links)
   - Taxonomy or structured breakdown
   - Recommended architecture or actionable recommendations (if applicable)
   - Caveats (unverifiable sources, secondary materials, language of response, etc.)
3. Include the DeepSeek conversation URL at the top of the note for traceability.
4. Update `notes/README.md` if a new research entry is created.

### Step 8: Close Up

1. Checkpoint the `general` profile: `DELETE /sessions/general`.
2. Close the DeepSeek tab and any verification tabs.
3. Unless Master explicitly asks to keep the browser warm, stop the managed VNC app with `lohzi-apps stop vnc` when it was used, or kill the Camofox PTY session for manual runs.
4. Verify cleanup of leftover `Xvfb`, `x11vnc`, and `websockify` processes and confirm ports `9377`, `6080`, and `5900` are closed when the browser is meant to be stopped.

## Rules

- Always verify login before interacting.
- **Always verify Instant + DeepThink + Search mode before submitting.** This is non-negotiable.
- Always use the `camofox-browser` workflow for both research and source verification.
- Read the full response using the wait-resnapshot-scroll-resnapshot loop until exhausted.
- Verify cited sources via camofox browser, not `webfetch`, except for known-clean raw URLs.
- Document findings in `notes/research/` every time.
- If extraction is interrupted by browser instability, report partial capture clearly instead of pretending the full answer was read.

## Session Convention

- Recommended DeepSeek session keys: `deepseek-research`, `deepseek-login`, or another stable task label.
- Recommended durable profile: reuse `userId=general` across login, retries, and future research runs when shared browser history/login continuity is desired.

## DeepSeek Page Element Reference

- Model radio (Instant): `[data-model-type="default"]`; active when `aria-checked="true"`.
- DeepThink toggle: `div.ds-toggle-button` containing text "DeepThink"; active when `aria-pressed="true"` or class contains `ds-toggle-button--selected`.
- Search toggle: `div.ds-toggle-button` containing text "Search"; active when `aria-pressed="true"` or class contains `ds-toggle-button--selected`.
- Chat input: `textarea[placeholder="Message DeepSeek"]`.
- Response area: main content region below the input after submission; long responses require scrolling to fully render.
