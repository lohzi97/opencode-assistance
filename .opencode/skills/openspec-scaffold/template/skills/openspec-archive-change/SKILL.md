---
name: openspec-archive-change
description: Archive a completed change in the experimental workflow. Use when the user wants to finalize and archive a change after implementation is complete.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.2.0"
---

Archive a completed change in the experimental workflow.

This workflow is allowed to update main specs before archiving, but it MUST NOT sync delta specs blindly by capability folder name. Before changing `openspec/specs/`, run the architectural sync gate below and use [ARCHIVE_SYNC_RUBRIC.md](ARCHIVE_SYNC_RUBRIC.md) for placement decisions.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `openspec list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

   Show only active changes (not already archived).
   Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check artifact completion status**

   Run `openspec status --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `artifacts`: List of artifacts with their status (`done` or other)

   **If any artifacts are not `done`:**
   - Display warning listing incomplete artifacts
   - Use **AskUserQuestion tool** to confirm user wants to proceed
   - Proceed if user confirms

3. **Check task completion status**

   Read the tasks file (typically `tasks.md`) to check for incomplete tasks.

   Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete).

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Use **AskUserQuestion tool** to confirm user wants to proceed
   - Proceed if user confirms

   **If no tasks file exists:** Proceed without task-related warning.

4. **Run architectural sync gate**

   Check for delta specs at `openspec/changes/<name>/specs/`. If none exist, proceed without sync prompt.

   **If delta specs exist:**
   - Read every delta spec under `openspec/changes/<name>/specs/**/*.md`
   - Read existing main specs under `openspec/specs/*/spec.md`
   - Decide whether each delta should CREATE a new main spec, MERGE into an existing main spec, UPDATE an existing requirement, or SPLIT across destinations
   - Do not assume `openspec/changes/<name>/specs/<capability>/` is the correct destination
   - Apply the rubric in [ARCHIVE_SYNC_RUBRIC.md](ARCHIVE_SYNC_RUBRIC.md)
   - Inspect destination files for heading collisions and stale modified targets before editing

   **Before mutating specs, present this proposal and ask for confirmation:**

   ```markdown
   ### Architectural Sync Proposal

   1. **Change Summary:** <brief behavior summary>
   2. **Target Domains Evaluated:** <existing specs inspected>
   3. **Decision:** <CREATE / MERGE / UPDATE / SPLIT>
   4. **Destination:** <openspec/specs/.../spec.md>
   5. **Risks:** <heading collisions, stale modified targets, split requirements, external dependencies>
   ```

   **Prompt options:**
   - If changes needed: "Sync now (recommended)", "Archive without syncing"
   - If already synced: "Archive now", "Sync anyway", "Cancel"

   If user chooses sync, update the chosen main spec files from the confirmed architectural sync proposal before archiving.

   After syncing, run:
   ```bash
   openspec validate --all
   ```

   If validation fails, stop and report the failing items. Do not archive until validation passes or the user explicitly decides to archive without a valid spec tree.

5. **Perform the archive**

   Create the archive directory if it doesn't exist:
   ```bash
   mkdir -p openspec/changes/archive
   ```

   Generate target name using current date: `YYYY-MM-DD-<change-name>`

   **Check if target already exists:**
   - If yes: Fail with error, suggest renaming existing archive or using different date
   - If no: Move the change directory to archive

   ```bash
   mv openspec/changes/<name> openspec/changes/archive/YYYY-MM-DD-<name>
   ```

6. **Validate and display summary**

   After moving the change to archive, run:
   ```bash
   openspec validate --all
   ```

   If validation fails after archive, report it clearly in the summary.

   Show archive completion summary including:
   - Change name
   - Schema that was used
   - Archive location
   - Whether specs were synced (if applicable)
   - Which main spec destinations were created or modified
   - Note about any warnings (incomplete artifacts/tasks)

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs (or "No delta specs" or "Sync skipped")

All artifacts complete. All tasks complete.
```

**Guardrails**
- Always prompt for change selection if not provided
- Use artifact graph (openspec status --json) for completion checking
- Don't block archive on warnings - just inform and confirm
- Preserve .openspec.yaml when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If delta specs exist, always run the architectural sync gate before prompting
- Never assume delta capability name equals main spec destination
- If sync is requested, update main specs only according to the confirmed Architectural Sync Proposal
- Never leave delta headers such as `## ADDED Requirements` in a main spec; main specs require `## Purpose` and `## Requirements`
- If a destination already has the same requirement heading, merge or refactor instead of duplicating it
- If a `## MODIFIED Requirements` target cannot be found, stop and flag a structural sync conflict
