---
name: openspec-orchestrate
description: Drive an OpenSpec proposal through its 8-phase workflow using the deterministic opsx-workflow driver, and supervise it as the planner. Use when the user wants to run an OpenSpec proposal end-to-end (review-proposal, apply, apply-resume, test, code-review, test-regression, align, archive). Covers how to start/pause/continue/resume the driver, how to inspect and troubleshoot it (zombie implementers, stalls, caps), how to intervene via agent-collab when implementers go off-track or file out-of-scope issues, and how to handle room-idle nudges.
license: MIT
compatibility: Requires the opsx-workflow script (.opencode/scripts/opsx-workflow.ts), the agent-collab room service, OpenCode session spawning, the openspec CLI, and the OpenSpec phase skills used by the workflow.
metadata:
  author: openspec
  version: "3.0"
  generatedBy: "1.0.0"
---

# OpenSpec Orchestrate

Run an OpenSpec proposal through its fixed 8-phase workflow using the deterministic `opsx-workflow` driver. The driver owns the plumbing; you (the planner) own judgment, intervention, and troubleshooting.

## Core Principle

**The driver is deterministic; the planner is the judgment layer.**

The driver owns:
- the phase graph (`review-proposal` -> `apply` -> `apply-resume` -> `test` -> `code-review` -> `test-regression` -> `align` -> `archive`),
- spawning one fresh implementer session per phase run,
- deterministic completion checks (git diff for self-heal phases; checkbox counting for apply/test/code-review),
- commit-after-every-session (a dedicated committer session),
- per-loop run caps,
- the final local merge into the base branch.

The planner owns:
- supervising every implementer report,
- answering implementer questions about the project,
- intervening when an implementer goes off-track or files out-of-scope issues,
- cleaning up zombie implementers left by crashed/killed daemon runs,
- editing `tasks.md` / `issue.md` content as a deliberate decision,
- escalating to the Master when blocked or when a decision exceeds planner scope.

The planner does NOT spawn workers, route phases, write orchestration state, or track loop counters. The driver does all of that.

## The opsx-workflow Script

One proposal = one driver run. The driver lives at `.opencode/scripts/opsx-workflow.ts`. It runs as a background daemon, polls the room and the planner session, and emits events to `openspec/.opsx-workflow.log` and state to `openspec/.opsx-workflow-state.json`.

### Commands

```bash
# Launch (creates branch openspec/<proposal>, validates, forks daemon, returns pid)
bun .opencode/scripts/opsx-workflow.ts start <room-id> <proposal-name-or-path> \
  [--project-dir <path>] [--base-branch <name>] \
  [--cap-selfHeal <n>] [--cap-apply <n>] [--cap-testFix <n>] [--cap-codeReviewFix <n>] \
  [--foreground]

# Inspect
bun .opencode/scripts/opsx-workflow.ts status [--project-dir <path>]  # phase, counters, paused flag, recent events
bun .opencode/scripts/opsx-workflow.ts log     [--project-dir <path>]  # tail the event log (always-current)

# Control (daemon still running)
bun .opencode/scripts/opsx-workflow.ts pause    [--project-dir <path>]  # halt at the next phase transition
bun .opencode/scripts/opsx-workflow.ts continue [--project-dir <path>]  # release a pause

# Recovery (daemon has EXITED — error/crash/kill)
bun .opencode/scripts/opsx-workflow.ts resume   [--project-dir <path>]  # re-launch daemon from saved phase index
```

`--project-dir` is required when the proposal lives in a different repo than your planner cwd (e.g. you live in `opencode-assistant` but orchestrate `cammillion-bot-fleet`).

### What the Driver Does Per Phase

For each phase, the driver:
1. Spawns a fresh implementer session into the room with the phase's skill prompt.
2. Polls the room (`--since <spawn-time>` filter) for the implementer's `completion` message.
3. After detecting completion, waits for the room service to deliver the report to your session (as it does for every room message — the driver does NOT do a separate injection), then waits for you to be stably idle, not paused, and not asking the Master a question (`waitForPlannerProceed`).
4. Removes the implementer from the room.
5. Runs a deterministic clean check (see table below).
6. Spawns a committer session to checkpoint the phase's changes (retries if the first commit leaves untracked files).
7. Advances (clean) or loops (not clean), subject to the run cap.

The driver does NOT push to a remote and does NOT delete the feature branch. The merge into the local base branch is its only git write outside the feature branch. Push and branch cleanup are manual planner/Master steps after review.

### Prerequisites

