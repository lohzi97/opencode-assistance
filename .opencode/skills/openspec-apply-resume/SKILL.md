---
name: openspec-apply-resume
description: Review implementation status, run validations, fix issues, and continue applying remaining tasks. Use when the user wants to resume implementation after partial work, fix validation issues, or continue with remaining tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.1.1"
---

Review an in-progress OpenSpec change implementation, run static analysis and validation checks, fix any issues found, and continue applying remaining tasks.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Resuming change: <name>" and how to override.

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)
   - Which artifacts exist for this change

3. **Get context and instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - Context file paths (varies by schema)
   - Progress (total, complete, remaining)
   - Task list with status

   **Handle states:**
   - If `state: "blocked"` (missing artifacts): show message, suggest using openspec-continue-change
   - If `state: "all_done"`: congratulate, suggest running openspec-verify-change then archive
   - Otherwise: proceed to review and implementation

4. **Read context files**

   Read all files listed in `contextFiles` from the apply instructions output.
   The files depend on the schema being used:
   - **spec-driven**: proposal, specs, design, tasks
   - Other schemas: follow the contextFiles from CLI output

5. **Examine the codebase to verify current implementation status**

   - Use Glob and Grep to find files mentioned in the proposal/tasks
   - Read relevant files to understand what has been implemented
   - Check git status to see modified/untracked files
   - Parse the tasks.md to identify which tasks are marked complete vs incomplete

6. **Analyze implementation status and provide a summary**

   Display:
   - What has been done correctly
   - What is incomplete or missing
   - What has been done but has issues (bugs, wrong API usage, etc.)
   - What has been done but can be improved
   - Any deviation from the spec or design

7. **Run validation checks to identify issues**

   **Static Analysis (project-specific):**

   Detect project type and run appropriate static analysis:
   - **Flutter**: `flutter analyze`
   - **Python**: `ruff check`, `mypy`, or `pylint`
   - **Node.js/TypeScript**: `eslint`, `tsc --noEmit`
   - **Go**: `go vet`, `golangci-lint run`
   - **Rust**: `cargo clippy`, `cargo check`
   - **Java**: `mvn compile` or `gradle build` with analysis plugins
   - **Other**: Run any linter configured in the project (check package.json, pyproject.toml, go.mod, Cargo.toml, pom.xml, build.gradle, etc.)

   **OpenSpec Validation:**

   ```bash
   openspec validate <name> --strict
   ```

   Report all issues found with:
   - Issue type (static analysis or spec validation)
   - Severity (error, warning, info)
   - File path and line number (if available)
   - Description of the issue

8. **Fix identified issues**

   For each issue found:
   - Fix code errors, warnings, or bugs
   - Complete any missing implementation
   - Improve suboptimal code (if warranted)

   **Guardrails:**
   - Only write code to fix identified issues or complete remaining tasks
   - Avoid over-engineering or adding features not specified
   - Keep changes tightly scoped to the requested outcome in the proposal

9. **Validate fixes**

   - Re-run the appropriate static analysis command to confirm no new issues
   - Re-run `openspec validate <name> --strict` to confirm compliance

10. **Continue implementing remaining tasks**

    If tasks remain incomplete after fixing issues:
    - Read tasks.md to identify remaining unchecked tasks
    - Implement each remaining task one by one
    - Make code changes required
    - Keep changes minimal and focused
    - Mark each task complete in the tasks file: `- [ ]` → `- [x]`

    **Pause if:**
    - Task is unclear → ask for clarification
    - Implementation reveals a design issue → suggest updating artifacts
    - Error or blocker encountered → report and wait for guidance
    - User interrupts

11. **Update tasks.md**

    After all fixes and remaining tasks are complete:
    - Mark completed tasks as `- [x]`
    - Mark tasks that still need work as `- [ ]`
    - Add notes for any tasks requiring manual testing or documentation

12. **Provide final summary**

    Display:
    - What was fixed or completed in this session
    - Tasks completed this session
    - Overall progress: "N/M tasks complete"
    - Remaining tasks that require manual action (testing, documentation, etc.)
    - If all done: suggest running openspec-verify-change then archive

**Guardrails**

- Keep changes tightly scoped to the requested outcome in the proposal
- Only write code to fix identified issues or complete remaining tasks—avoid over-engineering or adding features not specified
- Always run static analysis appropriate to the project type
- Always run `openspec validate --strict` to confirm spec compliance
- Validate fixes by re-running analysis and validation commands
- Update tasks.md checkboxes after completing each task
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Use contextFiles from CLI output, don't assume specific file names

**Fluid Workflow Integration**

This skill supports the "review and resume" workflow:

- **Can be invoked anytime**: After partial implementation, when validation issues need fixing, or to continue with remaining tasks
- **Supports validation-driven workflow**: Runs static analysis and OpenSpec validation to identify issues before continuing
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts—not phase-locked, work fluidly
- **Tracks progress explicitly**: Updates tasks.md checkboxes and provides detailed progress summaries

**Output Format**

Use clear markdown with sections for each analysis step:

```
## Resuming Change: <change-name> (schema: <schema-name>)

### Implementation Status

**Progress:** N/M tasks complete

✓ What has been done correctly:
- [list of correctly implemented items]

⚠ What is incomplete or missing:
- [list of incomplete items]

⚠ Issues found:
- [list of issues with bugs, wrong API usage, etc.]

💡 What has been done but can be improved:
- [list of improvements]

📝 Deviations from spec or design:
- [list of deviations]

### Validation Checks

**Static Analysis (<project-type>):**
[static analysis output]

**OpenSpec Validation (--strict):**
[openspec validate output]

### Fixes Applied

[Fix 1]
[Fix 2]
...

### Remaining Tasks Implemented

[Task 1]
[Task 2]
...

### Summary

**Completed this session:**
- [x] Fixed: [summary of fixes]
- [x] Implemented: [summary of new implementations]

**Overall progress:** N/M tasks complete

**Remaining manual tasks:**
- [ ] [task description requiring manual action]

All tasks complete! Run openspec-verify-change to validate the implementation, then archive to finalize.
```
