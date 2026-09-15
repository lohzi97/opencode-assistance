---
description: Review pending memory candidates, triage them with the Master, and apply approved updates
agent: sebastian
subtask: false
model: deepseek/deepseek-v4-flash
---

Review all pending memory candidates, let the Master decide which to promote, drop, or ignore, then build a promotion proposal for the promoted entries and apply it only after explicit approval in this conversation.

## Goal

- Process candidate files from `memory/candidates/` and `memory/private-candidates/`.
- Triage every entry with the Master (promote / drop / ignore) before any deep analysis.
- Build a grouped proposal (plan, rationale, confidence, note-routing, patch-style diff) for promoted entries only.
- Apply changes only after explicit approval.
- Delete fully processed candidate files; retain only ignored entries.

## Inputs

- No argument is required.
- If `$ARGUMENTS` is present, treat it as a narrow filter for candidate filenames or target files.

## Phase 1: Load And Light Pre-Scan

1. Read all files under `memory/candidates/` and `memory/private-candidates/`, excluding `.gitkeep`.
2. Read `memory/canonical/master.md`, `memory/canonical/working-preferences.md`, `memory/canonical/environment.md`, `memory/canonical/projects.md`, and `memory/private/private.md` if it exists.
3. Do NOT deep-read referenced notes yet; that happens in Phase 3 for promoted entries only.

For each candidate entry, prepare the triage record:

1. Parse the normalized fields.
2. Determine whether the entry is explicit or inferred.
3. Determine the suggested destination (a canonical file or a note under `notes/`) and whether project scoping applies.
4. Flag red flags from the light pre-scan only:
   - conflict with existing memory,
   - ambiguity that needs clarification,
   - size pressure (adding would push a canonical/private file over the 5000-byte cap, likely triggering reorganization).
5. Assign a provisional confidence label (`high`, `medium`, `low`) for display in the triage table.

## Phase 2: Triage With The Master

Present a compact table, one row per entry: id, distilled statement, suggested destination, and red flags. Keep rows tight; do not paste candidate prose.

Then ask with the `question` tool in a single call (one question per entry):

- Promote: include in the proposal phase.
- Drop: discard the entry permanently; it is not worth remembering.
- Ignore: keep the candidate pending for a later review round.

For entries flagged as conflicting or ambiguous, include a "Discuss" option; after triage, batch the clarifications with the `question` tool and fold the answers into the proposal.

## Phase 3: Proposal For Promoted Entries Only

Deep-read the canonical layer and the note files directly referenced by promoted entries, plus any notes needed for size-pressure reorganization. Do not mine journals or notes beyond those.

Present, before any write:

1. A grouped plan by target file.
2. Proposed add, refine, remove, and note-routing decisions.
3. Normalized distilled statements.
4. Provenance.
5. Confidence assessment.
6. Note-routing decisions.
7. A patch-style diff for each target file, including the byte budget (current size, projected size) so the 5000-byte cap is visible.
8. Any clarification items.

If clarification is needed, ask it with the `question` tool and then continue the review in the same conversation with the answers applied.

## Review Rules

- Candidates are pending artifacts, not runtime truth.
- Prefer distilled statements, not copied prose.
- Keep project-specific operating rules out of canonical memory and route them to `notes/projects/<slug>.md`.
- If a promoted candidate conflicts with existing memory or is ambiguous, batch the clarifications and ask with the `question` tool before proposing promotion.

## Approval Gate

Do not modify canonical memory, private memory, notes, or candidate files until the Master explicitly approves the plan.

If approval is not given, stop after presenting the plan.

If approval is given, continue in the same conversation and apply the changes.

## Reorganize On Size Pressure

Canonical and private memory files are capped at 5000 bytes by the `file-check` plugin (`.opencode/scripts/validate-memory-file.ts`). When a write is rejected for exceeding that limit, or when adding an entry would clearly push a file over it, do not default to trimming. Prefer reorganization:

1. Find a topical cluster of two or more related existing entries whose combined detail is large and self-contained (for example banking, health, commute, or roles in `master.md`).
2. Create or append a note under the matching notes subdir (see mapping below) holding the full detail, preserving provenance and last-confirmed so origin stays traceable.
3. Replace those entries in the canonical file with one condensed summary bullet that links to the note.
4. Add the new entry and retry.

Trimming punctuation, abbreviation, or dropping older facts remains a valid tool when it genuinely improves clarity, but it is the fallback, not the reflex. The preferred response to size pressure is moving volume into notes.

### Note Directory Mapping

Each canonical/private file links out to its own notes subdir, created on demand:

- `master.md` → `notes/master/`
- `projects.md` → `notes/projects/`
- `working-preferences.md` → `notes/preferences/`
- `environment.md` → `notes/environment/`
- `private/private.md` → `notes/private/`

Pointers use body text "See notes/<path>." to match the existing `projects.md` convention.

## Apply Changes

On approval:

1. Update the relevant canonical and private memory files.
2. Create or update notes only when deeper detail is useful.
3. Keep memory files concise and within validator rules; validate every touched canonical/private file with `bun run .opencode/scripts/validate-memory-file.ts <file>`.
4. Leave changes uncommitted.
5. Delete candidate files whose entries were all promoted or dropped; rewrite files that still contain ignored entries to keep only the unresolved remainder.

## Practical Editing Guidance

- Use the existing compact bullet-entry format with inline metadata for canonical and private files.
- Preserve file headings.
- Preserve unrelated existing entries.
- For removals, delete or refine only the targeted remembered statement.
- Link out to notes selectively: only when a cluster carries substantial detail worth a standalone note. Do not force a link on every terse single fact.
- `projects.md` keeps its existing always-link habit (every project entry points to a project note).
- When linking out, follow the Note Directory Mapping in `## Reorganize On Size Pressure`.

## Final Report

- State what was triaged (promoted / dropped / ignored), what was approved and applied.
- State which candidate files were deleted or retained.
- Mention that canonical memory is effectively prompt-frozen for the current session and will be reliably present in a fresh session.
