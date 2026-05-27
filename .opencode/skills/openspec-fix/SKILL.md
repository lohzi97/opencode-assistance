---
name: openspec-fix
description: Fix issues with an in-progress OpenSpec change implementation. Use when the user wants to fix runtime errors, compile errors, logic bugs, or other issues with an ongoing implementation.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.1.1"
---

Fix issues with an in-progress OpenSpec change implementation through iterative problem-solving.

**Input**: Two arguments are required:
1. Change name (e.g., `macos-incoming-call-notification`)
2. Detailed description of the issue (can include error messages, unexpected behavior, logs, etc.)

**Steps**

1. **Validate and load change**

   If change name is not provided or cannot be inferred:
   - Run `openspec list --json` to get available changes
   - Use **AskUserQuestion tool** to let the user select which change to fix

   Once change name is confirmed:
   ```bash
   openspec status --change "<name>" --json
   openspec instructions apply --change "<name>" --json
   ```

   Read all context files from `contextFiles` output to understand the change:
   - proposal.md - understand the "why" and "what"
   - design.md - understand decisions and approach
   - specs/**/*.md - understand requirements
   - tasks.md - see what's been implemented

   Always announce: "Fixing change: <name>" and summarize the issue being addressed.

2. **Analyze the issue**

   Parse the user's issue description to understand:
   - **Type of issue**: Runtime error, compile error, logic bug, performance issue, design flaw, etc.
   - **Error messages**: Extract any stack traces or error codes
   - **Symptoms**: What's happening vs what should happen
   - **Context**: When does this occur? What state is the system in?

   Categorize the issue:
   - 🔴 **Critical**: System crash, data loss, security vulnerability, blocking feature
   - 🟡 **Warning**: Incorrect behavior, poor performance, edge case failure
   - 🔵 **Info**: Style issue, non-optimal implementation, enhancement opportunity

3. **Scan codebase to locate root cause**

   Based on the issue type and context files, investigate:

   **For runtime errors**:
   - Parse stack trace to identify failing function/method
   - Read the file and line number where error occurs
   - Check for: null safety violations, type mismatches, API misuse, missing error handling
   - Look at related code that calls the failing function

   **For compile errors**:
   - Identify missing imports, type errors, syntax issues
   - Check dependencies and versions if relevant
   - Verify code follows language/framework patterns

   **For logic bugs**:
   - Trace the expected flow from specs/design
   - Compare with actual implementation
   - Look for: off-by-one errors, incorrect conditionals, missing state updates
   - Check related tests for expectations

   **For API integration issues**:
   - Review API documentation (via comments or external docs)
   - Check parameter types, return values, error handling
   - Verify payload/serialization matches expectations

   **For platform-specific issues** (macOS, Windows, iOS, etc.):
   - Check platform detection logic (`isMacOS`, `isWindows`, etc.)
   - Review platform-specific conditional branches
   - Compare with working implementation on other platforms

   Use these tools effectively:
   - `Grep` - find related code patterns, API calls, variable names
   - `Glob` - locate all files in relevant directories
   - `Read` - understand full context of problematic code
   - `Bash` - check logs, run tests, validate configurations

4. **Propose solution(s)**

   Present 1-3 solution options with trade-offs:

   **Format:**
   ```
   ## Issue Analysis

   **Root Cause**: [clear explanation of what's wrong and why]

   **Impact**: [what functionality is affected, severity]

   ## Proposed Solutions

   ### Option 1: [Solution Name] (Recommended)

   **Approach**: [brief description]

   **Pros**:
   - [list 2-3 pros]

   **Cons**:
   - [list 1-2 cons]

   **Changes Required**:
   - [file:line] - [what to change]
   - [file:line] - [what to change]

   ### Option 2: [Alternative Approach]

   [same structure as above]
   ```

   Include file paths and line numbers for all proposed changes.

   **Recommendation strategy**:
   - If obvious fix exists: present 1 recommended solution with explanation
   - If multiple valid approaches: present 2-3 with trade-off comparison
   - If unclear: ask for user preference before implementing

5. **Implement the solution**

   Once user confirms which solution to implement (or if I recommended one):

   **Before changing**:
   - Create a mental or written summary of what will change
   - Verify understanding with user if changes are significant

   **Make the changes**:
   - Use `Edit` tool to modify existing code
   - Use `Write` tool if new files are needed
   - Keep changes minimal and focused on the fix
   - Maintain existing code style and patterns
   - Add comments only if the fix is complex or non-obvious

   **After each change**:
   - Verify syntax is correct
   - Check if related code needs updates
   - Look for ripple effects (other code calling the changed function)

