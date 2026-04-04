---
description: Generate a daily journal diary from session conversation history
---

Create a daily journal diary for date $1 (format: YYYYMMDD). If no date provided, use today's date.

# Instruction:

1. Locate session files
   - Find all files in `journals/session/` matching the date pattern `$1*`.

2. For each of the sessions markdown file, start a subagent to:

   1. Read sessions
      - Read each session file in full, including frontmatter metadata (session-id, created, updated, exported) and the conversation body.

   2. Verification
      - For the actual result that yield from the conversation session, perform a simple verification on it to ensure that the result is still valid.
        - Example:
          - Conversation mentioned that xxx file has been created > verify that the file exist
          - Conversation mentioned that it added a git commit > verify that the git commit exist
          - Conversation mentioned that it generated a git commit message but has not committed it > no verification need as it is a chat respond
          - Conversation mentioned that it created an backend app > verify that the created backend app exist and is runable.
          - Conversation mentioned that it did research on yyy topic > no verification needed as it is also chat respond without actual result
   
   3. Summarize session
      - Extract the following data points from the session markdown:
        - Metadata: Start time (from created) and end time (from updated).
        - Core Narrative: Identify the "Original Request" and the "Actions Taken" by the assistant.
        - Tooling: List any tools or MCPs invoked (e.g., bash, computer-control, git).
        - Outcome: Summarize the final state of the conversation (e.g., "File created," "Information provided," or "Error encountered").
      - Self-Reflection (Critique): Analyze the assistant's performance. Identify if the assistant did anything:
        - Wrongly: Incorrect logic, hallucinated files, or misunderstood instructions.
        - Inefficiently: Took 5 steps for a 2-step task, or redundant tool calls.
        - Badly/Lazily: Provided a "to-do" list instead of doing the work, or failed to follow formatting rules.
        - Missed Opportunities: Failed to suggest a better tool or ignored a clear instruction.
      - Categorize all claims into "Accomplishments" (Infrastructure, Workflow, Tools, etc.).
      - Cross-reference with the Verification step (Step 2.2) to tag each accomplishment as:
         - verified: Evidence exists on the filesystem/git history.
         - suggestion only: Claim exists only in chat text/code blocks.
         - partially verified: Some artifacts exist but discrepancies were found.
      - Note any Discrepancies: Explicitly call out the discrepancies if a session claimed the accomplishment but it can't be verified or failed in verificaiton.

4. Write the journal
   - complie all the subagent returned result.
   - Write the journal to `journals/daily/$1.md`.
   - If the file exists, overwrite it.

5. Journal-specific details
   - Journal type title: `Daily Journal`
   - Session subheadings should use times derived from session `created` and `updated` metadata
   - Ensure the `Generated:` line is included at the end of the journal

Example invocation: `/write-diary YYYYMMDD`

---

# Required Journal Structure

Title: `# <Journal Type> - <Journal Start Date>`

Sections:
- `## Overview`: 1-2 sentence summary of main themes and scope
- `## Key Activities`: chronological list with subheadings for each session/activity
- `## Accomplishments`: numbered list grouped by category
- `## Self-Reflection & Improvements`: Bulleted list of critiques from the sessions (Wrong/Lazy/Inefficient behaviors)
- `## Notes`: bullet list for verification results, discrepancies, and important context

## Section Details

### Overview
- Concise summary (1-2 sentences)
- Mention number of sessions/activities and main themes

### Key Activities
- Use subheading format: `### Session N (startDatetime)` (e.g. "### Session N (2026-03-28 22:15:50)")
- Under each session, use concise bullet points covering:
  - Original requests
  - Taken actions
  - Tools used
  - Outcomes

### Accomplishments
- Numbered list grouped by category (Infrastructure, Workflow, Tools, Git Workflow, etc.)
- For each item, note verification status:
  - "verified" if created/executed
  - "suggestion only" if only proposed

### Self-Reflection & Improvements
- This section is critical for self-improvement.
- Use subheadings for specific session numbers if the critique is session-specific.
- Identify specific instances of "laziness"
- Note logic errors or inefficient multi-step processes.

### Notes
- Bullet list including:
  - Files/paths checked with verification results (path: exists/missing)
  - Discrepancies between claims and filesystem state (explicitly name the file/path)
  - Persona or preference details affecting future interactions
  - Conservative actions taken (e.g., no terminals closed)
  - Required: `Generated: <datetime>` line at the end

## Formatting and Style Rules

### Tone
- Direct, factual, and concise
- Maintain consistency with existing journals
- Avoid editorializing or excessive commentary

