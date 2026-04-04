---
description: Generate a daily journal diary from session conversation history
---

Create a daily journal diary for date $1 (format: YYYYMMDD). If no date provided, use today's date.

Follow this workflow:

1. Locate session files
   - Find all files in `journals/session/` matching the date pattern `$1*`.

2. Read sessions
   - Read each session file in full, including frontmatter metadata (session-id, created, updated, exported) and the conversation body.

3. Critical verification (must do)
   - For every file, directory, command, process, or path mentioned in the conversations, verify its existence on the filesystem.
   - Record existence as `exists` or `missing` and surface any mismatches in the "Notes" section.

4. Diary format (STRICT)
   - Title: `# Daily Journal - <Month> <DD>, <YYYY>` (full month name)
   - `## Session Overview`: 1-2 sentence summary (number of sessions and main themes)
   - `## Key Activities`: a chronological list of sessions. For each session include a subheading and bullets:
     - Subheading format: `### Session N (HH:MM - HH:MM TZ)` where times are derived from session `created` and `updated` metadata. If only one timestamp is available use a single time in parentheses; if no timestamps, omit the parentheses.
     - Under each session include concise bullet points summarizing user requests, assistant actions, tools used, and outcomes. Preserve any verbatim content (commit messages, commands, JSON) in fenced code blocks and label them (e.g., "Suggested commit message").
   - `## Technical Accomplishments`: numbered list grouped by category (Infrastructure, Workflow, Tools, Git Workflow, etc.). For each item note whether it was verified (e.g., file created, process launched, suggestion only).
   - `## Notes`: bullet list including:
     - Files/paths checked and verification results (path: exists/missing)
     - Any discrepancies between session claims and filesystem state (explicitly name the file/path)
     - Persona or preference details that affect future interactions
     - Any conservative actions taken (e.g., no terminals closed)
   - After the Notes section add a single line recording the diary written datetime in ISO 8601 UTC format, prefixed with `Generated:`. Example: `Generated: 2026-04-04T12:52:58Z`. This line is required for every diary and is part of the verification notes.

5. Writing the file
   - Write the diary to `journals/daily/$1.md` using the exact Markdown structure above.
   - If the file exists, overwrite it.

Formatting and style rules
   - Keep the diary concise but comprehensive and focused on actual accomplishments and outcomes.
   - Use a direct, factual tone consistent with existing daily journals.
   - Do NOT include a "Next Steps" section.
   - Use fenced code blocks only for verbatim content (commands, commit messages, JSON).

Examples and fallbacks
   - If a session produced a commit message, include it verbatim in a fenced code block with the label "Suggested commit message" and mark if it was not committed.
   - If timestamps cannot be converted to local time, display the ISO timestamp from the session metadata in parentheses.
   - When reporting filesystem checks, include both path and result (e.g., `/path/to/file: exists`).

Example invocation: `/write-diary YYYYMMDD`