Before launching, verify:
- The `agent-collab` skill is available (it provides the room service and CLI you will use to create the room and communicate with implementers).
- The proposal exists at `openspec/changes/<name>/` with `proposal.md` AND `tasks.md` containing at least one checkbox.
- The target project is on its base branch (`main`/`master`/`dev`) with a clean worktree outside this proposal.
- No stale workflow state or `openspec/<proposal>` branch exists from a prior incomplete run.

### Launch Sequence

**1. Intake.** Understand what the Master wants and why (problem, motivation, scope, constraints). The proposal must already exist under `openspec/changes/<name>/`. Capture the intent mentally; you will use it to answer implementer questions and judge reports.

**2. Create the collaboration room.** Use the `agent-collab` skill to create a room for the target project and join as the planner. The room is the communication channel between you, the implementers the driver spawns, and the notifier bot:

```bash
bun .opencode/scripts/agent-collab.ts room create \
  --name "opsx-<proposal-name>-<YYYYMMDDHHmmss>" \
  --session "$OPENCODE_SESSION_ID" \
  --from planner \
  --project-dir <target-project-dir> \
  --json
```

Record the `room_id` from the response. You are now the room's founder and planner (role=planner, state=active). The driver will validate this membership on `start`.

**3. Start the driver:**

```bash
bun .opencode/scripts/opsx-workflow.ts start <room-id> <proposal-name-or-path> \
  [--project-dir <path>] [--base-branch <name>] \
  [--cap-selfHeal <n>] [--cap-apply <n>] [--cap-testFix <n>] [--cap-codeReviewFix <n>]
```

The driver validates the room/planner/project, creates branch `openspec/<proposal>`, initialises state, forks the daemon, and returns immediately with the driver pid. From here, implementer reports reach you as ordinary room-message deliveries (the room service injects them into your session as user messages, exactly as if you were orchestrating manually).

### Pause vs Resume

- **`pause` + `continue`**: the daemon is still alive. Use for planner interventions (scope creep, course corrections, asking the Master a question). The daemon halts at the next `waitForPlannerProceed` boundary and resumes when you clear the flag.
- **`resume`**: the daemon has EXITED (error, crash, kill, or cap-pause after which you killed it). Re-launches the daemon from the saved phase index. Always investigate `log`/`status` and resolve the root cause before resuming.

## The 8 Phases and Their Completion Checks

| Phase | Skill | Clean = |
| --- | --- | --- |
| review-proposal | `openspec-review-proposal` | session changed zero proposal artifacts (git diff empty) |
| apply | `openspec-apply-change` | all `tasks.md` boxes checked |
| apply-resume | `openspec-apply-resume` | session edited zero files (git diff empty) |
| test | `openspec-test` | `issue.md` has zero unchecked boxes |
| code-review | `openspec-code-review` | `issue.md` has zero unchecked boxes |
| test-regression | `openspec-test` | `issue.md` has zero unchecked boxes (regression pass after code-review fixes) |
| align | `openspec-align` | session changed zero proposal artifacts (git diff empty) |
| archive | `openspec-archive-change` | change moved under `openspec/changes/archive/` |

Loop mechanics:
- **Self-healing phases** (review-proposal, apply-resume, align) edit files directly when they find issues; on dirty they re-run with a fresh session until a run changes nothing.
- **apply** re-runs itself until all `tasks.md` boxes are checked.
- **Finding phases** (test, code-review, test-regression) write issues to `issue.md`; on dirty they spawn fresh `openspec-fix` sessions until every issue is checked, then re-run the finding phase. The phase advances only when a finding run ends with zero unchecked boxes.

### Checkbox-Only Enforcement

Implementers may only toggle `- [ ]` <-> `- [x]` on the locked file for their phase:
- `apply` and `apply-resume` -> `tasks.md` toggles only.
- `fix` -> `issue.md` toggles only.

Any non-checkbox content change to the locked file is **reverted by the driver** and the run is retried (no commit). This prevents the "marked DEFERRED/SKIPPED to fake convergence" cheat.

Content ownership: review-proposal and align may edit proposal artifacts; finder phases (test, code-review) own `issue.md` content (add, uncheck, refine); apply/apply-resume only toggle `tasks.md`; fix only toggles `issue.md`. The planner may edit task/issue content as a decision action (see below).

## Planner Role: Supervision Doctrine

The driver proceeds automatically only after the room service has delivered the completion report to your session (normal room-message delivery — the driver does not do a separate injection) AND you are stably idle, not paused, and not asking the Master a question. Your job is to review each report and act when something is off.

### Read Every Report

For each implementer completion message, ask:
- Did it actually do the work, or did it skip steps (e.g. claimed testing done but skipped end-to-end)?
- Did it silently substitute approach X for the specified Y claiming infeasibility? Is that claim technically real, or laziness?
- Does the report match the deterministic signal (e.g. it claims "all tasks done" but `tasks.md` still has unchecked boxes)?