### Code Content
- Use fenced code blocks ONLY for verbatim content
- Label each code block (e.g., "Suggested commit message", "Command executed")
- Do not put summaries or paraphrased content in code blocks

### What to Include
- Actual accomplishments and outcomes
- Verification results for all filesystem references
- Specific commands, commit messages, and technical details
- Time ranges and metadata when available

### What to Exclude
- "Next Steps" section (never include this)
- Speculative content or plans
- Fluff or filler content
- Repetitive information

## Common Patterns

### Filesystem Checks
When reporting verification:
- Include both path and result
- Format: `/path/to/file: exists` or `/path/to/file: missing`
- Surface any mismatches explicitly in Notes section

### Datetime Handling
- Use YYYY-MM-DD HH:mm:ss datetime format

<example>
# Daily Journal - 20260321

## Overview

This journal covers 9 session activities from 2026-03-21. Main themes: identity/greeting interactions, commit-message generation requests, system-control terminal auditing, and testing of the computer-control MCP (Nemo + System Monitor). The entries below summarize requests, actions taken, tools used, outcomes, and verification results.

## Key Activities

### Session 1 (2026-03-21 00:21:41)
- Original request: Ask current date and time and timezone behaviour.
- Actions taken: Assistant stated environment date (2026-03-21) and explained timezone conventions and available commands to fetch host time.
- Tools used: none (informational).
- Outcome: Provided guidance; no filesystem actions.

### Session 2 (2026-03-21 01:38:55)
- Original request: "Who are you?" (short greeting)
- Actions taken: Assistant responded with persona summary (Roberta / Lead Attache) and offered next steps.
- Tools used: none (informational).
- Outcome: Persona affirmed; no filesystem actions.

### Session 3 (2026-03-21 13:02:14)
- Original request: Casual identity question and then inventory of available tools/agents/MCPs.
- Actions taken: Assistant enumerated local tools (bash, read, glob, grep, apply_patch, task, webfetch, brave-search, chrome-devtools, computer-control, todowrite, multi_tool_use.parallel) and described guardrails.
- Tools used: none to modify filesystem; read of environment context included in message.
- Outcome: Capabilities documented. NOTE: session text stated "Repository status: Not a git repo (is_repo: no)" — see verification notes below.

### Session 4 (2026-03-21 21:22:01)
- Original request: Commit message generator instructions and staged changes commit request.
- Actions taken: Assistant produced a commit-message template and an example output (reported no staged changes in one reply).
- Tools used: bash (simulated checks referenced), but no commit created.
- Outcome: Commit message(s) generated as chat output only (suggestion only; no filesystem/git commit changes verified).

### Session 5 (2026-03-21 21:24:18)
- Original request: Another commit-message generator interaction (staged diff analysis example).
- Actions taken: Assistant produced a candidate commit message (feat/opencode... with bullets).
- Tools used: bash referenced; no commit performed.
- Outcome: Commit message delivered in-chat (suggestion only).

### Session 6 (2026-03-21 21:41:03)
- Original request: Close unused terminal windows (system-control-maid delegation).
- Actions taken: Assistant launched system-control-maid, enumerated terminals and processes, and applied conservative heuristics. Reported no terminals were closed; produced a JSON summary of skipped candidates.
- Tools used: task (system-control-maid), bash commands for process listing and tty checks.
- Outcome: No terminals closed; machine-readable summary produced in the session content. A raw tool-output path was referenced (see Notes verification).

### Session 7 (2026-03-21 21:41:53)
- Original request: Similar terminal cleanup request; more detailed subagent run and outputs.
- Actions taken: Assistant executed multiple bash enumerations and reported the same result (no terminals closed). Provided commands-run list and a JSON report fragment in the session.
- Tools used: bash, read, task.
- Outcome: No terminals closed; JSON summary included in the session body.

### Session 8 (2026-03-21 21:47:51)
- Original request: Test computer-control MCP by opening Nemo in project dir and capture screenshot; later open task manager but keep Nemo focused, then close both.
- Actions taken: Assistant launched Nemo, confirmed window presence via computer-control_list_windows and took a screenshot; then launched GNOME System Monitor, attempted to re-focus the project window (initially focused VS Code by pattern), and then closed the Nemo and System Monitor processes on user instruction.
- Tools used: bash, computer-control_list_windows, computer-control_activate_window, computer-control_take_screenshot.
- Outcome: Assistant reports Nemo and System Monitor were opened and later closed. Screenshot was reported but no persistent screenshot path was left in session metadata.

### Session 9 (2026-03-21 22:34:43)
- Original request: Commit message generator instructions and staged-changes commit task.
- Actions taken: Assistant produced a suggested commit message (feat(opencode): Add computer-control MCP configuration) and provided a suggested git commit command; no commit performed.
- Tools used: bash (simulated checks), no actual git commit.
- Outcome: Commit message as suggestion only.

