---
name: prioritize-tasks
description: Prioritize and schedule Master's tasks against the locked life vision and real weekly time budget. Use when running the daily-focus, weekly-focus, or monthly-recalibrate proactive workflows, or whenever Master asks "what should I do today / this week", "help me prioritize", "what's my focus", "reprioritize", or makes any daily/weekly planning request.
---

# Prioritize Tasks

The operating system for deciding what Master works on day to day. Three workflows rely on this skill:

- `/daily-focus` — daily 06:00 proposal of 1-3 tasks sized to today's window; on Master's pickup, block them on Google Calendar.
- `/weekly-focus` — Sunday 14:00, set Focus This Week for the upcoming week.
- `/monthly-recalibrate` — last Sunday 15:00, full ledger tune-up + goals-drift check.

## Context to load (in order, every run)

1. `notes/master/ideal-life-vision.md` — the locked end-state vision + phased timeline.
2. `notes/master/goal-roadmap.md` — short/medium/long goals + the prioritization principles.
3. `~/obsidian/Todo Ledger.md` — the live task list + Focus This Week.
4. `notes/master/time-budget.md` — the weekly capacity model (windows, gym, energy).
5. `notes/master/banking-and-finance.md` — for financial-impact judgement + trading risk tolerance.
6. If a financial commitment is in play, also load the `financial-decision` skill.

## Prioritization axioms (from goal-roadmap — non-negotiable)

1. **Trading edge is THE #1 priority.** The EURUSD forex MT5 strategy revival + martingale tail-risk overlay get the prime deep-work blocks first, every time.
2. **Subtraction is first-class.** Finishing/sunsetting work buys back hours; treat it as real progress.
3. **Few goals, sharply sequenced.** Never stack more than one P2 into a single weekday evening — except for a short deadline-driven sprint (a hard external deadline within the week). Then stacking is allowed: flag it explicitly in the proposal and cap total hours to the window.
4. **Every task must map to a roadmap goal** — or it is a candidate for subtraction.
5. **Weekends = deep work; weekday evenings = chunked/admin.** Match task type to slot energy.

## Computing today's capacity

### Gym-week parity (stateless — no manual tracking)

Anchor: **the week of 2026-08-10 (Mon) = STRENGTH week.** Parity flips each week. Compute:

```bash
anchor=20260810; today=$(date +%Y%m%d)
weeks=$(( ( $(date -d "$today" +%s) - $(date -d "$anchor" +%s) ) / 604800 ))
parity=$(( weeks % 2 ))   # 0 = strength week, 1 = cardio week
```

### Gym today?

- Cardio week (parity 1): Mon / Wed / Fri — 1 hr.
- Strength week (parity 0): Tue / Fri — 1.5 hr.
- Skip if today is a public holiday.

### Today's side-work window

- **Work day:** window = work-end (+ gym if a gym day) → ~20:30-21:30 drive-home. Light dinner (no time loss). Location = cafe → coding/writing/planning fit; hardware/building = weekend only.
- **Weekend / PH:** full day. Prime deep-work ~11:00-18:00, **peak sharpness 12:00-17:00.** Target 4-6 productive hrs. Naps possible.
- **Order tasks by energy within the window.** Harder/deeper work goes in the freshest (earliest) slot; light/admin after. Don't claim a task needs "freshest/peak energy" unless it genuinely does — keep the blocking order consistent with that claim.

### Public-holiday check

Query Google Calendar `en.malaysia#holiday@group.v.calendar.google.com` (via `get_events`, time window = today) for a holiday event. DotDash is Selangor-based: national holidays always apply; for state-specific holidays, confirm Selangor observance before treating as a day off.

## Calendar integration

- **ALWAYS use `user_google_email=sebastian.lohzi97@gmail.com`** for every `google-workspace` MCP call (Sebastian's authenticated account). For Master's calendar, set `calendar_id=lohzi97@gmail.com`. **Never** pass `lohzi97@gmail.com` as `user_google_email` — that triggers an interactive browser OAuth prompt on Master's machine and violates the anti-bot OAuth preference (`memory/canonical/working-preferences.md`). The same rule applies to the public-holiday calendar query.
- Use `manage_event` (action: `create`) to block a chosen task. Sensible duration from the proposed window; title = the task; set an **explicit reminder** (e.g., 15 min before) — don't rely solely on default reminders.
- If Master has blocked a rest/nap slot, respect it and don't propose work over it.

## Ledger hygiene

- When Master gives a concrete task breakdown (sub-items + deadline + end-state), write it to `~/obsidian/Todo Ledger.md` under the relevant project as part of the flow — don't leave it only on the calendar. The ledger is the source of truth.

## Daily proposal output format

1. **Context line:** `Tue, strength week, gym today (1.5hr) → ~1.75-2.75hr evening window at cafe.`
2. **1-3 proposed tasks**, each: `[Pn] task — serves <goal>; ~Xhr.` Lead with the #1 priority if it fits; otherwise the most urgent time-bound item.
3. **Reply prompt:** `Reply with the number(s) you want and I'll block your calendar. Say "tired" and I'll lighten it, or steer me differently.`

## Handling "I'm tired" / reprioritization

If Master reports low energy at any point, immediately drop to light/admin tasks (finance sign-off, reminders, diary, small freelance wrap-up) or propose a rest block. **Never push a deep-work task onto a low-energy day.** Master may also ask to reprioritize mid-day — re-run the selection against the remaining window.

## Cadence (the proactive tasks that invoke this skill)

- Daily 06:00 → `/daily-focus`.
- Sunday 14:00 → `/weekly-focus` (set Focus This Week; commit + push the ledger).
- Last Sunday 15:00 → `/monthly-recalibrate` (full tune-up + goals-drift check; commit + push).
