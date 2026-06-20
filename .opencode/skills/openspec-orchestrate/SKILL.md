---
name: openspec-orchestrate
description: Orchestrate an OpenSpec proposal workflow through agent-collab. Use when the user wants Sebastian to coordinate propose, review, apply, resume, test, fix, optional code review, align, archive, and commit checkpoints using focused worker sessions.
license: MIT
compatibility: Requires agent-collab service, OpenCode session spawning, openspec CLI, and the OpenSpec skills used by the workflow.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

# OpenSpec Orchestrate

Coordinate an OpenSpec-driven development workflow as the long-lived planner while spawning focused worker sessions through the `agent-collab` room service.

This skill is for orchestration only. The planner tracks workflow state, assigns one focused phase to each worker, receives the worker's report, removes the worker from the room, and decides the next phase. The planner must not micro-manage implementation details, inspect worker diffs, stage files, commit, or push unless the user explicitly changes the workflow rules.

## Core Principle

One worker session performs one OpenSpec phase.

The planner owns:

- workflow state (persisted to the state file)
- state file read/write cadence
- phase transitions
- worker spawning and removal
- commit checkpoint decisions
- reporting to the user

The worker owns:

- loading the assigned `openspec-*` skill
- executing that skill's workflow
- reporting the result

Commit workers are also workers. They own git inspection, staging, commit-message selection, committing, and pushing when authorized by the planner assignment.

## State File Protocol

The planner must persist workflow state to a JSON file in the target project directory at `<project>/openspec/.orchestration-state.json`. This file is the single source of truth for workflow progress and survives context compaction or session interruption.

### Schema

```json
{
  "project": "<absolute-path>",
  "workflowMode": "brownfield | greenfield-prd",
  "proposalName": "<proposal-name or null>",
  "currentPhase": "<phase-state>",
  "previousPhase": "<phase-state or null>",
  "phaseHistory": [
    {
      "phase": "<phase-state>",
      "outcome": "<outcome>",
      "timestamp": "<ISO-8601>"
    }
  ],
  "intent": {
    "problem": "<what problem the master is trying to solve>",
    "motivation": "<why this matters, the original trigger>",
    "scope": "<what is in scope and explicitly out of scope>",
    "constraints": ["<non-obvious constraints or tradeoffs>"],
    "preferences": ["<master preferences that should guide decisions>"]
  },
  "config": {
    "codeReview": "disabled | enabled | auto-skip-non-code",
    "commitMode": "disabled | ask_each_checkpoint | auto_at_checkpoints",
    "pushMode": "disabled | ask_each_checkpoint | auto_with_commit",
    "loopMode": "auto_continue_until_blocked | ask_after_each_phase",
    "modelOverrides": {}
  },
  "roomId": "<room-name or null>",
  "proposalQueue": [],
  "currentQueueIndex": 0,
  "decisionLog": [
    {
      "timestamp": "<ISO-8601>",
      "phase": "<phase>",
      "workerAlias": "<alias>",
      "trigger": "<worker question or issue, summarized>",
      "assumptions": ["<assumption 1>", "<assumption 2>"],
      "decision": "<what the planner decided>",
      "rationale": "<why, tied to intent/scope/proposal>",
      "disposition": "decided | deferred_to_worker | escalated",
      "escalated": false
    }
  ],
  "lastUpdated": "<ISO-8601>"
}
```

### Read/Write Cadence

- **Read** the state file at the start of every planner turn to recover context, especially after compaction or session resumption.
- **Write** the state file immediately after:
  - Intent capture completes and the workflow configuration is established.
  - Each phase transition decision (update `currentPhase`, `previousPhase`, and append to `phaseHistory`).
  - Capturing the proposal name from a `proposal_needed` worker report.
  - Capturing the proposal queue from PRD decomposition.
  - Advancing `currentQueueIndex` to the next proposal.
  - Room creation or closeout.
  - Recording an autonomous decision in the decision log, before answering the worker (see Autonomous Decision Protocol).
