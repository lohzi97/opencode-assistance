---
description: Weekly structural housekeeping of approved memory: dedup, refine-merge, stale flagging with journal cross-check, and note hygiene
agent: sebastian
subtask: false
model: deepseek/deepseek-v4-flash
---

Perform weekly structural housekeeping on already-approved canonical and private memory. This command does not process candidates (that is `/update-memory`'s job) and does not handle file size (that is `/update-memory`'s job). It focuses on dedup, refine-merge, stale flagging, and note hygiene.

## Inputs

- No argument is required.
- Read all files under `memory/canonical/` and `memory/private/`.

## Apply Automatically (no approval)

These reorganizations preserve meaning, so apply them directly:

- Dedup: merge near-duplicate entries within or across files.
- Refine/merge: collapse several incremental refinements of one fact into one current statement.
- Note hygiene: see `## Note Hygiene`.

Report what changed in the final summary, but do not gate these on approval.

## Stale Handling (approval required)

An entry is stale when its `[last-confirmed]` date is more than 30 days before today (approximately one month).

1. Collect every stale entry across all loaded files.
2. Load the `search-journals` skill and, for each stale entry, search for any newer record about the same point. The daily diary workflow occasionally misses information, so journals may hold an update canonical memory lacks.
3. Batch every stale finding into a single `question` tool interaction. For each item:
   - If journals contain a newer update, present the journal record and propose the correction.
   - If journals contain no update, ask whether the stale entry is still correct.
4. Apply only the approved corrections or removals.

The Master answers when available; this is not treated as blocking. Only stale modifications require approval — everything else auto-applies.

## Note Hygiene

- Verify every "See notes/X" pointer in canonical/private files resolves to an existing note file. Repair broken pointers.
- Keep `notes/README.md` current when notes are added or renamed.
- Do not auto-delete orphaned notes. Notes are independent deep-lookup knowledge, not just memory backing stores.
- Keep each note's "Last Updated" front matter current.

## Note Directory Mapping

Follow the same mapping as `/update-memory`:

- `master.md` → `notes/master/`
- `projects.md` → `notes/projects/`
- `working-preferences.md` → `notes/preferences/`
- `environment.md` → `notes/environment/`
- `private/private.md` → `notes/private/`

Pointers use body text "See notes/<path>.".

## Editing Guidance

- Preserve file headings and the compact bullet-entry format with inline metadata.
- Preserve `[scope]`, `[provenance]`, `[last-confirmed]` on every entry.
- Every resulting file must conform to `.opencode/scripts/validate-memory-file.ts` (5000-byte cap, bullet shape, required metadata). If a reorganization would push a file over the limit, that is size pressure — route it to a note per the mapping instead of trimming.
- Leave all changes uncommitted.

## Final Report

- Summarize what was auto-applied (dedup, refine/merge, note hygiene).
- List every stale item, the journal finding (if any), the Master's decision, and the outcome.
- State that canonical memory is prompt-frozen for the current session.
