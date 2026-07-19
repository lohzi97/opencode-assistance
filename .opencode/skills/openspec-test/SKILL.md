---
name: openspec-test
description: Test an OpenSpec change end-to-end from proposal requirements. Use when the user wants AI to replace manual testing, verify happy paths and edge cases, or determine required tools/MCPs for E2E validation.
license: MIT
compatibility: Requires openspec CLI and any project-specific runtime/testing tools needed by the change.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.2.0"
---

Perform manual-style end-to-end testing for a completed OpenSpec change using whatever tools, MCPs, browsers, terminals, emulators, services, APIs, databases, or external integrations are required to validate the implementation from the user's perspective.

This skill replaces the human manual testing phase in the OpenSpec workflow. It must determine whether it has enough tool capability to perform meaningful end-to-end testing, stop immediately if a required capability is missing, then execute happy-path and edge-case tests as thoroughly as possible.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Testing change: <name>" and how to override.

2. **Check status to understand the schema**

   ```bash
   openspec status --change "<name>" --json
   ```

   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifacts exist for this change
   - Whether the implementation appears complete enough to test

   If tasks are incomplete, continue only if the user explicitly asked to test a partial implementation. Otherwise report that the change is not ready for E2E testing and suggest openspec-apply-resume.

3. **Load proposal artifacts and test intent**

   Use the CLI to get context files:

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   Read all available artifacts from `contextFiles`:
   - `proposal.md` (if present)
   - `design.md` (if present)
   - `tasks.md` (if present)
   - Any spec deltas in `openspec/changes/<name>/specs/**/*.md`
   - Any additional context files returned by the CLI

   Extract explicit testing criteria from:
   - Proposal `Why`, `What Changes`, `Capabilities`, and `Impact`
   - Design `Goals`, `Non-Goals`, `Decisions`, `Risks / Trade-offs`
   - Spec `Requirements` and `Scenarios`
   - Task completion details
   - Referenced PRD, note, issue, or design source lines if the artifacts cite them

4. **Explore the implemented codebase**

   Use Glob, Grep, and Read tools to:
   - Locate files and modules touched by the change
   - Understand how the feature or fix is exposed to users
   - Identify entry points: UI routes, CLI commands, API endpoints, jobs, hooks, plugins, database writes, event handlers, integrations, etc.
   - Identify state stores and side effects: files, databases, caches, queues, services, browser state, network calls, notifications, external systems, logs
   - Identify existing test helpers, fixtures, scripts, dev servers, seed data, and setup commands
   - Locate existing automated tests relevant to the change

   Build a concrete testable model of:
   - What must be started
   - What inputs must be provided
   - What outputs or side effects prove correctness
   - What failure paths and edge cases must be exercised
   - What cleanup is needed after testing

5. **Determine required tools and MCPs**

   Before running E2E tests, explicitly identify the tools needed for this change. Consider:

   **Local terminal and services:**
   - `bash` or PTY for servers, CLIs, package scripts, Docker, logs, database inspection, curl/API calls, test runners

   **Browser or UI automation:**
   - Browser MCP, Playwright MCP, Chrome DevTools MCP, Steel Browser, or GUI `computer-control` for web apps and browser-only behavior

   **Desktop/mobile automation:**
   - GUI control, OS automation, simulator/emulator tooling, platform CLIs, notification inspection, screenshots, OCR

   **API and integration testing:**
   - HTTP clients, WebSocket/SSE clients, MCP clients, database CLIs, queue tooling, mock servers, local credentials, sandbox accounts

   **External services:**
   - Docker containers, cloud tunnels, auth providers, payment sandboxes, email/SMS sandboxes, storage buckets, third-party APIs, hardware devices

   **Observability:**
   - Logs, process status, database state, generated files, screenshots, trace output, browser console/network logs

   Then perform a capability check:
   - Verify each required tool/MCP is available before relying on it
   - Verify required services can be started or reached
   - Verify required credentials/configuration are present without exposing secrets
   - Verify test data can be created safely
   - Verify cleanup is possible

   **Hard stop rule:** If any required tool, MCP, service, credential, environment, fixture, device, or permission is missing such that full end-to-end testing cannot be performed, STOP immediately. Do not fall back to shallow tests and call them E2E. Report the exact gap, why it blocks testing, and what the user must provide or enable.

   If a capability is missing but a meaningful partial test is still possible, ask the user whether to proceed with partial testing. Do not proceed silently.