6. **Validate the fix**

   **Static analysis** (project-specific):
   ```bash
   # Flutter
   fvm flutter analyze

   # Node.js/TypeScript
   eslint <files>
   tsc --noEmit

   # Python
   ruff check <files>
   mypy <files>

   # Or other project-specific linters
   ```

   **OpenSpec validation**:
   ```bash
   openspec validate <name> --strict
   ```

   **If tests exist**:
   ```bash
   # Run relevant tests
   fvm flutter test test/services/notification_service_test.dart
   ```

   Report validation results:
   - ✅ All checks passed
   - ⚠️ New issues found (and fix them before proceeding)
   - ℹ️ Suggestions (can address after main fix)

7. **Iterate on user feedback**

   **If user reports issues**:
   - Acknowledge the problem
   - Re-analyze the root cause
   - Propose alternative approach if needed
   - Implement the adjustment
   - Re-validate

   **If user requests changes**:
   - Clarify what they want different
   - Adjust the implementation
   - Validate again
   - Confirm the fix meets their expectations

   **If user is satisfied**:
   - Mark the fix as complete
   - Summarize what was changed
   - Suggest next steps (e.g., manual testing, continue to next task)

8. **Update tasks.md if needed**

   If the fix completes an unimplemented task:
   - Mark the task as complete: `- [ ]` → `- [x]`
   - Add a note explaining the fix if the task had blockers

   Example:
   ```markdown
   - [x] 1.2 Add macOS notification handling (Fixed: 64-bit handleId to 32-bit ID mapping issue)
   ```

9. **Provide final summary**

   **Format:**
   ```
   ## Fix Complete: <change-name>

   **Issue**: [original issue description]

   **Root Cause**: [what was wrong]

   **Solution Applied**: [brief description of the fix]

   **Files Modified**:
   - [file:line] - [change description]
   - [file:line] - [change description]

   **Validation**:
   - ✅ Static analysis: passed
   - ✅ OpenSpec validation: passed
   - ✅ Tests: passed (if applicable)

   **Next Steps**:
   - Manual testing recommended
   - Consider running openspec-verify-change before archiving
   - [other relevant suggestions]
   ```

**Guardrails**

- **Understand before fixing**: Always read proposal, design, specs, and tasks before making changes
- **Minimal changes**: Only fix what's broken—don't refactor or enhance beyond the fix
- **Validate before declaring done**: Always run static analysis and OpenSpec validation
- **Iterate with user**: Don't assume the first fix is perfect—accept feedback and adjust
- **Keep artifacts in sync**: If the fix reveals a spec or design issue, suggest updating artifacts
- **Test if possible**: Run tests to ensure fix doesn't break existing functionality
- **Document clearly**: Use file:line format, explain why changes are needed
- **Ask when unsure**: If the issue is ambiguous or has multiple valid solutions, propose and ask user to choose

**When to Use This Skill**

- Runtime errors during testing
- Compile errors after implementation
- Logic bugs where behavior doesn't match specs
- API integration issues
- Platform-specific bugs
- Performance issues
- Edge case failures

**When NOT to Use This Skill**

- Vague exploration (use openspec-explore)
- Starting a new change (use openspec-new-change or openspec-ff-change)
- Reviewing implementation before archiving (use openspec-verify-change)
- Resuming implementation after partial work (use openspec-apply-resume)

**Output Format**

Use clear markdown with sections:

```
## Fixing Change: <change-name>

### Issue Summary

**Description**: [user's issue description]
**Category**: 🔴 Critical / 🟡 Warning / 🔵 Info
**Files Mentioned**: [any files from issue description]

### Analysis

**Root Cause**: [what's causing the problem]

**Evidence**:
- Error: [error message if any]
- Stack trace: [key frames if any]
- Related code: [file:line references]

### Proposed Solutions

[Present solution options with trade-offs]

### Implementation

[Show what was changed, file by file]

### Validation

**Static Analysis**: [results]
**OpenSpec Validation**: [results]
**Tests**: [results if applicable]

### Summary

**Fixed**: [what was resolved]
**Files Modified**: [list of changes]
**Next Steps**: [recommendations]
```