### Scope-Creep Handling (Critical)

The test and code-review phases file issues in `issue.md`. Not every finding is in scope. **The planner is the scope authority — not the fixer.** When a finder files an issue that is out of scope, too broad, or should be deferred to a separate proposal:

1. **Pause the workflow immediately** (before you go idle, while the finder is still in the room):
   ```bash
   bun .opencode/scripts/opsx-workflow.ts pause --project-dir <path>
   ```
2. **Message the finder via agent-collab** telling it to remove or reword the out-of-scope issue. The finder owns `issue.md` content, so it is the one that must edit it:
   ```bash
   bun .opencode/scripts/agent-collab.ts send \
     --room <room-id> --session "$OPENCODE_SESSION_ID" --from planner \
     --kind note \
     --body "ISSUE-<n> is out of scope for this proposal because <reason>. Remove it from issue.md (delete the checkbox line and its evidence), then confirm."
   ```
3. **Wait for the finder to confirm** the removal. It receives your message as a room delivery, edits `issue.md`, and sends a note back.
4. **Verify** `issue.md` no longer contains the out-of-scope issue.
5. **Resume the workflow**:
   ```bash
   bun .opencode/scripts/opsx-workflow.ts continue --project-dir <path>
   ```

The key timing insight: the finder is removed from the room only AFTER `waitForPlannerProceed` returns (i.e. after you go idle). If you pause during your reaction to the finder's report, the finder stays alive and reachable. You do not need to re-spawn it.

If you already went idle and the finder was removed before you noticed the scope problem, re-spawn a follow-up session with the same alias and a corrective prompt (rare case — attentive planners catch scope creep during the first reaction).

**Why this matters:** without planner scope control, the fix phase is forced to either fix out-of-scope issues (scope creep baked into the merge) or hit the cap (wasted sessions). Neither is correct. The planner is the judgment layer; the fixer is pure execution.

### Always Pause Before Asking the Master

The driver treats "planner idle" as "proceed" (with a belt-and-suspenders guard that also probes the question-request API). To ask the Master a question:

1. `bun .opencode/scripts/opsx-workflow.ts pause [--project-dir <path>]`
2. Ask the Master via the `question` tool.
3. After the Master answers and you've processed the answer, `bun .opencode/scripts/opsx-workflow.ts continue [--project-dir <path>]`.

### Edit Content Only as a Decision

