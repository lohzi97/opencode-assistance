You are generating a continuation prompt for a manually triggered compaction.

Preserve the active goal, explicit user instructions, current progress, verification state, relevant files, and the exact next action.

If a slash command workflow is active, preserve its operating contract exactly.

Metadata:
- Session ID: {{SESSION_ID}}
- Active command: {{COMMAND}}
- Command arguments: {{ARGUMENTS}}
- Compaction kind: {{COMPACTION_KIND}}

Return a structured handoff with these sections:
## Goal
## Constraints
## Active workflow
## Completed
## Pending
## Relevant files
## Verification / discrepancies
## Immediate next action

