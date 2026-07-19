---
name: openspec-code-review
description: Review code quality for a completed OpenSpec implementation and update issue.md. Use after openspec-test passes, before final fix/alignment/archive, to find maintainability, safety, architecture, and quality issues without changing implementation code.
license: MIT
compatibility: Requires openspec CLI and project-specific source inspection or validation tools.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

# OpenSpec Code Review

Review the implementation quality of an OpenSpec change after functional testing has passed. This skill is a reviewer workflow, not a fixer workflow.

The goal is to find code quality issues that should be addressed by `openspec-fix`, record them in `openspec/changes/<name>/issue.md`, and stop. Do not modify implementation code, tests, product behavior, proposal artifacts, or task files unless the only change is updating `issue.md` with review findings.

## Input

Optionally specify a change name. If omitted, infer it from conversation context or select from active OpenSpec changes.

## Applicability

Use this skill only when the OpenSpec change includes implementation code or technical artifacts that benefit from code review.

If the change is non-code work, such as prose, story chapters, planning documents, or purely editorial content, report `NOT_APPLICABLE` and do not create noisy issues.

## Steps

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change.
   - Auto-select if only one active change exists.
   - If ambiguous, run `openspec list --json` and ask the user to select the change.

   Announce: `Code reviewing change: <name>`.

2. **Check OpenSpec status**

   Run:

   ```bash
   openspec status --change "<name>" --json
   ```

   Parse the output to understand the schema, artifacts, and current implementation state.

   If the implementation is clearly incomplete, report `BLOCKED` and recommend `openspec-apply-resume` before code review.

3. **Load change context**

   Run:

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   Read all returned `contextFiles`, including proposal, design, task, spec delta, issue, PRD, or other referenced files.

   Understand:
   - The intended behavior and scope.
   - The implementation approach expected by the design.
   - Existing known issues already recorded in `issue.md`.
   - The user-facing and technical boundaries of the change.

4. **Determine whether code review applies**

   Inspect the project and change context to determine whether there is source code, configuration, tests, infrastructure, generated runtime behavior, or technical implementation to review.

   If not applicable:
   - Do not update `issue.md` unless it already contains an appropriate section that should be marked not applicable.
   - Final result must be `NOT_APPLICABLE`.

5. **Identify implementation surface**

   Locate the relevant files and modules through project inspection. Prefer sources from:
   - Files mentioned in proposal, design, specs, tasks, and existing issues.
   - Current git status and diff when available.
   - Grep and Glob searches for feature names, APIs, routes, commands, UI components, services, stores, hooks, handlers, migrations, or tests.
   - Existing test files related to the changed behavior.

   Do not review unrelated code unless it is directly touched by, called by, or required for the change.

6. **Review for quality issues**

   Focus on maintainability and implementation quality, not re-running the full E2E test workflow.

   Review for:
   - Incorrect abstraction boundaries, duplicated logic, or avoidable coupling.
   - Fragile state management, race conditions, ordering problems, or lifecycle leaks.
   - Missing error handling, unsafe assumptions, null/undefined handling, or unchecked external input.
   - Security, privacy, permission, or secret-handling risks.
   - Performance issues, excessive IO, inefficient queries, unbounded loops, or unnecessary polling.
   - Poor API shape, unclear naming, inconsistent project conventions, or hard-to-maintain control flow.
   - Test quality gaps directly tied to code maintainability or high-risk behavior.
   - Configuration, migration, deployment, or rollback risks introduced by the change.

   Do not report subjective style preferences unless they create real maintenance risk or violate clear project conventions.

7. **Run supporting static checks when useful**

   Run project-appropriate static checks only when they help the review and are safe in the current environment, such as typecheck, lint, `cargo check`, `go test` compile checks, or targeted test compilation.

   Do not treat this as the E2E test phase. If behavior must be tested end-to-end, recommend `openspec-test` instead.