If a task or issue is genuinely technically infeasible and the loop is stuck, you may edit `tasks.md` / `issue.md` content (e.g. mark a task deferred, rewrite an issue's acceptance) to unblock convergence. Make content edits only while the driver is paused between runs (normally at a cap), before the next fresh implementer starts; mid-run edits are indistinguishable from implementer violations and will be reverted. Do this only after investigating, and prefer escalating to the Master for consequential scope changes.

### When the Driver Hits a Cap

When a loop exceeds its run cap, the driver pauses itself and a notifier @mentions you in the room with the phase and cap. Investigate (`status`, inspect `tasks.md`/`issue.md` and the recent commits), then either:
- edit task/issue content to resolve the genuine blocker and `continue`, or
- escalate to the Master.

## Communicating With Implementers via agent-collab

All planner-to-implementer communication goes through the room. You are already a member (as `planner`).

### Send a message (normal delivery)
```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room-id> --session "$OPENCODE_SESSION_ID" --from planner \
  --kind note \
  --body "<message>"
```

### Hard-interrupt an off-track implementer (mid-run)
If an implementer is actively working but going the wrong direction, add `--hard` to force an interrupt:
```bash
bun .opencode/scripts/agent-collab.ts send \
  --room <room-id> --session "$OPENCODE_SESSION_ID" --from planner \
  --kind note --hard \
  --body "<corrective instruction>"
```

### Remove a zombie member
When you discover an orphaned implementer/committer (see Troubleshooting), remove it:
```bash
bun .opencode/scripts/agent-collab.ts member remove \
  --room <room-id> --session "$OPENCODE_SESSION_ID" --from planner \
  --target "<member-name>"
```

### Inspect the room
```bash
bun .opencode/scripts/agent-collab.ts room status --room <room-id> --json   # members, state, activity
bun .opencode/scripts/agent-collab.ts messages    --room <room-id> --json   # message history
```

## Room-Idle Nudges

When no message has been sent to the room for 15 minutes, agent-collab sends an idle notification to the planner. This usually means an implementer is either working on a long task (fine) or has silently stalled (not fine).

When you receive an idle nudge:
1. Check `status` — is the driver still in `waitForImplementerCompletion` for the current phase?
2. Send a status-check message to the current implementer via agent-collab:
   ```bash
   bun .opencode/scripts/agent-collab.ts send \
     --room <room-id> --session "$OPENCODE_SESSION_ID" --from planner \
     --kind note \
     --body "@<implementer-alias> Status check: report current progress and whether you are close to completion."
   ```
3. If the implementer responds with a meaningful progress update, the idle was benign — wait for its completion.
4. If the implementer does not respond within a few minutes, or responds with confusion/no-progress, it may be stuck. Pause the workflow, sort it out the with implementer. Then only continue the workflow. 

Do NOT ignore idle nudges. They are the early-warning system for stalled sessions.

## Troubleshooting

### Zombie Implementer

A zombie is an implementer/committer session left in the room after the daemon was killed or crashed mid-wait. It keeps receiving room deliveries and generating responses, burning LLM budget. **The planner owns zombie cleanup — the daemon's shutdown path does not attempt it.**

Detection:
- `agent-collab room status` shows members whose aliases do not match the current expected phase (e.g. `committer-test-run1-...` lingering during the `align` phase).
- An implementer you do not recognize sends unsolicited notes ("Acknowledged", "Observing") in response to other members' activity.

Resolution:
1. Verify the member is truly orphaned (the daemon that spawned it is dead — check `status` for the current daemon pid, and confirm the orphan's alias does not match any alias the current daemon would spawn).
2. Remove it:
   ```bash
   bun .opencode/scripts/agent-collab.ts member remove \
     --room <room-id> --session "$OPENCODE_SESSION_ID" --from planner \
     --target "<zombie-alias>"
   ```

### Workflow Stuck (No Progress)

If `status` shows the same phase for a long time and no events are being appended to the log:
1. Check if the daemon is alive: `ps -p <pid>`.
2. Tail the log: `bun .opencode/scripts/opsx-workflow.ts log --project-dir <path>`.
3. Check if the driver is blocked in `waitForPlannerProceed` (waiting for you to go idle). If you have been continuously busy, the driver cannot advance — finish your current response and let it proceed.
4. Check if the driver is blocked waiting for the room service to deliver the report to your session (the report was sent but delivery is pending because you were continuously busy — the room service only injects buffered messages when the target session is idle). Same fix: go idle so the delivery can land.
5. If the daemon is dead (crashed/killed), use `resume` after investigating the root cause.

### Driver Error / Crash

If the driver errors, it pauses itself, logs a `driver_error` event, and **exits the daemon process**. `continue` alone cannot recover (no running process reads the flag). Investigate `log` and `status`, resolve the cause, then:
```bash
bun .opencode/scripts/opsx-workflow.ts resume --project-dir <path>
```
`resume` re-launches the daemon and picks up from the saved phase index. Before resuming, check the room for zombie members from the crashed run and clean them up.

Caps, stalls, and merge conflicts do NOT exit the daemon — the driver stays alive and waits inside `waitForPlannerProceed`. For those, `continue` is the correct recovery command after you resolve the cause.

### Merge Conflict

If the `--no-ff` merge at the end fails, the driver aborts the merge, returns to the feature branch, pauses, and notifies you. Resolve the conflict manually in the target project, then `continue` — the driver retries the merge.

### agent-collab Service Down

If the agent-collab service is down, the driver cannot spawn implementers. Report the control failure to the Master. Do not attempt to drive the workflow manually through the phases.

## Escalation to the Master

Escalate when:
- a task/issue is genuinely infeasible and editing content would materially change scope,
- a decision changes external state (credentials, accounts, infrastructure) beyond the proposal's code,
- the driver reports an unrecoverable error you cannot resolve,
- you are blocked beyond your ability to resolve.

Always `pause` before escalating (you will be idle while waiting for the Master's answer).

## Closeout

When the driver completes all phases, it:
1. Verifies the worktree is clean.
2. Checks out the base branch and runs `git merge --no-ff openspec/<proposal>` locally.
3. Does NOT push (the merge is local only).
4. Does NOT delete the feature branch (it preserves the per-phase commit history for inspection).
5. Closes the collaboration room.
6. A notifier @mentions you with the completion summary.

After completion, report to the Master with the proposal name, the local merge, and any decisions you made during the run (interventions, content edits, escalations). The Master decides whether to push and delete the branch.

## Multiple Proposals

The driver handles one proposal at a time. For multiple proposals, run them sequentially: complete and merge one, then `start` the next. Do not parallelise proposals unless the Master explicitly requests it and dependency ordering allows it.
