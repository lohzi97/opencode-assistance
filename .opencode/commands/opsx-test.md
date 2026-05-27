---
description: Test an OpenSpec change end-to-end from proposal requirements using the right manual tester agent, then write a fix.md issue list in the change folder
---

Run end-to-end validation for an OpenSpec proposal and document issues as an actionable issue list.

---

**Input**: The argument after `/opsx-test` is a change name (kebab-case) such as `dialpad-ui-refresh`.

If missing or ambiguous, resolve in this order:
1. Infer from conversation context.
2. If only one active change exists, auto-select it.
3. Otherwise run `openspec list --json` and ask the user to pick one.

Always announce: `Testing OpenSpec change: <name>`.

## Workflow

1. **Load proposal context and implementation context**

   Read the change folder and collect all relevant files:
   - `openspec/changes/<name>/proposal.md`
   - `openspec/changes/<name>/design.md` (if present)
   - `openspec/changes/<name>/tasks.md` (if present)
   - `openspec/changes/<name>/specs/**/*.md` (all spec deltas)
   - any referenced design assets (for example `design/*.png`)

   Also read implementation status from tasks (`[x]` vs `[ ]`) so testing targets completed scope and highlights unfinished scope as risk.

2. **Extract test requirements before launching tester agent**

   Build a requirement checklist from specs/proposal/design:
   - functional behaviors
   - UI conformance requirements (layout, colors, typography, icon shapes, spacing)
   - platform/scope boundaries (iOS only, web only, etc.)
   - edge/error states explicitly mentioned

   Convert vague statements into concrete checks with expected outcomes.

3. **Choose the correct tester subagent**

   You have access to `xxx_manual_tester` and `manual_tester` agent(s). Agent availability varies from project to project.

   Pick one or more tester agents based on proposal scope. For example:
   - iOS/mobile iPhone scope -> `ios_manual_tester`
   - Android scope -> `android_manual_tester`
   - web/browser scope -> `browser_manual_tester`

   If scope includes multiple platforms, run relevant tester agents and combine findings.

   If a required tester agent is unavailable in the current environment, use the generic `manual_tester`.

4. **Launch tester agent with full context**

   The tester prompt MUST include:
   - change name
   - requirement checklist to validate
   - exact file paths for proposal/spec/design/tasks and UI design assets
   - explicit instruction to compare implemented UI against design asset(s)
   - explicit instruction to test both happy path and edge cases
   - expected return format (coverage matrix + defects + evidence + environment)

5. **Validate and normalize tester output**

   After tester result returns:
   - separate confirmed issues vs not reproduced
   - separate spec mismatch vs implementation bug vs verification gap
   - keep findings evidence-based (repro steps and observed behavior)

6. **Write `fix.md` in the change folder**

   Create or update:
   - `openspec/changes/<name>/fix.md`

   Format should be issue-list oriented and similar in readability to `tasks.md`.

   For each issue include:
   1. **What is the issue**
   2. **How to reproduce the issue**
   3. **What other parts may be related**

   Use this structure:

   ```markdown
   ## 1. <Issue Category>

   - [ ] 1.1 <Short issue title>
     - **Issue:** <clear issue statement>
     - **How to reproduce:**
       1. <step>
       2. <step>
       3. <step>
     - **Potentially related parts:**
       - `<path/or/component>`
       - `<path/or/component>`
   ```

   Rules for `fix.md`:
   - Keep numbering stable and deterministic.
   - Group by category (for example: Visual Conformance, Functional Issues, Verification Gaps).
   - If a behavior is inconsistent between runs, label it as inconsistent and include observed conditions.
   - Do not include speculative root causes as facts.

7. **Return a concise final report to user**

   Include:
   - selected change name
   - tester agent(s) used
   - files read for requirement derivation
   - location of written findings (`fix.md`)
   - top pass/fail verdict

**Guardrails**

- This command is for testing + issue documentation, not implementation.
- Always read the design asset(s) when UI conformance is in scope.
- Do not skip proposal/spec reading before testing.
- Do not overwrite unrelated content in `fix.md`; merge/update carefully if file already exists.
- If critical blockers prevent execution (no device, app cannot launch), still create/update `fix.md` with a "Blocked" section and exact blocker details.