- **Never** update the state file while a worker is still in progress. Write only after receiving and processing the worker's report.
- The state file supplements but does not replace the planner's own reasoning. It is a persistence layer, not a decision maker.

### State File Recovery

If the state file is missing or corrupted, reconstruct from the latest planner report, room status, worker reports, and proposal files. If the intent cannot be reconstructed from these sources, ask the master to re-confirm the original intent before continuing. Write the reconstructed state immediately so the next turn has a clean reference.

## Skill Assignment Rule

Messages sent through `agent-collab` cannot trigger OpenCode slash commands or user command wrappers. Assign workers to load and use the relevant `openspec-*` skill directly.

If a required skill is not available, stop and report the missing `openspec-*` skill before spawning a worker for that phase.

Newly created project skills may require restarting OpenCode before they appear in the available skills list for the planner or spawned workers. If a required skill exists on disk but is unavailable at runtime, stop and ask the user to restart OpenCode rather than improvising a replacement workflow.

## Worker Model Routing

Spawn each worker with the model assigned to its phase unless the user explicitly overrides it for the current run.

All workers must be spawned with `--agent levi`. Do not omit the agent flag or let it fall back to the planner default. If a future run requires a different agent, the user must explicitly override this for that run.

| Worker phase | Skill | Provider | Model |
| --- | --- | --- | --- |
| Proposal creation | `openspec-propose` | `deepseek` | `deepseek-v4-pro` |
| Proposal review | `openspec-review-proposal` | `deepseek` | `deepseek-v4-pro` |
| PRD decomposition | `openspec-decompose-prd` | `deepseek` | `deepseek-v4-pro` |
| PRD decomposition review | `openspec-review-prd-decomposition` | `deepseek` | `deepseek-v4-pro` |
| Implementation | `openspec-apply-change` | `deepseek` | `deepseek-v4-pro` |
| Implementation review/resume | `openspec-apply-resume` | `deepseek` | `deepseek-v4-pro` |
| Testing | `openspec-test` | `deepseek` | `deepseek-v4-pro` |
| Fixing | `openspec-fix` | `deepseek` | `deepseek-v4-pro` |
| Code review | `openspec-code-review` | `openai` | `gpt-5.5` |
| Design discussion | `openspec-discuss` | `openai` | `gpt-5.5` |
| Alignment | `openspec-align` | `deepseek` | `deepseek-v4-flash` |
| Archive | `openspec-archive-change` | `deepseek` | `deepseek-v4-pro` |
| Commit checkpoint | commit worker | `deepseek` | `deepseek-v4-flash` |

When spawning through `agent-collab`, pass both `--provider <provider>` and `--model <model>` from this table. Do not omit model routing and rely on planner defaults. If a configured provider/model pair is unavailable at spawn time, stop and ask the user for a model override instead of silently falling back to the planner default.

## Intake

Before creating or using a room, the planner must first understand what the master wants to build and why. Do not begin orchestration until the intent is clear.

### Intent Capture

Have a short clarifying discussion with the master to form a mental model of the requirement. The goal is not to write a PRD — it is to understand the problem well enough to make sound autonomous decisions throughout the workflow.

Ask about:

- **The problem**: What is the master trying to solve? What is the current pain point or gap?
- **The motivation**: Why now? What triggered this request? What happens if this is not built?
- **The scope**: What is explicitly in scope? What is explicitly out of scope or deferred?
- **Constraints**: Are there technical, time, or resource constraints? Non-negotiable requirements?
- **Preferences**: Does the master have a preferred approach, stack, or pattern? Any anti-patterns to avoid?

Do not ask all questions mechanically. Use judgment — if the master's initial request already answers some of these, acknowledge what is clear and ask only about what is ambiguous or missing.

After the discussion, summarize your understanding back to the master for confirmation. Once confirmed, persist it as the `intent` object in the state file. This intent is the planner's reference for all subsequent autonomous decisions.

If the master provides a PRD instead of a feature request, read the PRD first and use the same questions to fill any gaps the PRD does not cover. A PRD that is thorough on requirements but silent on motivation or constraints still needs clarification.

