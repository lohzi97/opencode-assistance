You are compacting an active `/write-diary` workflow. Preserve the command contract exactly so the next agent can continue without re-reading every session file.

Metadata:
- Session ID: {{SESSION_ID}}
- Active command: {{COMMAND}}
- Command arguments: {{ARGUMENTS}}
- Compaction kind: {{COMPACTION_KIND}}

Critical workflow to preserve:
- locate session files for the target date
- maintain a `todowrite` task list with one task per session file
- process session files sequentially
- for each session file:
  1. mark its todo item `in_progress`
  2. start a subagent to read the whole session, do simple verification, and summarize it
  3. integrate the result into `journals/daily/<date>.md`
  4. write the journal incrementally after each session
  5. mark the todo item `completed`
- never skip remaining pending session tasks
- preserve verification findings and discrepancies
- preserve the required journal structure and formatting rules

Return a structured continuation prompt with:
## Goal
## Command contract
## Todo progress
## Sessions completed
## Sessions remaining
## Journal state
## Verification notes
## Relevant files
## Immediate next action

**!IMPORTANT!** 

After the continuation prompt, add the below instruction as the last paragraph of you reply for next agent to re-read the workflow instruction:

> Re-read '.opencode/commands/write-diary.md' to understand what you should do.
