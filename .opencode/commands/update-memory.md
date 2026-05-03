---
description: Review pending memory candidates, prepare a promotion plan, and apply approved updates
agent: sebastian
subtask: false
model: deepseek/deepseek-v4-flash
---

Review all pending memory candidates, build a grouped promotion plan, and apply approved updates only after explicit confirmation in this conversation.

## Goal

- Process candidate files from `memory/candidates/` and `memory/private-candidates/`.
- Present a grouped plan, rationale, confidence, note-routing, and patch-style diff before any write.
- Apply changes only after explicit approval.
- Delete fully processed candidate files after successful application.

## Inputs

- No argument is required.
- If `$ARGUMENTS` is present, treat it as a narrow filter for candidate filenames or target files.

## Load Inputs

1. Read all files under `memory/candidates/` and `memory/private-candidates/`, excluding `.gitkeep`.
2. Read `memory/canonical/master.md`.
3. Read `memory/canonical/working-preferences.md`.
4. Read `memory/canonical/environment.md`.
5. Read `memory/canonical/projects.md`.
6. Read `memory/private/private.md` if it exists.
7. Read any note files directly referenced by candidate `note-path-suggestion` values if those files already exist.

## Normalize And Classify

For each candidate entry:

1. Parse the normalized fields.
2. Determine whether the entry is explicit or inferred.
3. Determine whether it should be treated as add, refine, remove, ignore, or note-routing.
4. Determine whether project scoping applies.
5. Determine whether the final destination is:
   - `memory/canonical/master.md`
   - `memory/canonical/working-preferences.md`
   - `memory/canonical/environment.md`
   - `memory/canonical/projects.md`
   - `memory/private/private.md`
   - a note under `notes/`
6. Assign a confidence label in the review output only: `high`, `medium`, or `low`.

## Review Rules

- Candidates are pending artifacts, not runtime truth.
- Prefer distilled statements, not copied prose.
- Keep project-specific operating rules out of canonical memory and route them to `notes/projects/<slug>.md`.
- If a candidate conflicts with existing memory or is ambiguous, batch the clarifications and ask with the `question` tool before proposing promotion.
- Do not mine journals or notes automatically in v1 beyond directly referenced note paths already named in candidates.

## Present Review Output

Before any write, show the Master:

1. A grouped plan by target file.
2. Proposed add, refine, remove, and ignore decisions.
3. Normalized statements.
4. Provenance.
5. Confidence assessment.
6. Note-routing decisions.
7. A patch-style diff for each target file.
8. Any clarification items.

If clarification is needed, ask it with the `question` tool and then continue the review in the same conversation with the answers applied.

## Approval Gate

Do not modify canonical memory, private memory, notes, or candidate files until the Master explicitly approves the plan.

If approval is not given, stop after presenting the plan.

If approval is given, continue in the same conversation and apply the changes.

## Apply Changes

On approval:

1. Update the relevant canonical and private memory files.
2. Create or update notes only when deeper detail is useful.
3. Keep memory files concise and within validator rules.
4. Leave changes uncommitted.
5. Delete fully processed candidate files.
6. If any candidate file contains explicitly deferred unresolved items, keep only the unresolved remainder.

## Practical Editing Guidance

- Use the existing compact bullet-entry format with inline metadata for canonical and private files.
- Preserve file headings.
- Preserve unrelated existing entries.
- For removals, delete or refine only the targeted remembered statement.
- For project-note routing, prefer `notes/projects/<slug>.md`.
- For non-project supporting detail, choose a sensible freeform note path under `notes/`, such as `notes/preferences/`, `notes/environment/`, `notes/people/`, or `notes/relationship/`.

## Final Report

- State what was approved and applied.
- State which candidate files were deleted or retained.
- Mention that canonical memory is effectively prompt-frozen for the current session and will be reliably present in a fresh session.