6. **Create an E2E test plan**

   Draft a concise but comprehensive test plan before executing it.

   The plan must include:
   - **Scope:** what behavior from the proposal/spec will be tested
   - **Tools/MCPs:** what will be used and why
   - **Setup:** services, data, accounts, fixtures, config, environment variables
   - **Happy paths:** normal successful user journeys
   - **Edge cases:** validation errors, permission failures, empty state, duplicate state, unavailable dependency, retries, persistence, ordering, concurrency, limits, rollback/cleanup, and any domain-specific risks
   - **Acceptance signals:** exact outputs, UI states, API responses, DB rows, logs, files, messages, events, screenshots, or side effects that prove correctness
   - **Cleanup:** what will be restored or removed after testing

   Keep the plan practical. Prioritize tests that validate real behavior over implementation details.

7. **Run prerequisite validation**

   Run relevant baseline checks before E2E testing:
   - `openspec validate <name> --strict`
   - Existing targeted automated tests related to the change, if available
   - Project build/typecheck/lint only if needed to make E2E results trustworthy

   Do not stop at automated tests. This skill's purpose is end-to-end validation. Use automated tests only as supporting evidence.

8. **Execute happy-path E2E tests**

   Exercise the feature through its real user-facing or integration-facing entry points.

   Examples:
   - For a web UI: start the app, drive the browser, verify visible UI, network behavior, persistence, refresh behavior, and error display
   - For an API: start the service, call real endpoints, verify response codes, response bodies, database side effects, logs, and downstream calls
   - For a CLI: run the real command, verify stdout/stderr, exit code, generated files, persisted state, and idempotency
   - For a background worker: trigger real events/jobs, verify queue behavior, retries, emitted events, database state, and logs
   - For an agent/OpenCode workflow: create real sessions or safe test sessions, send prompts/events, inspect persisted messages/state, and verify order-sensitive behavior

   Capture enough evidence to support each pass/fail conclusion.

9. **Execute edge-case E2E tests**

   Test as many realistic edge cases as possible within the current environment.

   Include edge cases derived from:
   - Spec scenarios
   - Design risks and trade-offs
   - Permission and authorization boundaries
   - Required and optional inputs
   - Duplicate or conflicting state
   - Empty or missing data
   - Invalid data and malformed requests
   - Dependency failures or unavailable services
   - Ordering, retries, idempotency, and persistence
   - Boundary values and limits
   - Cross-session, cross-user, or concurrent behavior if applicable

   If an edge case cannot be tested safely, document why.

10. **Investigate failures**

   For each failure or unexpected result:
   - Reproduce once if feasible
   - Determine whether it is a test setup issue, environment/tooling issue, implementation bug, proposal/spec mismatch, or unclear requirement
   - Gather concrete evidence: command output, response body, logs, screenshot, DB row, file diff, stack trace, event payload
   - Do not modify implementation code unless the user explicitly asks to switch into fix mode
   - If the failure indicates a real issue, recommend openspec-fix with a concise issue description
   - If the implementation intentionally differs from the proposal, recommend openspec-align after user confirmation

11. **Persist findings to the change issue file**

    Write actionable findings to `openspec/changes/<name>/issue.md` before the final report.

    **Issue format.** Each issue MUST be recorded as an unchecked checkbox line using the `ISSUE-<n>` id scheme :

    ```markdown
    - [ ] ISSUE-<n>: <one-line description>
      - Severity: <critical|high|medium|low>
      - <evidence, reproduction steps, affected files, response bodies, logs, etc.>
    ```

    Rules:
    - Use the next free `ISSUE-<n>` id (if `ISSUE-1` and `ISSUE-2` exist, the new one is `ISSUE-3`).
    - Keep the one-line description on the checkbox line; put detailed evidence in indented lines beneath it.
    - If a previously-fixed issue (its box is `- [x]`) is in fact NOT fixed, uncheck its box (`- [x]` -> `- [ ]`) and add the new evidence to its existing entry. Do not file a duplicate.

    Include every confirmed failure, bug, proposal/spec mismatch, unresolved blocker, and noteworthy non-blocking issue found during E2E testing. For each issue include:
    - Title and severity
    - What happened vs. what was expected
    - Exact reproduction steps, including commands, UI actions, API requests, payloads, fixtures, or test data
    - Concrete evidence such as response bodies, logs, screenshots, DB rows, stack traces, file paths, or event payloads
    - Affected requirement, scenario, proposal/design section, or task when identifiable

    If `openspec/changes/<name>/issue.md` already exists, read it first and merge the new findings into the existing document. Do not overwrite the whole file. Preserve existing issues, update matching issues with new evidence or reproduction details, and append only genuinely new issues.

    If no issues or blockers were found, leave an existing `issue.md` unchanged. Do not create noisy duplicate no-issue entries.

