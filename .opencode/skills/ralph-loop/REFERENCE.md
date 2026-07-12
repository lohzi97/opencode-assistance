# Ralph Loop — Reference

Concrete lessons from the first production run (implementing a 7-phase bot-observability plan in `cammillion-bot-fleet` via `deepseek-v4-pro/max` `levi` implementers). Read this before running your first loop.

## Lifecycle of a healthy loop

```
setup room -> spawn implementer-1 -> wait -> report -> file changes?
   yes -> remove, spawn implementer-2 -> ... (working tree accumulates work)
   no  -> confirm convergence -> STOP, clean tree
```

Gap-finding should decay across passes. Observed pattern from the first run:

```
pass A: 6 files changed (real gaps: missing redaction keyword, 2 missing models)
pass B: 1 file changed  (thin test coverage)
pass C: 0 changes       (audit only)
pass D: 0 changes       (audit only)  -> converged, stop
```

When the count reaches 0 and the tree is clean and committed, stop.

## Failure mode 1 — spawn crashes with `UnknownError`

Symptom: spawned implementer session throws immediately:

```
UnknownError: UnknownError
    at SessionPrompt.createUserMessage (...)
    at SessionHttpApi.promptAsync (...)
```

Root cause: `--agent` was omitted, so the service derived the planner's agent (e.g. `sebastian`) into a target project that does not define it. Context assembly fails while building the first user message.

Fix: always pass `--agent <name>` where `<name>` exists in `<target>/.opencode/agents/`. Verify before spawning. In the run, the target project only had `levi` and `shalltear`; using `--agent levi` fixed all spawns.

Non-productive failed spawns (crash before any work) do not count toward the iteration cap.

## Failure mode 2 — stopping on a self-assessed "done"

Symptom: an implementer reports "fully implemented and verified, everything works, nothing remains" and you terminate the loop.

Problem: the claim was wrong. In the run, the very next pass independently found 6 real gaps (a missing `password` redaction token — a safety hole — plus two frontend models the plan explicitly required). A single "done" claim is not a stop signal.

Fix: stop only on **zero file changes** in an implementer's own run, confirmed by git. Treat "fully done" prose as unreliable. Prefer a confirming no-change pass before stopping.

## Failure mode 3 — interrupting a working implementer

Symptom: you send a "are you still working?" message to an implementer that is mid-task; it answers, then goes idle and never resumes.

Problem: the interruption ended its turn. The implementer treated your question as completing the interaction.

Fix: do not ping a working implementer. Only nudge on an inactivity notice. If you must check liveness, do it via the inactivity protocol, not proactively.

## Failure mode 4 — removing a quiet implementer too early

Symptom: an inactivity notice fires (default after ~15 min of no member activity); you remove the implementer and respawn.

Problem: inactivity != finished. The implementer may still have been working or may simply have gone quiet between phases. Removing it discards in-flight work and fragments effort.

Fix: on the 1st inactivity notice, send a status-report request and wait. Only on the 2nd consecutive no-reply notice, inspect git/transcript and escalate.

Note: an implementer that is actively running tools registers as busy and suppresses inactivity notices. So an inactivity notice usually means the turn ended or it stalled — but you still ask first, remove second.

## Failure mode 5 — the commit loose-end

Symptom: an early pass leaves valuable verified work uncommitted in the working tree. Every subsequent fresh implementer sees it via `git status`, audits it as complete, but refuses to commit it (the prompt says "commit after *you* have finished implementing," and they treat pre-existing uncommitted work as not theirs). The tree stays dirty indefinitely while implementers keep reporting "no file changes required."

Problem: you can hit a false "no changes" plateau with a dirty tree, and the work never lands.

Fix: when verified-complete work has sat uncommitted across passes, direct a final implementer via a planner `send` message (not a spawn-prompt change): "the task is verified complete; there is complete uncommitted work in the tree — commit all complete verified work so the tree is clean, run the test suite, then report the commit hash and whether anything further was needed." The harness itself does not commit in the target repo.

## Failure mode 6 — present-and-wait stall

Symptom: some implementers reply "ready + understanding + recommended approach" to the join bootstrap and then wait for a go-ahead, producing an inactivity notice without doing work.

Fix: usually self-corrects (the spawn prompt says "implement until finished"). If an implementer stalls this way, the inactivity protocol catches it; nudge it to begin immediately. You may add "begin implementing immediately; do not wait for confirmation" to the spawn prompt with the Master's permission (meaning preserved).

## Objective convergence checks (use these, not the prose)

- `git -C <target> log --oneline -N` — new commits this loop?
- `git -C <target> status --short` — dirty tree? (uncommitted work)
- `git -C <target> diff --stat` — what is uncommitted?
- `git -C <target> rev-list --left-right --count origin/<branch>...HEAD` — ahead/behind origin (is it pushed?)

A clean stop = converged (0 changes across consecutive passes) + clean working tree + work committed.

## Variations

- **Review/verify loop:** instead of "implement," spawn implementers to "audit X against Y and report gaps; fix only if found." Same convergence rule.
- **Adversarial pair:** alternate worker and reviewer models across iterations (worker implements, reviewer critiques). Still one fresh context per iteration.
- **Per-iteration scope:** default is "the whole task each pass" (the working tree carries progress). Atomic-one-task-per-iteration is an alternative for very large tasks, but it needs an external progress file the Master explicitly opted out of here.
