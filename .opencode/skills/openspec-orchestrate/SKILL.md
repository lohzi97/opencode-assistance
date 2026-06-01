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

- workflow state
- phase transitions
- worker spawning and removal
- commit checkpoint decisions
- reporting to the user

The worker owns:

- loading the assigned `openspec-*` skill
- executing that skill's workflow
- reporting the result

Commit workers are also workers. They own git inspection, staging, commit-message selection, committing, and pushing when authorized by the planner assignment.

## Important Command Mapping

Messages sent through `agent-collab` cannot trigger OpenCode slash commands. Do not ask workers to run `opsx-*` commands.

Ask workers to load and use the corresponding skill instead:

| User command | Worker skill |
| --- | --- |
| `opsx-propose` | `openspec-propose` |
| `opsx-review-proposal` | `openspec-review-proposal` |
| `opsx-decompose-prd` | `openspec-decompose-prd` |
| `opsx-review-prd-decomposition` | `openspec-review-prd-decomposition` |
| `opsx-apply` | `openspec-apply-change` |
| `opsx-apply-resume` | `openspec-apply-resume` |
| `opsx-test` | `openspec-test` |
| `opsx-fix` | `openspec-fix` |
| `opsx-code-review` | `openspec-code-review` |
| `opsx-discuss` | `openspec-discuss` |
| `opsx-align` | `openspec-align` |
| `opsx-archive` | `openspec-archive-change` |

If a corresponding skill is not available, stop and report the missing skill before spawning a worker for that phase.

## Intake

Before creating or using a room, establish the orchestration inputs. Ask the user only for missing details that cannot be safely inferred.

Required inputs:

- Target project directory.
- Workflow mode: `brownfield` or `greenfield-prd`.
- Proposal name, feature request, or bug report for brownfield work; PRD path for greenfield decomposition.
- Starting phase, unless the user clearly wants to start from the beginning.
- Code review mode: `disabled`, `enabled`, or `auto-skip-non-code`.
- Commit mode: `disabled`, `ask_each_checkpoint`, or `auto_at_checkpoints`.
- Push mode: `disabled`, `ask_each_checkpoint`, or `auto_with_commit`.
- Loop mode: `auto_continue_until_blocked` or `ask_after_each_phase`.

Default to:

- Code review mode: `auto-skip-non-code`.
- Commit mode: `ask_each_checkpoint`.
- Push mode: `ask_each_checkpoint`.
- Loop mode: `auto_continue_until_blocked`.

Do not assume commit or push authorization from the existence of checkpoint guidance. Commit and push only according to the selected modes.

For brownfield work, a proposal name is required only when starting from an existing proposal. If the user gives a new feature request or bug report instead, start at `proposal_needed` with `openspec-propose` and capture the proposal name from the worker's report before continuing to proposal review.

For greenfield PRD work, capture the proposal queue from `prd-implementation-sequence.md` after PRD decomposition and decomposition review are complete. Process one proposal at a time through the brownfield state machine.

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

The worker does not need the project path, change id, phase, global workflow, reporting schema, or orchestration rules in the room public message. Spawn the worker in the correct project directory and send the immediate assignment directly.

## Worker Assignment Pattern

Spawn a worker with a narrow alias and role for the current phase. Use the same project directory as the target project.

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
5. Remove the worker from the room before starting the next worker.

Removing a worker from the room removes it from collaboration context; it is not a guarantee that the spawned OpenCode session process is terminated. Do not rely on removed workers for future context.

If the worker asks a tracked question, answer through `agent-collab answer --parent <message_id>` or ask the user if the decision belongs to the user.

Use hard interrupts only when a worker is clearly stuck or running the wrong task.

## Planner Guardrails

- Stay purely orchestrational.
- Do not inspect implementation diffs after worker changes files.
- Do not independently review changed files unless explicitly asked by the user.
- Do not inspect git status or git diff as the planner for commit preparation; delegate that to the commit worker.
- Do not personally stage, commit, or push. Use a commit worker whenever checkpoint commits are enabled.
- Act on worker reports, not planner-side implementation analysis.
- Do not let a worker choose the next phase; workers may recommend, but the planner decides.
- If a worker report is unclear, spawn a fresh reviewer or ask a clarification instead of guessing.
- Keep one active worker per phase unless the user explicitly requests parallel review.
- Remove completed workers from the room before spawning the next phase worker.
- Keep room public context minimal or absent.

