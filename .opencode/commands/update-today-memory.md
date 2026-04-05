---
description: Create a concise memory brief of today's interactions for context retention
agent: sebastian
---
Update `memory/today.md` with a concise brief of today's interactions. 

This command MUST be efficient: it should only summarize session files that are new for today and remove any session summaries that are no longer part of today's session set.

Algorithm (precise, idempotent):

1. Determine today's session file pattern: `journals/session/YYYYMMDD*.md` (local timezone).

2. Enumerate current session files using Glob. Sort them chronologically (oldest first) so summaries appear in time order.

3. Read the existing `memory/today.md` (if present) and extract the list of session filenames already recorded. Treat these as the "existing set".

4. Compute two sets:
   - New sessions = Current set - Existing set
   - Removed sessions = Existing set - Current set

5. For Removed sessions: remove their entries from the Session Summary section in `memory/today.md`. If any Key Decisions are specific to removed sessions, remove or re-evaluate them when regenerating the Key Decisions section (see step 8).

6. For New sessions: launch the subagent and ask it to read the full session file and return a compact structured summary with these fields:
   - filename: the session filename
   - timestamp: session timestamp (ISO or YYYYMMDDHHMMSS)
   - request: one-line original user request
   - outcome: one-line concise what was accomplished
   - decisions: short bullet points (if any)
   - important_files: short list of modified/created files mentioned in session
   - one_line_summary: 1 sentence suitable for Overview aggregation

   Use subagent and run these calls.

7. Merge results: add each new session summary into the Session Summary section of `memory/today.md` with the line format:
   - <filename> — <one_line_summary>.

8. Recompute the Overview, Key Decisions and Quick Context sections from the union of the remaining (kept) session summaries and the newly added summaries:
   - Overview: synthesize 1-2 sentences from the one_line_summary fields across sessions (focus on themes and dominant activities).
   - Key Decisions: aggregate unique decision bullets from all current session summaries (deduplicate by text).
   - Quick Context: aggregate unique important_files and any repository state notes reported by subagents.

9. Write `memory/today.md` atomically (overwrite). Ensure the file contains these sections in this order: Overview, Session Summary (chronological), Key Decisions, Quick Context. Include for every session entry: `See: journals/session/<filename>.md for details` so it can be used to trace full context.

10. Idempotency and safety:
    - If there are no changes (New sessions empty and Removed sessions empty) do not call subagents and do not rewrite `memory/today.md` unnecessarily.
    - Do not perform any destructive operations on session files (no renames/deletes) — only update `memory/today.md`.
    - Keep summaries short; prefer one-line summaries and concise bullets.

Notes on implementation details for the command implementation:
  - Use Glob to discover session files. Use Read to load `memory/today.md` when present. Use the Task tool to invoke the subagent sequentially for each new session file.
  - Parse and edit `memory/today.md` structurally (remove session blocks by matching filenames rather than naive string replace) to avoid accidental edits.
  - If a subagent fails to summarize a new session, retry up to 2 times; if it still fails, include a placeholder entry noting the failure and continue.

Keep it SHORT — this is a one-page brief, not a transcript. Overwrite `memory/today.md` only when there are genuine content changes.

<example>
Overview: Today's work concentrated on journal tooling and session export improvements. Only new session files were summarized; removed summaries were pruned.

Session Summary:
- 20260405123857902-ses_2a413d8dfffewB63v4RRB966rc.md — Memory-today compilation, created export tooling commit. See: journals/session/20260405123857902-ses_2a413d8dfffewB63v4RRB966rc.md for details
- 20260405123100327-ses_2a499cda9ffe3AaIGePVwMbmQN.md — Added update-today-memory command and summarized sessions. See: journals/session/20260405123100327-ses_2a499cda9ffe3AaIGePVwMbmQN.md for details

Key Decisions:
- Use sequential 'sebastian' subagents to summarize only new session files and avoid bulk reads.
- Do not perform destructive filesystem operations without explicit approval.

Quick Context:
- Repository notes: export-session startup backfill and journal/export tooling changes present in today's work.
- Important files: .opencode/plugins/export-session.ts, .opencode/commands/update-today-memory.md, memory/today.md
</example>
