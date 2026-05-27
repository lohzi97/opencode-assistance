---
description: Align proposal with completed implementation after testing
---

Align an OpenSpec change proposal with the actual completed implementation in the codebase.

Use this after implementing and testing a change, when the implementation differs from the original proposal. The command will identify discrepancies and update the proposal to accurately reflect what was actually built.

**Input**: Optionally specify a change name after `/opsx:align` (e.g., `/opsx:align add-auth`). If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **If no change name provided, prompt for selection**

   Run `openspec list --json` to get available changes. Use the **AskUserQuestion tool** to let the user select.

   Show changes that have implementation (tasks artifact exists).

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check status to understand the schema**

   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifacts exist for this change

3. **Get the change directory and load proposal artifacts**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns the change directory and context files. Read all available artifacts from `contextFiles`:
   - `proposal.md` (if present)
   - `tasks.md` (if present)
   - `design.md` (if present)
   - Any spec deltas in `openspec/changes/<name>/specs/**/*.md`

4. **Analyze the proposal to understand intended changes**

   Extract from the proposal:

   **From proposal.md:**
   - "Why" section: What problem are we solving?
   - "What Changes" section: What was supposed to change?
   - "Impact" section: What files/services were supposed to be modified?
   - "Capabilities" section: What new/modified capabilities were proposed?

   **From design.md:**
   - Goals/Non-Goals: What were the stated objectives and exclusions?
   - Decisions: What technical decisions were made?
   - Context: What's the background context?

   **From specs/**:
   - Requirements: What requirements were specified?
   - Scenarios: What scenarios were expected?

   **From tasks.md**:
   - Tasks: What implementation steps were planned?

5. **Examine the codebase to understand actual implementation**

   Use Glob, Grep, and Read tools to:

   - Find the files mentioned in the proposal's "Impact" section
   - Search for the capability names mentioned in the proposal
   - Look for new services, classes, or methods related to the change
   - Check if dependencies mentioned in the design are actually used
   - Verify that architecture decisions from design.md are reflected in code
   - Look for implementation patterns that differ from the proposal

   For each impacted file mentioned in the proposal:
   - Read the file to understand actual implementation
   - Compare with what the proposal stated
   - Note any divergences (omissions, additions, different approaches)

6. **Identify discrepancies between proposal and implementation**

   Create a list of discrepancies organized by type:

   **Implementation Differences:**
   - Code that was implemented but not mentioned in proposal
   - Code mentioned in proposal but not implemented
   - Different approaches than what was proposed
   - Different dependencies or services used

   **Architecture/Design Differences:**
   - Different services injected or used
   - Different patterns or architectural decisions
   - Different component/file structure

   **Behavior Differences:**
   - Different edge case handling
   - Different default behaviors
   - Different error handling

   **Capability/Scope Differences:**
   - Features implemented but not in proposal
   - Features in proposal but not implemented
   - Different capability descriptions

7. **Ask clarifying questions for significant discrepancies**

   For any significant differences that aren't obvious improvements, use the **AskUserQuestion tool** to clarify:

   Focus on:
   - **Implementation omissions**: Why was something proposed but not implemented?
   - **Implementation additions**: Why was something added that wasn't proposed?
   - **Different approaches**: Why was a different approach taken?
   - **Scope changes**: Was the scope intentionally expanded or contracted?

   Example question structure:

   ```
   **Discrepancy Found: <Topic>**

   The proposal states [what was proposed], but the implementation does [what was actually done].

   Why was this approach taken?

   Options:
   - Proposal was incorrect/outdated - update to match implementation
   - Implementation is incorrect - fix to match proposal
   - Technical limitation prevented proposed approach - document rationale
   - Intentional design decision - update proposal with rationale
   - Custom: Type your own answer
   ```

   Wait for user responses before proceeding to updates.

8. **Update proposal artifacts to align with implementation**

   Based on discrepancies identified and user feedback, update the relevant files:

   **proposal.md updates:**
   - Update "Why" if the problem statement changed
   - Update "What Changes" to reflect actual implementation
   - Update "Impact" section with actual files modified
   - Update "Capabilities" section with accurate descriptions

   **design.md updates:**
   - Update Context if background changed
   - Update Goals/Non-Goals if scope changed
   - Update Decisions section with actual decisions made (add rationale for deviations)
   - Update Risks/Trade-offs if new risks emerged or old ones were resolved

   **tasks.md updates:**
   - Update tasks to reflect what was actually done
   - Update completion status (check boxes)
   - Add any tasks that were done but not in the original list

   **specs/<domain>/spec.md updates:**
   - Update requirements to match actual implementation
   - Add new requirements for features that were implemented but not specified
   - Remove or modify requirements that weren't implemented
   - Update scenarios to reflect actual behavior

   Clearly indicate what was updated and why.

9. **Show alignment summary**

   Provide a summary of the alignment:

   ```
   ## Proposal Aligned: <change-name>

   ### Discrepancies Found
   - X implementation differences identified
   - Y architecture/design differences identified
   - Z behavior differences identified

   ### User Clarifications Resolved
   - N clarification questions asked and resolved

   ### Files Updated

   **proposal.md:**
   - Updated "What Changes" to reflect [actual implementation]
   - Updated "Impact" to include [additional files]
   - Updated capabilities description for [capability]

   **design.md:**
   - Added decision: [new decision with rationale]
   - Updated approach: [actual approach vs proposed]
   - Removed outdated decision: [decision that wasn't followed]

   **tasks.md:**
   - Updated task status to complete
   - Added task: [task that was done but not listed]

   **specs/<domain>/spec.md:**
   - Added requirement: [new requirement]
   - Modified requirement: [requirement with updated behavior]
   - Added scenario: [new scenario]

   ### Alignment Status
   ✅ Proposal now accurately reflects the completed implementation

   The proposal has been updated to match the actual implementation in the codebase.
   ```

**Guardrails**

- **This is an alignment phase** - do NOT write or modify implementation code
- Focus on updating documentation to match reality, not changing implementation
- Always ask the user before making significant proposal updates
- Preserve the rationale for why deviations occurred (add to design decisions)
- If uncertain about a discrepancy, ask the user rather than assume
- Keep changes focused on accuracy - don't rewrite the entire proposal unless necessary

**Key Principles**

- **Truth over fiction**: Update documentation to reflect what actually exists
- **Rationale preservation**: Document why implementation differs from proposal
- **User-driven**: Use user feedback to understand intent behind changes
- **Incremental updates**: Make targeted changes rather than wholesale rewrites

**Output Format**

Use clear markdown with structured sections:

```
## Proposal Alignment: <change-name>

### Proposal Intent
[Summary of what the proposal aimed to do]

### Implementation Reality
[Summary of what was actually implemented]

### Discrepancies Identified

**Implementation Differences:**
- [difference 1] → [file:line]
- [difference 2] → [file:line]

**Architecture/Design Differences:**
- [difference 1]
- [difference 2]

**Behavior Differences:**
- [difference 1]
- [difference 2]

**Capability/Scope Differences:**
- [difference 1]
- [difference 2]

### Clarification Questions

**1. <Discrepancy topic>**
[Description of discrepancy]

[Use AskUserQuestion tool to get user input]

---

## Alignment Summary

### User Clarifications Resolved
- [clarification 1]: [resolution]
- [clarification 2]: [resolution]

### Files Updated

**proposal.md:**
- [change 1]
- [change 2]

**design.md:**
- [change 1]
- [change 2]

**tasks.md:**
- [change 1]

**specs/<domain>/spec.md:**
- [change 1]
- [change 2]

---

## Proposal Aligned: <change-name>

### Discrepancies Found
- X total discrepancies identified
- Y clarification questions asked

### Alignment Status
✅ Proposal now accurately reflects the completed implementation
```