## Phase State Machine

The planner should track the workflow as explicit states with allowed transitions.

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
  -> quality_fix_if_needed
  -> final_test_if_fixed
  -> alignment
  -> archive
  -> completed
```

Recommended transitions:

- `proposal_needed` uses `openspec-propose`.
- `proposal_review` uses `openspec-review-proposal` repeatedly until no material gaps remain.
- If `openspec-propose` creates or renames the change, capture the canonical proposal name from the worker report and use that name for all later phases.
- After proposal review reports ready, trigger the proposal-ready commit checkpoint according to commit and push modes.
- `implementation` uses `openspec-apply-change`.
- `implementation_review` uses `openspec-apply-resume` repeatedly until the implementation matches the proposal.
- After implementation review reports ready, trigger the initial-implementation commit checkpoint according to commit and push modes.
- `testing` uses `openspec-test`.
- If testing fails or updates `issue.md`, go to `fixing` with `openspec-fix`, then return to `testing`.
- If testing passes and code review is disabled, trigger the tested-implementation commit checkpoint according to commit and push modes, then proceed to `alignment`.
- If testing passes and code review is enabled, go to `optional_code_review`.
- If code review is not applicable, proceed to `alignment`.
- If code review finds new issues, repeat `optional_code_review` until no new issues are found.
- If code review finds no new issues but unresolved code-review issues remain in `issue.md`, run one `quality_fix` with `openspec-fix` to address the accumulated issues.
- After `quality_fix`, run `final_test` with `openspec-test`.
- If final test fails or updates `issue.md`, go to `fixing` with `openspec-fix`, then return to `testing` and re-enter the code-review decision from a passing test.
- If final test passes after quality fix, trigger the post-quality-fix tested commit checkpoint according to commit and push modes, then proceed to `alignment`.
- If code review finds no new issues and no unresolved code-review issues remain, proceed to `alignment` without a quality-fix pass.
- After `alignment` reports complete, trigger the aligned-proposal commit checkpoint according to commit and push modes.
- After alignment, run `archive` with `openspec-archive-change`.
- After archive reports complete, trigger the archive-complete commit checkpoint according to commit and push modes.
- If commit mode is `ask_each_checkpoint`, ask the user before spawning a commit worker at each checkpoint.
- If commit mode is `auto_at_checkpoints`, spawn a commit worker at checkpoints without asking.
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

Run PRD decomposition review repeatedly until no material PRD coverage gaps remain.

## Optional Code Review Loop

Code review is optional and applies only to projects with implementation code or technical artifacts.

When enabled, use this loop after `openspec-test` passes:

```text
openspec-test PASS
  -> openspec-code-review
  -> repeat openspec-code-review until no new quality issues are added to issue.md
  -> if unresolved review issues exist, openspec-fix for accumulated code quality issues
  -> if fixed, openspec-test final verification
  -> if final test fails, openspec-fix and return to normal testing loop
  -> openspec-align
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

Do not override the detailed report format of each `openspec-*` skill. If the planner needs a compact orchestration signal, ask the worker to include this footer:

```text
Orchestration signal:
Outcome: ready | repeat | issues_found | fixed | passed | failed | blocked | not_applicable
Changed files: yes | no | unknown
Issue file updated: yes | no | not_applicable
Recommended next phase: <phase>
Blocking question: <question or none>
```

The signal is for planner routing only. The full skill report remains authoritative for phase details.

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

### Notes
<brief operational notes only>
```

Do not include implementation-level details unless they are present in the worker report and relevant to the user's decision.

## Failure Handling

- If a worker reports `blocked`, ask the user or spawn a discussion worker with `openspec-discuss`.
- If a worker runs the wrong skill or changes unrelated files, stop the workflow and report the incident.
- If a required skill is unavailable, stop and report which skill/command must be created.
- If the collab service is unavailable, report the control failure and pause.
- If commit/push fails, keep the workflow state unchanged and ask the commit worker or user to resolve the git issue before proceeding.

## Closeout

When the workflow is complete:

1. Ensure the final archive phase has reported success.
2. Run the final commit checkpoint if requested by the workflow.
3. Remove any remaining workers.
4. Close the collaboration room.
5. Report completion to the user with the final proposal/archive status and commit information.