### Orchestration Configuration

After intent is captured, collect the orchestration inputs. Ask only for missing details that cannot be safely inferred.

Required inputs:

- Target project directory.
- Workflow mode: `brownfield` or `greenfield-prd`.
- Proposal name, feature request, or bug report for brownfield work; PRD path for greenfield decomposition.
- Starting phase, unless the user clearly wants to start from the beginning.
- Code review mode: `disabled`, `enabled`, or `auto-skip-non-code`.
- Commit mode: `disabled`, `ask_each_checkpoint`, or `auto_at_checkpoints`.
- Push mode: `disabled`, `ask_each_checkpoint`, or `auto_with_commit`.
- Loop mode: `auto_continue_until_blocked` or `ask_after_each_phase`.
- Optional model overrides, if the user wants to diverge from the Worker Model Routing table for this run.

Infer the target project directory from the current workspace when safe. Ask only when the user names a different project or the workspace is ambiguous.

Default to:

- Code review mode: `auto-skip-non-code`.
- Commit mode: `ask_each_checkpoint`.
- Push mode: `ask_each_checkpoint`.
- Loop mode: `auto_continue_until_blocked`.

Do not assume commit or push authorization from the existence of checkpoint guidance. Commit and push only according to the selected modes.

For brownfield work, a proposal name is required only when starting from an existing proposal. If the user gives a new feature request or bug report instead, start at `proposal_needed` with `openspec-propose` and capture the proposal name from the worker's report before continuing to proposal review.

For greenfield PRD work, capture the proposal queue from `prd-implementation-sequence.md` after PRD decomposition and decomposition review are complete. Process one proposal at a time through the brownfield state machine.

After intake is complete, write the initial state file to `<project>/openspec/.orchestration-state.json` with the captured intent, resolved configuration, workflow mode, and starting phase. The state file must exist before any worker is spawned.

## Resume Existing Orchestration

When resuming an interrupted workflow, read the state file at `<project>/openspec/.orchestration-state.json` first. It is the primary source of truth for current phase, proposal name, configuration, and phase history.

If the state file is missing or corrupted, fall back to reconstructing from the latest planner report, room status, worker reports, and proposal files. If the intent cannot be recovered, ask the master to re-confirm before proceeding. Write the reconstructed state immediately.

Do not rerun completed phases unless the previous result is missing, blocked, invalid, or explicitly superseded by the user.

If the prior state is unclear even after state file recovery and artifact inspection, ask the user for the intended current phase or spawn a narrow review worker for the specific ambiguity. Do not infer implementation quality by inspecting diffs as the planner.

## Planner Setup

1. Load the `agent-collab` skill before creating or managing rooms.
2. Get the current session id using the local session info script if needed:

   ```bash
   bun .opencode/scripts/session-info.ts
   ```

3. Create an `agent-collab` room as planner for the target project directory.
4. Preserve the full room name returned by `room create`.
5. Keep the room password private.
6. Do not use a detailed room public message. Leave it unset unless a minimal neutral note is necessary.
7. Update the state file `roomId` field with the created room name.

The worker does not need the project path, change id, phase, global workflow, reporting schema, or orchestration rules in the room public message. Spawn the worker in the correct project directory and send the immediate assignment directly.

## Worker Assignment Pattern

Spawn a worker with a narrow alias and role for the current phase. Use the same project directory as the target project.

Always select the worker's provider and model from the Worker Model Routing table and pass them to the `agent-collab spawn` command, along with `--agent levi`. For example, an `openspec-code-review` worker must be spawned with `--agent levi --provider openai --model gpt-5.5`, while an `openspec-align` worker must be spawned with `--agent levi --provider deepseek --model deepseek-v4-flash`.

Worker assignment prompts must name the `openspec-*` skill to load and use. Do not phrase assignments as slash commands, shell commands, or user command wrappers.

Example assignment prompts:

```text
We have PRD '<prd-path>'. Use the `openspec-decompose-prd` skill to decompose it into independently implementable OpenSpec proposals and produce the PRD implementation sequence.
```

