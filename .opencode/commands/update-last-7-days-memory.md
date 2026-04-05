---
description: Create a concise memory brief of the last 7 days (excluding today)
agent: sebastian
---

Update `memory/last-7-days.md` with a concise, factual brief of the past seven days (NOT including today).

Purpose: Let stateless assistants quickly know what was done during the past 7 days by reading a single brief file.

Instruction:

1. Time window: the last 7 calendar days excluding today (local timezone). For example, if today is 2026-04-05, include 2026-03-29..2026-04-04 inclusive.

2. Source files: `journals/daily/YYYYMMDD.md` for each date in the window. Only include days for which a journal file exists.

3. Content: produce a concise facts-only brief. Each day should contain:
   - Date (YYYY-MM-DD)
   - Overview: 1 short sentence summarizing main themes.
   - Accomplishments: 2-6 short bullet facts (one-line each) describing what was done or created. Do NOT include follow-ups, recommendations, or subjective reflection.
   - See: file path to the original diary journal.

4. Ordering: newest day first (most recent date at top).

5. Idempotency and safety:
   - If `memory/last-7-days.md` already exists, overwrite it.
   - Do not modify journal files.

6. Implementation notes for an automated runner (human/agent guidance):
   - Use Glob to list `journals/daily/*.md`. Parse filenames to determine dates.
   - For each date in the 7-day window, Read the file and extract the Overview and Accomplishments sections. If Accomplishments section is missing, synthesize 1-2 short factual bullets from the top-level sections (Key Activities / Notes) but keep strictly factual.
   - Produce `memory/last-7-days.md` with these sections for each day in the window. Keep total file short; avoid session-level detail — this is a brief summary.

Keep the brief precise and strictly factual.

<example>
2026-04-02
- Overview: Session export improvements, cron slash-command routing, and meta-journal verification.
- Accomplishments:
  - Updated `.opencode/plugins/export-session.ts` to add startup backfill and a durable export manifest; export filenames now include millisecond precision and session ID.
  - Modified `.opencode/server/index.ts` to detect slash-prefixed cron prompts and route them to the command endpoint `/session/{sessionID}/command` (change present on disk; server restart required to validate runtime behavior).
  - Verified presence of several `.opencode` artifacts referenced in sessions; identified a discrepancy where `.opencode/command/` (singular) was claimed but is missing.
- See: journals/daily/20260402.md

2026-03-30
- Overview: Cron-triggered question-tool testing and inspection of the cron worker state handling.
- Accomplishments:
  - Generated and invoked `ask-question` tool payloads for automated testing; two invocations were prepared and dismissed by the user (recorded in session files).
  - Confirmed cron worker state location and logic: `.opencode/server/state/cron-state.json` contains runs and active mappings; `.opencode/server/index.ts` marks active sessions and prunes via `/session/status` and event stream.
  - Recorded session files with metadata and exported timestamps; session files remain on disk but are untracked by git.
- See: journals/daily/20260330.md

2026-03-29
- Overview: Persona/profile updates and repository reorganization with session-export workflow and commit generation.
- Accomplishments:
  - Updated `MASTER.md` with grouped user profile sections and created `/know-your-master` command and two skill definition files under `.opencode/skills/`.
  - Added `.opencode/plugins/export-session.ts` and `.opencode/export-session.jsonc`; reorganized command files into `.opencode/commands/` and produced a commit `chore(opencode): add session export workflow` present in git history.
  - Verified the new files exist on disk; noted a directory naming inconsistency between `.opencode/command/` and `.opencode/commands/`.
- See: journals/daily/20260329.md
</example>
