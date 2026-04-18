Metadata:
- Session ID: {{SESSION_ID}}
- Active command: {{COMMAND}}
- Command arguments: {{ARGUMENTS}}
- Compaction kind: {{COMPACTION_KIND}}

You are compacting an active `/write-diary` workflow. 

Prepare a handoff brief for the next agent to continue to workflow. The brief MUST include:

- The write-diary workflow instruction
- What has already been done
- Which step of the workflow we are currently in
- What is the next to-do

In the end of the brief, mention that the next agent must re-read '.opencode/commands/write-diary.md' again to fully understand the workflow, and then IMMEDIATELY continue with the workflow without asking for permission.