```text
We have PRD '<prd-path>' and generated OpenSpec proposals. Use the `openspec-review-prd-decomposition` skill to audit the proposals against the PRD and update proposal artifacts if needed.
```

```text
We need a new OpenSpec proposal for this request: <feature-or-bug-request>. Use the `openspec-propose` skill to create the proposal.
```

```text
We have OpenSpec proposal '<proposal-name>'. Use the `openspec-review-proposal` skill to review the proposal against the current codebase and update proposal artifacts if needed.
```

```text
We have OpenSpec proposal '<proposal-name>'. Use the `openspec-apply-change` skill to work on it.
```

```text
We have OpenSpec proposal '<proposal-name>'. Use the `openspec-fix` skill to fix the issues recorded in `openspec/changes/<proposal-name>/issue.md`.
Use that file as the issue source. Address all unresolved issues relevant to this fix phase and report any issue you intentionally leave unresolved.
```

```text
We have OpenSpec proposal '<proposal-name>'. Use the `openspec-test` skill to test the implementation.
```

```text
We have OpenSpec proposal '<proposal-name>'. Use the `openspec-code-review` skill to review code quality and update `openspec/changes/<proposal-name>/issue.md` if needed.
```

```text
We have completed checkpoint '<checkpoint-name>' for OpenSpec proposal '<proposal-name>'. Inspect git status, git diff, and git log --oneline -10. Stage only files relevant to this checkpoint. Commit with a concise message. Push only if explicitly authorized by the planner assignment. Report commit hash, pushed branch if pushed, files included, and any files intentionally excluded.
```

Do not include the complete workflow history unless the assigned skill needs it. The worker should focus only on the assigned phase.

## Worker Lifecycle

For each phase:

1. Spawn exactly one worker session for the phase.
2. Wait for the worker's ordinary collab response. Do not poll while waiting for delivery.
3. Read and synthesize the worker's report.
4. Decide the next phase from the report outcome.
5. Update the state file with the new `currentPhase`, `previousPhase`, and appended `phaseHistory` entry.
6. Remove the worker from the room before starting the next worker.

Removing a worker from the room removes it from collaboration context; it is not a guarantee that the spawned OpenCode session process is terminated. Do not rely on removed workers for future context.

If the worker asks a tracked question, reports `blocked`, or flags an issue, do not reflexively escalate to the user. Route the question through the **Autonomous Decision Protocol** below. The protocol decides whether the planner resolves it, defers to the worker, or escalates. Deliver any autonomous answer to the worker through `agent-collab answer --parent <message_id>`.

Use hard interrupts only when a worker is clearly stuck or running the wrong task.

## Planner Guardrails

- Stay purely orchestrational.
- Do not inspect implementation diffs after worker changes files.
- Do not independently review changed files unless explicitly asked by the user.
- Do not inspect git status or git diff as the planner for commit preparation; delegate that to the commit worker.
- You may inspect high-level workflow artifacts only when needed for state routing, but must not inspect implementation diffs or stage files.
- Do not personally stage, commit, or push. Use a commit worker whenever checkpoint commits are enabled.
- Act on worker reports, not planner-side implementation analysis.
- Do not let a worker choose the next phase; workers may recommend, but the planner decides.
- If a worker report is unclear, spawn a fresh reviewer or ask a clarification instead of guessing.
- Keep one active worker per phase unless the user explicitly requests parallel review.
- Remove completed workers from the room before spawning the next phase worker.
- Keep room public context minimal or absent.
- Keep the state file in sync. Every phase transition must produce a state file write before the next worker is spawned. If the planner suspects the state file is stale, read it and verify before proceeding.

## Autonomous Decision Protocol

When a worker raises a blocking question, reports `blocked`, or flags an issue, the planner triages it instead of defaulting to escalation. The goal is to keep the workflow moving autonomously on the decisions the planner is competent to make, while protecting the decisions that actually cost the user something.

### Decision Boundary

