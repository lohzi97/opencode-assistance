---
name: openspec-review-proposal
description: Review a change proposal against the codebase, clarify requirements, and update proposal files. Use when the user wants to verify a proposal is valid, feasible, and has sufficient information before implementation.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.1.1"
---

Review an OpenSpec change proposal against the codebase to verify it's valid, feasible, and has sufficient information for implementation. This is a review and clarification phase—do NOT write any implementation code.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Reviewing proposal: <name>" and how to override.

2. **Check status to understand the schema**

   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifacts exist for this change

3. **Read proposal files**

   Use the CLI to get context files:

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   Read all available artifacts from `contextFiles`:
   - `proposal.md` (if present)
   - `tasks.md` (if present)
   - Any spec deltas in `openspec/changes/<name>/specs/**/*.md`
   - `design.md` (if present)

4. **Examine the codebase**

   - Read relevant codebase files mentioned in the proposal to understand current implementation
   - Use Glob, Grep, and Read tools to:
     - Find integration points
     - Identify dependencies and side effects
     - Understand existing patterns and conventions
     - Surface hidden complexity

5. **Provide summary analysis of the proposal**

   Display:
   - What the proposal aims to change
   - Current state of the codebase
   - How the proposal would modify the codebase
   - Technical feasibility assessment
   - Any potential issues or concerns

   Use the following structure:

   ```
   ## Proposal Review: <change-name>

   ### What the Proposal Aims to Change
   [summary of proposal intent and scope]

   ### Current State of Codebase
   [description of current implementation]

   ### Proposed Changes
   [description of how codebase would be modified]

   ### Feasibility Assessment
   - **Technical Feasibility:** ✅ Feasible / ⚠️ Concerns / ❌ Not feasible
   - **Dependencies Identified:** [list of dependencies]
   - **Potential Conflicts:** [list of conflicts with existing code]

   ### Issues and Concerns
   [list of any issues or concerns]
   ```

6. **Ask clarifying questions using the AskUserQuestion tool**

   For any ambiguous or unclear details, ask the user using the **AskUserQuestion tool**. Focus on:

   - **Ambiguous requirements**: Requirements that can be interpreted multiple ways
   - **Unclear implementation details**: Technical decisions not specified
   - **Architectural decisions**: High-level choices that need user input
   - **Config defaults or behavior options**: Configuration values, default behaviors, edge case handling
   - **Scope boundaries**: What's in scope vs out of scope
   - **Priority/MVP considerations**: What's essential vs nice-to-have

   Example question structure:

   ```
   **Clarification Needed: <Topic>**

   I noticed [describe the ambiguity or missing information].

   Options:
   - Option 1: [description]
   - Option 2: [description]
   - Option 3: [description]
   - Custom: Type your own answer

   What would you prefer?
   ```

7. **Discuss the proposal with the user**

   - Wait for user responses to clarification questions
   - Discuss any concerns or issues identified
   - Refine requirements based on user feedback
   - Offer alternatives or suggestions if appropriate

8. **Update OpenSpec change proposal files**

   After discussion and clarification, update the relevant files:

   - **proposal.md**: Update with clarified requirements, refined scope, or new decisions
   - **specs/<domain>/spec.md**: Update delta specs with clarified requirements or new scenarios
   - **design.md**: Update with architectural decisions made during discussion
   - **tasks.md**: Update with refined task breakdown or additional tasks identified

   Only update files that need changes. Clearly indicate what was updated and why.

   Example update format:

   ```
   ### Updated proposal.md
   - Added clarification for [requirement X]
   - Refined scope to [new scope description]
   - Updated approach to [new approach]

   ### Updated specs/auth/spec.md
   - Added scenario for [new scenario]
   - Clarified requirement [requirement Y]

   ### Updated design.md
   - Added decision: [decision description]
   - Updated architecture: [architecture change]
   ```

9. **Confirm proposal readiness**

   Provide a final assessment:

   ```
   ## Proposal Review Complete

   ### Status
   ✅ Ready for implementation / ⚠️ Remaining issues / ❌ Needs more work

   ### Summary
   - Total clarifications resolved: N
   - Files updated: [list of updated files]
   - Remaining concerns: [list of any remaining concerns]

   ### Next Steps
   If ready for implementation:
   → Run openspec-ff-change to create all planning artifacts (if not already created)
   → Or run openspec-apply-change to start implementation (if artifacts exist)

   If more work needed:
   → Address remaining concerns
   → Run openspec-review-proposal again when ready
   ```

**Guardrails**

- **This is a review and clarification phase** - do NOT write any implementation code
- Focus on understanding requirements, identifying gaps, and ensuring proposal aligns with the codebase
- Identify any vague or ambiguous details and ask necessary follow-up questions
- Use the **AskUserQuestion tool** for all clarifications—don't assume or guess
- Only update proposal files after receiving user clarification
- Keep changes scoped to clarifying and refining the proposal—not rewriting it entirely

**Fluid Workflow Integration**

This skill supports the "review before implement" workflow:

- **Can be invoked anytime**: After creating a proposal, before implementation starts, or when re-evaluating a change
- **Enables collaborative refinement**: Uses AskUserQuestion tool to get user input on ambiguous requirements
- **Supports proposal iteration**: Updates proposal files based on clarified user requirements
- **Prevents implementation of unclear specs**: Catches gaps and ambiguities before code is written
- **Not phase-locked**: Can be invoked multiple times as requirements evolve

**Output Format**

Use clear markdown with structured sections:

```
## Proposal Review: <change-name>

### What the Proposal Aims to Change
[summary]

### Current State of Codebase
[description with file references]

### Proposed Changes
[description with file references]

### Feasibility Assessment

**Technical Feasibility:** ✅ Feasible / ⚠️ Concerns / ❌ Not feasible

**Dependencies Identified:**
- [dependency 1] → [file:line]
- [dependency 2] → [file:line]

**Potential Conflicts:**
- [conflict 1] → [file:line]
- [conflict 2] → [file:line]

### Issues and Concerns

**Critical Issues:**
- [issue description] → [file:line]
- [issue description] → [file:line]

**Warnings:**
- [warning description] → [file:line]
- [warning description] → [file:line]

**Suggestions:**
- [suggestion] → [file:line]
- [suggestion] → [file:line]

### Clarifications Needed

**1. <Topic>**
[description of ambiguity]

**2. <Topic>**
[description of ambiguity]

[Await user responses using AskUserQuestion tool]

---

## Discussion Summary

[Summary of discussion and decisions made]

### Updated Files

**proposal.md:**
- [change 1]
- [change 2]

**specs/<domain>/spec.md:**
- [change 1]
- [change 2]

**design.md:**
- [change 1]
- [change 2]

---

## Proposal Review Complete

### Status
✅ Ready for implementation / ⚠️ Remaining issues / ❌ Needs more work

### Summary
- Total clarifications resolved: N
- Files updated: proposal.md, specs/auth/spec.md
- Remaining concerns: None / [list concerns]

### Next Steps
→ Run openspec-ff-change to create all planning artifacts
→ Or run openspec-apply-change to start implementation (if artifacts already exist)
```
