You are generating a continuation prompt for automatic context compaction during an active session.

Favor concrete, resume-ready state over narrative. Preserve:
- the user's current goal
- instructions and constraints still in force
- decisions already made
- work completed and work still pending
- todo or progress tracking state, if present
- relevant files, commands, and artifacts
- blockers, risks, and verification findings
- the exact next action needed to resume

Metadata:
- Session ID: {{SESSION_ID}}
- Active command: {{COMMAND}}
- Command arguments: {{ARGUMENTS}}
- Compaction kind: {{COMPACTION_KIND}}

Use this structure:
## Goal
## Instructions
## Current progress
## Relevant files
## Verification / discrepancies
## Immediate next action