The planner reasons from: the captured `intent` (problem, motivation, scope, constraints, preferences), the PRD, the proposal, and the worker's framing of the question. It does not inspect implementation diffs or code to reach a decision. If a question cannot be resolved without judging implementation correctness, defer or escalate rather than reading diffs.

The `intent` object is the planner's primary anchor for autonomous decisions. When a question touches on scope, tradeoffs, or preferences, consult the intent first. If the intent is silent on the matter and the decision is low-risk, defer to the worker's recommendation. If the decision would redefine the goal or change scope, escalate.

### Triage

Apply this order to every raised question or issue:

1. **Decide autonomously** when all of the following hold:
   - The question is resolvable from the captured intent, PRD, proposal, or high-level design.
   - The decision is reversible or low-risk.
   - The decision does not change external state: commit, push, credentials, accounts, infrastructure.
   - The decision does not redefine the goal or materially change scope.
2. **Defer to the worker's recommendation** when the worker already proposed a sound path that aligns with the captured intent but flagged it for confirmation. Treat the worker's recommendation as the decision, record the assumption that the worker's judgement is trusted on this point, and proceed.
3. **Escalate to the user** only when:
   - The decision would redefine the goal or materially change scope.
   - The decision is irreversible or high-risk.
   - The decision changes external state (commit, push, credentials, accounts, infrastructure).
   - The question cannot be resolved from the captured intent, PRD, or proposal even after the planner reviews the high-level artifacts.

When in genuine doubt between autonomous and escalate, escalate. The bias is toward autonomy, not toward guessing on stakes.

### Recording Requirement

For every `decided` or `deferred_to_worker` disposition, append an entry to `decisionLog` in the state file **before** answering the worker. An entry that is not persisted does not count as a decision. Each entry must capture:

