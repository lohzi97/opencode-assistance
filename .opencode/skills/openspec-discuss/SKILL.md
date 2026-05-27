---
name: openspec-discuss
description: Read through proposal documents and prepare for an informed discussion about a change. Use when the user wants to discuss a change before implementing, review a proposal, or understand the context and codebase implications.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.1.1"
---

Read all proposal artifacts for an OpenSpec change, explore the relevant codebase, and present a summary of understanding so you're ready for an interactive discussion.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Preparing discussion for: <name>" and how to override.

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
   - `design.md` (if present)
   - `tasks.md` (if present)
   - Any spec deltas in `openspec/changes/<name>/specs/**/*.md`

4. **Explore the codebase for context**

   Use Glob, Grep, and Read tools to:
   - Find files and modules mentioned in the proposal
   - Understand the current implementation of affected areas
   - Identify existing patterns and conventions relevant to the change
   - Locate integration points and dependencies
   - Surface any hidden complexity that may be relevant to the discussion

   Focus on building a thorough mental model of:
   - How the current code works in areas the proposal touches
   - What conventions and patterns are established
   - What dependencies and side effects exist

5. **Present your understanding**

   Display a structured summary:

   ```
   ## Discussion Ready: <change-name>

   ### Proposal Summary
   [concise summary of what the proposal aims to do and why]

   ### Design Decisions
   [key architectural and technical decisions from design.md]

   ### Spec Requirements
   [list of requirements from specs, grouped by domain if multiple]

   ### Task Breakdown
   [summary of planned implementation tasks and their status]

   ### Current Codebase Context
   [what you found in the codebase that's relevant — files, patterns, existing implementations]

   ### Key Observations
   - [notable finding 1 — e.g., "Module X already handles similar logic in file:line"]
   - [notable finding 2 — e.g., "The proposal extends pattern Y established in file:line"]
   - [notable finding 3 — e.g., "Dependency Z at file:line may need updating"]

   ---
   Ready for discussion. What would you like to explore?
   ```

6. **Await user input for discussion**

   After presenting the summary, wait for the user to ask questions, propose changes, or steer the conversation. This is an open-ended discussion phase — be responsive and refer back to the artifacts and codebase knowledge you've gathered.

   During discussion:
   - Answer questions about the proposal, design, specs, or tasks
   - Look up additional codebase details on demand
   - Suggest alternatives or trade-offs when relevant
   - Flag potential issues or concerns
   - Reference specific files and line numbers to ground the discussion

**Guardrails**

- **This is a discussion and understanding phase** — do NOT write any implementation code or modify proposal files unless the user explicitly asks
- Focus on reading, understanding, and explaining — not on making changes
- Build thorough codebase context before the summary so you can answer follow-up questions accurately
- Keep the summary concise but complete enough for informed discussion
- If the user asks you to update proposal files during discussion, clarify intent before making changes
- Use contextFiles from CLI output, don't assume specific file names

**Fluid Workflow Integration**

This skill supports the "discuss before deciding" workflow:

- **Can be invoked anytime**: After creating a proposal, after review, during implementation, or when revisiting a change
- **Low-commitment exploration**: No side effects — purely reads and summarizes
- **Supports iterative discussion**: Stay in the conversation as long as the user wants
- **Bridges to other skills**: After discussion, the user may want to run openspec-review-proposal, openspec-apply-resume, openspec-align, etc.