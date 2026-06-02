---
name: openspec-review-prd-decomposition
description: Review and patch OpenSpec proposals generated from a PRD by comparing the original PRD, PRD implementation sequence, and all generated change artifacts. Use when checking output from openspec-decompose-prd, auditing PRD coverage gaps, or reconciling generated OpenSpec proposals back to the source requirements.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: sebastian
  workflow: spec-driven
---

# OpenSpec Review PRD Decomposition

Audit an OpenSpec decomposition against its original PRD, identify missed requirements or decomposition gaps, and patch the generated OpenSpec artifacts.

## When To Use

Use this skill when the user asks to:
- Review proposals created by `openspec-decompose-prd`.
- Check whether generated OpenSpec changes fully cover a PRD.
- Find missing gaps between a PRD and the decomposed proposal set.
- Patch OpenSpec proposal artifacts according to the original PRD.

## Core Rules

- Read and understand the original PRD before judging proposals.
- Read the PRD implementation sequence before reading individual changes.
- Review every generated change listed in the implementation sequence.
- Patch artifacts to match the PRD; do not merely report gaps unless the user asks for review-only mode.
- Patch `proposal.md`, `design.md`, `specs/**/*.md`, and `tasks.md` as needed.
- Preserve independent implementability and independent verifiability for every proposal.
- Do NOT move missed verification into a final testing stage.
- Add verification to the same proposal that owns the behavior.
- Do not implement application code.
- Ask focused clarification questions only when the PRD itself is ambiguous or contradictory.

## Inputs

Expected input:
- Original PRD path.
- PRD implementation sequence path, commonly `prd-implementation-sequence.md` beside the PRD.

Optional input:
- Specific change names to audit first.
- Review-only mode, if the user does not want patches.

If paths are unclear, infer obvious sibling paths. If still unclear, ask.

## Workflow

1. **Load source context**

   Read the full PRD. Extract requirements, exclusions, edge cases, APIs, data models, security rules, lifecycle rules, and testing requirements.

   Then read `prd-implementation-sequence.md`. Confirm it lists ordered change names, scope summaries, and verification summaries.

2. **Discover generated changes**

   Use the sequence file first. Cross-check with OpenSpec:

   ```bash
   openspec list
   openspec status --change "<change-name>" --json
   ```

   If the sequence references missing changes, report the mismatch and ask before inventing replacements unless the PRD clearly requires a missing atomic change.

3. **Read every proposal artifact**

   For each change, read:
   - `proposal.md`
   - `design.md`
   - `specs/**/*.md`
   - `tasks.md`
   - `.openspec.yaml` when needed

   Prefer `openspec instructions apply --change "<change-name>" --json` when useful to discover context files.

4. **Build a PRD coverage map**

   Create a working map with:
   - PRD requirement or section.
   - Expected behavior.
   - Covering change name and artifact path.
   - Coverage status: covered, partial, missing, conflicting, or unclear.

   Include non-functional requirements, exclusions, retention rules, failure handling, security constraints, and test requirements. These are often where lesser decompositions fail. A butler who ignores edge cases is merely furniture with opinions.

5. **Identify decomposition defects**

   Look for:
   - PRD requirements with no proposal coverage.
   - Requirements mentioned in `proposal.md` but missing from specs or tasks.
   - Specs without verification scenarios.
   - Tasks that implement behavior without verifying it.
   - Verification deferred to a final stage.
   - Atomicity problems where one proposal depends on unimplemented later behavior.
   - Ordering problems in `prd-implementation-sequence.md`.
   - Conflicts with explicit PRD exclusions.
   - Missing PRD references.

6. **Patch the correct artifacts**

   Patch the smallest correct set of files:
   - Update `proposal.md` when scope, why, capability, impact, or PRD references are missing.
   - Update `design.md` when decisions, non-goals, risks, or dependency boundaries are incomplete.
   - Update `specs/**/*.md` when normative requirements or scenarios are missing or wrong.
   - Update `tasks.md` when implementation or verification steps are missing.
   - Update `prd-implementation-sequence.md` when order, scope summaries, verification summaries, or missing changes need correction.

   If a missed PRD requirement deserves a new atomic change rather than being forced into an existing proposal, create a new OpenSpec change using the same artifact process as `openspec-decompose-prd`, then add it to the sequence file.

7. **Maintain verification locality**

   Every patched requirement must have local verification:
   - At least one `#### Scenario:` in the owning spec.
   - At least one concrete test/check task in the owning `tasks.md`.
   - No final-only testing bucket.

8. **Validate after patching**

   Run:

   ```bash
   openspec validate --changes --strict --no-interactive
   openspec list
   ```

   Search for unresolved placeholders:

   ```bash
   rg '<!--|<name>|TODO|FIXME' openspec/changes
   ```

   If validation fails, fix artifacts before reporting completion.

## Patch Standards

- Keep patches minimal and traceable to the PRD.
- Do not expand scope beyond the PRD unless the user confirms it.
- Preserve the original decomposition where it is correct.
- Prefer adding missing scenarios and tasks over rewriting entire proposals.
- When adding a new change, make it independently implementable and independently verifiable.
- Keep OpenSpec requirement headers and `#### Scenario:` formatting exact.

## Output Report

Report:
- PRD path and sequence path reviewed.
- Number of changes reviewed.
- Gaps found, grouped by severity.
- Files patched and why.
- New changes created, if any.
- Validation commands and results.
- Remaining ambiguities or explicit non-actions.

## Quality Checklist

- [ ] Original PRD was read fully.
- [ ] Implementation sequence was read and cross-checked.
- [ ] Every listed change was reviewed.
- [ ] Every PRD requirement is covered, explicitly excluded, or called out as ambiguous.
- [ ] Every patched behavior has spec scenarios and task-level verification.
- [ ] No verification was deferred to a final-only stage.
- [ ] `prd-implementation-sequence.md` remains accurate.
- [ ] `openspec validate --changes --strict --no-interactive` passes.