- the phase and worker alias that raised it,
- the trigger (the worker's question or issue, summarized),
- the assumptions the planner made,
- the decision,
   - the rationale (tied to the captured intent, scope, or the proposal),
- the disposition.

Escalations do not require a log entry unless the user later resolves the question, in which case record the user's resolution as a `decided` entry with rationale "per user direction" so the closeout summary reflects it.

After recording and answering, continue the workflow immediately. Do not pause for confirmation unless the triage escalated.

## Review Gate Protocol

Four phases act as review gates. A gate worker must report a **clean pass** before the planner may advance to the next phase. A clean pass means the worker found zero issues in that specific run and made zero changes.

A run where the worker found issues and fixed them is a **dirty pass**, even if the worker then concludes everything is now fine. The fixes themselves must survive a fresh gate run. The planner must re-run the same gate phase after any dirty pass.

### Gate Definitions

| Gate phase | Skill | Clean-pass criteria |
| --- | --- | --- |
| PRD decomposition review | `openspec-review-prd-decomposition` | Zero coverage gaps found, zero proposal artifacts modified in this run. |
| Proposal review | `openspec-review-proposal` | Zero gaps found, zero proposal artifacts modified in this run. |
| Implementation review | `openspec-apply-resume` | Zero files edited because the implementation already matches the proposal. |
| Code review | `openspec-code-review` | All issues found are already listed in `issue.md`, zero new issues added in this run. |

### Planner Behavior at Gates

- After a gate worker finishes, read the worker's full report.
- If the report describes any issues found, files edited, gaps addressed, or artifacts updated during this run, the gate is a dirty pass. Re-run the same gate phase with a fresh worker.
- If the report explicitly states no issues were found and no changes were made, the gate is a clean pass. Proceed to the next phase.
- The gate worker's orchestration signal must include `Gate verdict: clean_pass | dirty_pass` for gate phases.
- Do not advance past a gate on a generic `ready` outcome alone. The explicit clean-pass verdict is required.

## Phase State Machine

The planner tracks the workflow as explicit states with allowed transitions. All state transitions must be persisted to the state file immediately after the decision is made.

### Brownfield Workflow

```text
proposal_needed
  -> proposal_review
  -> proposal_ready
  -> implementation
  -> implementation_review
  -> implementation_ready
  -> testing
  -> fixing
  -> testing
  -> optional_code_review
  -> quality_fix
  -> final_test
  -> alignment
  -> archive
  -> completed
```

Recommended transitions:

- `proposal_needed` uses `openspec-propose`.
- `proposal_review` uses `openspec-review-proposal` as a review gate. Do not advance until the worker reports a clean pass (zero gaps found, zero proposal artifacts modified).
- If `openspec-propose` creates or renames the change, capture the canonical proposal name from the worker report and use that name for all later phases.
- After proposal review reports ready, trigger the proposal-ready commit checkpoint according to commit and push modes.
- `implementation` uses `openspec-apply-change`.
- `implementation_review` uses `openspec-apply-resume` as a review gate. Do not advance until the worker reports a clean pass (zero files edited).
- After implementation review reports ready, trigger the initial-implementation commit checkpoint according to commit and push modes.
- `testing` uses `openspec-test`.
- If testing fails or updates `issue.md`, go to `fixing` with `openspec-fix`, then return to `testing`.
- If testing passes and code review is disabled, trigger the tested-implementation commit checkpoint according to commit and push modes, then proceed to `alignment`.
- If testing passes and code review is enabled, go to `optional_code_review`.
- If code review is not applicable, proceed to `alignment`.
- If code review finds issues, run `quality_fix` with `openspec-fix`, then run `final_test` with `openspec-test`.
- If final test fails or updates `issue.md`, go to `fixing` with `openspec-fix`, then return to `testing` and re-enter the code-review decision from a passing test.
- If final test passes after quality fix, trigger the post-quality-fix tested commit checkpoint according to commit and push modes, then proceed to `alignment`.
- If the quality fix was substantial, optionally run one more `optional_code_review`; if that review finds issues, return to `quality_fix`.
- If code review finds no issues (clean pass), proceed to `alignment` without a quality-fix pass.
- After `alignment` reports complete, trigger the aligned-proposal commit checkpoint according to commit and push modes.
- After alignment, run `archive` with `openspec-archive-change`.
- After archive reports complete, trigger the archive-complete commit checkpoint according to commit and push modes.
- If commit mode is `ask_each_checkpoint`, ask the user before spawning a commit worker at each checkpoint.
- If commit mode is `auto_at_checkpoints`, spawn a commit worker at checkpoints without asking.
- If commit mode is `disabled`, push mode is ignored and no commit worker is spawned.
- If push mode is `disabled`, instruct commit workers not to push.
- If push mode is `ask_each_checkpoint`, ask the user before allowing the commit worker to push.
- If push mode is `auto_with_commit`, allow the commit worker to push after committing.

### Greenfield PRD Workflow

For a PRD-driven project, prepend:

```text
prd_decomposition
  -> prd_decomposition_review
  -> proposal_queue
```

Then process one proposal at a time through the brownfield workflow.

Do not parallelize proposals unless the user explicitly requests it and dependency ordering in `prd-implementation-sequence.md` allows it.

Run PRD decomposition review as a review gate. Do not advance until the worker reports a clean pass (zero coverage gaps found, zero proposal artifacts modified).

## Optional Code Review Loop

Code review is optional and applies only to projects with implementation code or technical artifacts.

When enabled, use this loop after `openspec-test` passes:

```text
openspec-test PASS
  -> openspec-code-review (review gate: must report clean pass)
  -> if clean pass or NOT_APPLICABLE, openspec-align
  -> if dirty pass (issues found or added to issue.md), openspec-fix for accumulated code quality issues
  -> openspec-test final verification
  -> if final test fails, openspec-fix and return to normal testing loop
  -> openspec-code-review again (review gate: must report clean pass)
  -> if still dirty, return to openspec-fix
  -> if clean pass, openspec-align
```

If the change is non-code work or `openspec-code-review` reports `NOT_APPLICABLE`, skip code review remediation and proceed from passing test to alignment.

Do not run code review before functional testing passes. The review is a post-functional-quality gate, not a substitute for implementation validation.

## Commit Checkpoints

Use a separate focused commit worker, not the planner, for commit and push checkpoints.

The commit worker is responsible for git hygiene: status, diff, staging only relevant files, commit message, commit, and push.

The planner decides when to invoke the commit worker. Recommended checkpoints:

- After PRD decomposition review or proposal review completes and proposals are ready.
- After `openspec-apply-resume` completes and initial implementation is done.
- After `openspec-test` passes when code review is disabled.
- After the code review loop, quality fix, and final `openspec-test` pass when code review is enabled.
- After `openspec-align` completes.
- After `openspec-archive-change` completes.

Commit worker assignment example:

```text
We have completed checkpoint '<checkpoint-name>' for OpenSpec proposal '<proposal-name>'. Inspect git status, git diff, and git log --oneline -10. Stage only files relevant to this checkpoint. Commit with a concise message. Push only if explicitly authorized by the planner assignment. Report commit hash, pushed branch if pushed, files included, and any files intentionally excluded.
```

The planner should not inspect the diff itself unless the user explicitly requests planner-side review.

## Worker Report Signal

Do not override the detailed report format of each `openspec-*` skill. Ask every worker to include this footer after the assigned skill's normal report:

```text
Orchestration signal:
Outcome: ready | repeat | issues_found | fixed | passed | failed | blocked | not_applicable
Changed files: yes | no | unknown
Issue file updated: yes | no | not_applicable
Gate verdict: clean_pass | dirty_pass | not_applicable
Recommended next phase: <phase>
Blocking question: <question or none>
```

For gate phases (PRD decomposition review, proposal review, implementation review, code review), `Gate verdict` is required and must be `clean_pass` or `dirty_pass`. For non-gate phases, use `not_applicable`.

The signal is for planner routing only. The full skill report remains authoritative for phase details.

After processing the signal and deciding the next phase, update the state file before proceeding. The state file's `currentPhase` must always reflect the planner's latest decision.

Normalize skill-specific result names into the orchestration signal when routing. For example, `PASS` maps to `passed`, `ISSUES_FOUND` maps to `issues_found`, `BLOCKED` maps to `blocked`, and `NOT_APPLICABLE` maps to `not_applicable`.

## Planner Report To User

After each phase or checkpoint, report concisely:

```markdown
## OpenSpec Orchestration: <proposal-name>

### Completed Phase
<phase>

### Outcome
<ready/repeat/issues/fixed/passed/blocked/not applicable>

### Decision
<next phase and why>

### Commit Checkpoint
yes/no; if yes, commit worker result

### Decisions This Phase
<list each autonomous decision and deferred-to-worker decision recorded this phase: trigger, decision, disposition; or "none">

### Notes
<brief operational notes only>
```

Do not include implementation-level details unless they are present in the worker report and relevant to the user's decision.

## Failure Handling

- If a worker reports `blocked`, route through the Autonomous Decision Protocol first. Only escalate to the user or spawn a discussion worker with `openspec-discuss` if the triage outcome is escalate.
- If a worker runs the wrong skill or changes unrelated files, stop the workflow and report the incident.
- If a required skill is unavailable, stop and report which `openspec-*` skill is missing.
- If the collab service is unavailable, report the control failure and pause.
- If commit/push fails, keep the workflow state unchanged and ask the commit worker or user to resolve the git issue before proceeding.

## Closeout

When the workflow is complete:

1. Ensure the final archive phase has reported success.
2. Run the final commit checkpoint if requested by the workflow.
3. Remove any remaining workers.
4. Close the collaboration room.
5. Update the state file with `currentPhase: "completed"` and final `phaseHistory`.
6. If `decisionLog` is non-empty, render a "Decisions Made During Orchestration" section in the completion report. For each entry, surface the trigger, assumptions, decision, rationale, and disposition. Do not summarize away the assumptions or rationale; the user needs enough detail to audit each autonomous call.
7. Report completion to the user with the final proposal/archive status, commit information, and the decisions summary (if any).