## Accomplishments

1. Infrastructure
   1. Nemo GUI launched and interacted with (open, focus attempts, screenshot reported) — verified (process observed during verification).  
   2. GNOME System Monitor launched and closed as reported — partially verified (process evidence observed during session; final process state shows variations — see Notes).

2. Workflow / System Control
   1. Enumerated terminal sessions and applied safe heuristics; no terminals were closed — verified (session JSON contains "closed": [] and assistant performed read-only enumeration).  
   2. Produced machine-readable JSON summary of terminal audit — suggestion/summary only (raw tool-output path referenced but file not found on disk).

3. Tools / Git Workflow
   1. Multiple commit message drafts generated for staged-change workflows — suggestion only (no commits were made).  
   2. Verified repository presence in workspace during this check — verified (git rev-parse returned true at verification time).

Each item above indicates verification status: "verified" for checks that were observed on the host, "suggestion only" when the session produced text-only outputs, and "partially verified" where some evidence exists but some artifacts were missing.

## Self-Reflection & Improvements

- Session 4: The assistant was "lazy" by providing a code block for a new Python script but didn't actually use the `write_file` tool to create it. It waited for the user to do it manually.
- Session 7: Inefficiency detected. The assistant ran `ls` three times in the same directory across three turns instead of reading the directory structure once and caching the context.
- General: The assistant occasionally slips out of the requested "concise" tone, providing long conversational filler before executing tools.

## Notes

- Session files checked and read: 9 files under journals/session matching 20260321*: exists and read.
  - journals/session/20260321125258420-ses_2ef6e970dffeh74rU7C8cuhoeW.md: exists
  - journals/session/20260321125258414-ses_2ef70acc0ffeGXl53D1ZKaD7j3.md: exists
  - journals/session/20260321125258408-ses_2f13a4007ffeEYj2e9tb0QsRxa.md: exists
  - journals/session/20260321125258402-ses_2f3abd53bffe2gThc7D25QYPE5.md: exists
  - journals/session/20260321125258398-ses_2f3f28c89ffe22JExMK0fO4oEo.md: exists
  - journals/session/20260321125258391-ses_2ef5e7d33ffeAIBJ9QZhXqYvRq.md: exists
  - journals/session/20260321125258383-ses_2ef5f4076ffe65uLoNqqxDLdL6.md: exists
  - journals/session/20260321125258376-ses_2ef59055bffekaOC7sV7rb1FjB.md: exists
  - journals/session/20260321125258357-ses_2ef2e202bffet4yXbwfZvqU69x.md: exists

- Files/paths checked during verification (path: result):
  - /home/lohzi/.local/share/opencode/tool-output/tool_d10a1d260001oSSRk4tFSJSTmc: missing
  - /home/lohzi/Downloads: no files matched (directory appears empty by glob; no screenshot found)
  - /home/lohzi/Projects/opencode-assistant/memory/days.md: exists
  - /usr/bin/nemo: running (process observed; sample ps output contained a nemo process: pid 132032 at check time)
  - /usr/bin/nemo-desktop: running (pid 6732 observed)
  - /home/lohzi/Projects/opencode-assistant: is inside a git work tree (git rev-parse --is-inside-work-tree returned true)

- Discrepancies and important context:
  - One session (Session 3, 2026-03-21 13:02:14) reported "Repository status: Not a git repo (is_repo: no)" in the assistant's message. A verification run shows the workspace is a git repo (git rev-parse returned true). This is a mismatch between the session claim and the current repository state.
  - Session 8 reported Nemo and System Monitor were closed after the user's instruction. At verification time a /usr/bin/nemo process with an open path argument (/home/lohzi/Projects/opencode-assistant/memory/days.md) was observed. Either Nemo was restarted after the session, or the session closed only a subset of Nemo windows (the assistant noted nemo-desktop may remain). This is noted as a potential timing discrepancy.
  - The terminal-audit subagent referenced a raw output file under /home/lohzi/.local/share/opencode/tool-output/ but that file was not present when checked. The session JSON was embedded in the session markdown (so the summary is preserved), but the external raw tool-output artifact is missing.

- Persona / preferences observed: The assistant uses a formal butler persona and prefers concise, authoritative reporting. The user expects cautious, non-destructive actions (no terminals closed without explicit approval) and explicit verification when actions are performed.

- Conservative actions taken during verification: No terminals were closed. Where files were missing, the assistant did not attempt recovery or destructive changes.

Generated: 2026-04-04 18:28:06
</example>