8. **Merge findings into issue.md**

    Before writing, read `openspec/changes/<name>/issue.md` if it exists. If new issues are found and the file does not exist, create it.

    Append only genuinely new code quality issues. Do not duplicate issues already present. If an existing issue matches, update it only when adding materially useful evidence, file references, or reproduction/validation details.

    Track whether `issue.md` contains unresolved code review issues after the merge. If previous review rounds already added unresolved issues, a no-new-issues result should still recommend `openspec-fix` before alignment.

    Prefer a stable section such as `## Code Review Issues` or `## Code Quality Issues` when adding findings. Keep repeated review rounds in the same section so later `openspec-code-review` runs can detect duplicates and later `openspec-fix` can address the accumulated set in one pass.

    Each new issue MUST be recorded as an unchecked checkbox line using the `ISSUE-<n>` id scheme:

    ```markdown
    - [ ] ISSUE-<n>: <stable title>
      - Severity: <critical|high|medium|low>
      - Category: <maintainability|correctness risk|safety|security|performance|test quality|architecture|configuration|other>
      - Affected: <files or symbols>
      - Why it matters: <explanation>
      - Recommended fix: <direction for openspec-fix>
      - Evidence: <code excerpts, command output, or convention references>
    ```

    Rules:
    - Use the next free `ISSUE-<n>` id (if `ISSUE-1` and `ISSUE-2` exist, the new one is `ISSUE-3`).
    - Keep the stable title on the checkbox line; put the severity, category, evidence, and fix direction in indented lines beneath it.
    - If a previously-fixed issue (its box is `- [x]`) is in fact NOT fixed, uncheck its box (`- [x]` -> `- [ ]`) and add the new evidence to its existing entry. Do not file a duplicate.

    New code review issues should be clearly unresolved unless the review is only adding evidence to an already-resolved item. Do not mark issues resolved from this skill; resolution belongs to `openspec-fix` or a later explicit verification step.

   If no new issues are found, leave existing `issue.md` unchanged unless it is already tracking review rounds and can be updated without noise.

9. **Do not fix**

   Do not modify implementation code. Do not refactor. Do not mark tasks complete. Do not align or archive. The next remediation step is `openspec-fix`.

10. **Final report**

   Use this structure:

   ```markdown
   ## Code Review Report: <change-name>

   ### Result
   PASS / ISSUES_FOUND / BLOCKED / NOT_APPLICABLE

   ### Review Scope
   - Reviewed files/areas: ...
   - Skipped areas and why: ...

   ### Findings
   - New issues added to issue.md: N
   - Existing issues updated: N
   - Duplicate issues skipped: N
   - Existing unresolved review issues in issue.md: N

   ### Validation
   - Static checks run: ...
   - Results: ...

   ### issue.md
   - Updated: yes/no
   - Path: openspec/changes/<name>/issue.md

   ### Recommendation
   Proceed to openspec-fix / repeat openspec-code-review / proceed to openspec-align / not applicable
   ```

   Recommendation rules:
   - If new issues were added, recommend `repeat openspec-code-review` until a later review finds no new issues.
   - If no new issues were added but unresolved review issues exist in `issue.md`, recommend `proceed to openspec-fix`.
   - If no new issues were added and no unresolved review issues exist, recommend `proceed to openspec-align`.
   - If the change is non-code, recommend `not applicable`.

## Result Semantics

- `PASS`: Code review applies and no new quality issues were found.
- `ISSUES_FOUND`: New or updated quality issues were written to `issue.md`.
- `BLOCKED`: The review could not be completed because required context, tools, or implementation state is missing.
- `NOT_APPLICABLE`: The change does not contain code or technical implementation that warrants code review.

## Guardrails

- Only update `openspec/changes/<name>/issue.md`.
- Preserve existing `issue.md` content and avoid duplicates.
- Keep findings actionable and grounded in evidence.
- Do not perform broad unrelated review.
- Do not fix implementation issues in this skill.
- Do not archive, align, or commit.