12. **Clean up test artifacts**

   Clean up only artifacts created by this test run:
   - Stop servers or background processes started for testing
   - Remove temporary test data, files, sessions, database rows, queues, or fixtures if safe
   - Leave user data and unrelated changes untouched

   If cleanup is unsafe or requires user confirmation, report exactly what remains.

13. **Provide final E2E report**

   Use this structure:

   ```markdown
   ## E2E Test Report: <change-name>

   ### Result
   PASS / PARTIAL / FAIL / BLOCKED

   ### Capability Check
   - Required tools/MCPs: [list]
   - Available: [list]
   - Missing/blocking gaps: [list or None]

   ### Test Scope
   [What proposal/spec/design behavior was tested]

   ### Tests Executed
   | ID | Case | Type | Method | Result | Evidence |
   | --- | --- | --- | --- | --- | --- |
   | T1 | [case] | Happy path / Edge | [tool/entry point] | PASS/FAIL | [evidence] |

   ### Findings
   - [Finding 1 with severity, evidence, and affected requirement]
   - [Finding 2 with severity, evidence, and affected requirement]

   ### Proposal Alignment Notes
   - [Any behavior that differs from proposal/design/spec]
   - [Whether openspec-align is recommended]

   ### Issue File
   - [Whether `openspec/changes/<name>/issue.md` was created, updated, merged, left unchanged, or not needed]

   ### Cleanup
   - [What was cleaned]
   - [What remains, if anything]

   ### Recommendation
   - [Archive-ready, needs openspec-fix, needs openspec-align, needs missing test capability, etc.]
   ```

**Result Semantics**

- **PASS:** Required E2E tools were available, all planned happy-path and high-value edge-case tests passed, and no proposal/spec mismatch remains.
- **PARTIAL:** Some useful tests passed, but full E2E coverage was not possible or some lower-priority edge cases remain untested. Explain why.
- **FAIL:** Full E2E testing was possible and at least one requirement failed or behaved unexpectedly.
- **BLOCKED:** Required capability was missing before meaningful E2E testing could be performed.

**Guardrails**

- This is a testing phase. Do NOT write implementation code or proposal changes unless the user explicitly asks.
- Do NOT claim E2E coverage if required tools, services, credentials, or environment are missing.
- Stop immediately on blocking capability gaps and report them clearly.
- Prefer real user-facing entry points over internal function calls.
- Use internal/unit tests only as supporting evidence, not as a replacement for E2E behavior.
- Avoid destructive tests unless the environment is disposable or the user explicitly approves.
- Do not expose secrets in logs or reports.
- Clean up only test artifacts created during this skill.
- If the implementation appears correct but the proposal is outdated, recommend openspec-align rather than changing artifacts.
- If a bug is found, recommend openspec-fix with the concrete failure description.
- Use contextFiles from CLI output, don't assume specific file names.
- Refer to `openspec/AGENTS.md` (located inside the `openspec/` directory — run `ls openspec` or `openspec update` if you don't see it) if you need additional OpenSpec conventions or clarifications.

**Fluid Workflow Integration**

This skill supports the manual-testing replacement stage:

- Use after openspec-apply-resume reports that implementation matches the proposal.
- Use before openspec-align to discover UIUX or behavioral drift that should be reflected in proposal artifacts.
- Use before openspec-archive-change to decide whether the change is archive-ready.
- If testing finds bugs, use openspec-fix.
- If testing finds intentional proposal drift, use openspec-align.
