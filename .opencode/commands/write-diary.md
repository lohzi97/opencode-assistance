---
description: Generate a daily journal diary from session summaries
agent: sebastian
model: deepseek/deepseek-v4-flash
---

Generate a daily journal diary from session summary files. The diary serves as a factual database for LLM retrieval.

## Input

Date argument: $ARGUMENTS

The argument is an optional date in YYYYMMDD format. If the argument above is empty or whitespace, use today's date (local timezone) by running `date +%Y%m%d`.

## Instruction

1. Determine the target date. Use the date argument above if it is a valid YYYYMMDD string. Otherwise, derive today's date in YYYYMMDD format using `date +%Y%m%d`.

2. Find all session summary files matching `journals/session-summary/{YYYYMMDD}_*.md` using Glob. If no files are found, report that no session summaries exist for that date and stop.

3. Read every matching session summary file. Read them all in parallel.

4. Analyze the session summaries and synthesize them into a daily diary following the **Output Format** below.

5. Ensure the `journals/daily/` directory exists (create it if needed).

6. Write the diary to `journals/daily/{YYYYMMDD}.md`. Always overwrite if the file already exists.

## Output Format

The diary must contain exactly these four sections in this order:

### 1. Overview

1-2 sentences summarizing the day's themes and dominant activities. Focus on what kinds of work were done, not how many sessions.

### 2. About the Master

Record facts, preferences, opinions, and life context the Master mentioned during the day's sessions. Examples include:
- Technical preferences ("Master prefers `uv` for Python")
- Personal context ("Master is a Malaysia resident", "Master uses IBKR for trading")
- Opinions expressed ("Master thinks X is better than Y")
- Background ("Master is an experienced Python developer")

Each fact gets its own bullet. Be self-contained — repeat facts even if they appeared in previous diaries. Only include facts explicitly mentioned or clearly implied in the day's sessions. Do not fabricate or infer unstated facts.

### 3. Topics

Group related sessions into topics. Each topic covers a coherent theme or piece of work. Within each topic, include three sub-sections:

- **What:** Tasks completed, files created/modified, decisions made, research conducted. Bulleted.
- **Why:** The problem, motivation, or context behind the work. 1-2 sentences.
- **Outcome:** Concrete deliverables — commit hashes, file paths, URLs, dollar amounts, configuration changes, research conclusions. Bulleted.

Sessions that are purely research (no code changes) are treated as regular topics alongside code work. Sessions that don't relate to any other session become their own topic with a descriptive name.

### 4. Project State

Brief status of each project or repository that was actively worked on during the day. Include:
- Repository path or project name
- Current state (e.g. "PRD v1.1 complete, no code yet", "3 uncommitted files, ahead of origin by 2 commits")
- Key files that were modified or created

Only include projects that were touched that day. Do not include projects merely mentioned in passing.

## Constraints

- Be strictly factual. Do not include speculation, forward-looking items, open questions, or pending tasks.
- Do not include self-reflection, meta-commentary on assistant performance, or verification notes.
- Do not include technical execution details (how something was done, which tools were used) unless it is a concrete outcome (e.g. a commit hash, a file path).
- Maintain clean, readable Markdown. Use headers and bullets consistently.
- Do not hallucinate or infer content not present in the session summaries.
- Each diary must be self-contained. Do not reference other diaries or say "as mentioned before."

## Example

```markdown
# Daily Journal - 2026-04-25

## Overview

The day focused on a backtester project PRD creation and extending the read-session-file script with pagination metadata.

## About the Master

- Master DCA-invests in gold, silver, and copper ETFs (GLD, SLV, CPER) via IBKR.
- Master is an experienced Python developer with prior MT5 Expert Advisor authoring experience.
- Master wants a generic backtesting tool, not metal-specific, capable of handling stocks, forex, and commodities futures.
- Master rejected a `--json` approach for script output in favor of YAML front matter for readability.

## Topics

### Backtester Project PRD

- **What:**
  - Conducted a 4-phase structured interview to elicit backtesting requirements.
  - Created `~/Projects/backtester/` project directory.
  - Authored a 1,052-line PRD (`~/Projects/backtester/PRD.md`), iterated to v1.1.
  - Documented architecture decisions in `notes/20260425-backtester-project.md`.
- **Why:**
  Master wants a better long-term DCA strategy with improved entry/exit timing and needs a robust backtesting engine to research and validate strategies before live deployment.
- **Outcome:**
  - PRD v1.1 at `~/Projects/backtester/PRD.md`.
  - Key decisions: Pure Python core, FastAPI web layer, React + Vite frontend, TradingView Lightweight Charts, Pydantic BaseModel per strategy, CSV data source with pluggable abstraction, chunk-based memory with rolling-window ring buffer.
  - Phased delivery plan: Core Engine MVP -> Strategies & Indicators -> Reporting & Web UI -> Extensibility & Polish.

### Read-Session-File Pagination Metadata

- **What:**
  - Added `--frontmatter` flag to `.opencode/scripts/read-session-file.js` that prepends YAML front matter with `page`, `last_page`, `total_pages`, and `has_page`.
  - Default plain mode remains unchanged (backward compatible).
- **Why:**
  Callers (`summarize-session`, `write-diary`) were discovering page boundaries by looping until empty output, which was indirect and fragile.
- **Outcome:**
  - `.opencode/scripts/read-session-file.js` updated with opt-in `--frontmatter` flag.
  - `notes/20260425-read-session-file-frontmatter.md` created documenting the change.

## Project State

- **opencode-assistant** (`.opencode/scripts/read-session-file.js`): Modified with new `--frontmatter` flag; change not yet committed.
- **backtester** (`~/Projects/backtester/`): New project directory created with PRD v1.1; no code yet.
```
