---
name: openspec-decompose-prd
description: Decompose a PRD into a sequence of small, atomic OpenSpec changes with proposals, designs, specs, tasks, and a PRD-adjacent implementation sequence. Use when the user asks to analyze a PRD, split a PRD into implementable OpenSpec proposals, or create atomic implementation stages from a requirements document.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: sebastian
  workflow: spec-driven
---

# OpenSpec Decompose PRD

Create an ordered set of independently implementable and independently verifiable OpenSpec changes from a PRD.

## When To Use

Use this skill when the user asks to:
- Analyze a PRD and break it into implementation tasks.
- Decompose a PRD into small OpenSpec proposals.
- Turn a requirements document into an implementation sequence.
- Create multiple related OpenSpec changes from one large product design.

## Non-Negotiable Rules

- Every proposal MUST be independently implementable.
- Every proposal MUST be independently verifiable.
- Do NOT lump testing into a final stage.
- Verification MUST happen at every step through scenarios in specs and concrete test/check tasks in `tasks.md`.
- Prefer actual end-to-end verification (run the real system through its real interface) over static assertions when writing task-level checks.
- Each change MUST reference the original PRD with file path and section or line anchors when available.
- Keep each change atomic: one coherent capability or contract surface per change.
- Respect dependency order, but avoid creating changes that are useless unless all later changes are implemented.
- Do not write implementation code while decomposing.
- If the PRD is ambiguous enough that decomposition would materially change scope, ask focused clarification questions before scaffolding changes.

## Inputs

Expected input:
- A PRD file path, commonly `PRD.md`, or another markdown requirements file.

Optional input:
- Preferred change name prefix.
- Desired granularity.
- Known implementation constraints.

If no PRD path is clear, ask for it.

## Workflow

1. **Read source material**

   Read the PRD fully. Pay attention to every single information.

2. **Inspect OpenSpec conventions**

   Check the local OpenSpec schema and existing conventions:

   ```bash
   openspec templates --json
   openspec list
   openspec/specs/**/*.md
   ```

   If creating artifacts manually, still follow `openspec instructions <artifact> --change <name> --json` for `proposal`, `design`, `specs`, and `tasks`.

3. **Extract capability slices**

   Identify the smallest useful vertical slices from the PRD. Prefer this ordering:
   - Foundations and configuration.
   - Data model and persistence.
   - Core lifecycle APIs.
   - Governance and authorization.
   - Main user-visible workflows.
   - Delivery/execution engines.
   - Edge semantics and failure handling.
   - CLI or wrapper surfaces.

   Each slice should have:
   - A clear capability name.
   - A concrete implementation boundary.
   - Its own API, state, behavior, or user-facing value.
   - Its own verification story.

4. **Reject bad slices**

   Do not create slices like:
   - `add-tests` as a final stage.
   - `implement-backend` or `implement-ui` if too broad.
   - `misc-cleanup`.
   - A pure dependency stub unless it can be verified and provides a stable contract.

5. **Create OpenSpec changes in sequence**

   For each atomic slice:

   ```bash
   openspec new change "<change-name>" --description "<concise description>"
   openspec status --change "<change-name>" --json
   openspec instructions proposal --change "<change-name>" --json
   openspec instructions design --change "<change-name>" --json
   openspec instructions specs --change "<change-name>" --json
   openspec instructions tasks --change "<change-name>" --json
   ```

   Then create all artifacts required for apply readiness.

6. **Write each proposal**

   `proposal.md` must include:
   - Why this slice exists.
   - What changes and what does not.
   - New or modified capabilities.
   - Impacted systems.
   - PRD references, preferably exact line ranges such as `notes/example-prd.md` lines 120-180.

7. **Write each design**

   `design.md` must explain how to implement the slice without depending on unimplemented later behavior. Include goals, non-goals, decisions, and risks.

8. **Write each spec**

   `specs/<capability>/spec.md` must use OpenSpec requirement format:
   - `## ADDED Requirements`, `## MODIFIED Requirements`, etc.
   - `### Requirement: <name>`.
   - `#### Scenario: <name>` with WHEN/THEN bullets.

   Every requirement must have at least one scenario. Scenarios are the first verification layer.

9. **Write each task list**

   `tasks.md` must use checkbox tasks. Every implementation group should include verification alongside the work, for example:

   ```markdown
   ## 1. Core API

   - [ ] 1.1 Implement room creation, then integration-test required fields and persisted state.
   - [ ] 1.2 Add authorization guard, then test allowed and rejected callers.
   ```

   Prefer end-to-end checks that exercise the real system (running server, CLI invocation, actual API/HTTP response, persisted state) over internal unit assertions. Phrase each check so the implementer verifies observable behavior, for example `then start the server and confirm it returns the expected JSON for the new endpoint` rather than `then add a unit test for the handler`. Keep unit assertions only for pure logic with no external surface.

   Do not create a final-only testing group. A verification-only task is acceptable only when it verifies the same slice and appears in that slice's own change.

10. **Create PRD implementation sequence**

   After all OpenSpec changes are created, create `prd-implementation-sequence.md` alongside the PRD file.

   Example: for `notes/agent-collaboration.md`, write `notes/prd-implementation-sequence.md` unless the user asks for a different name.

   The file must include:
   - Source PRD path.
   - Ordered change names.
   - One-line scope for each change.
   - One-line verification summary for each change.
   - Notes on dependency ordering and independent verifiability.

   If a sibling file named `prd-implementation-sequence.md` already exists, ask before overwriting unless the user explicitly requested replacement.

11. **Validate everything**

   Run:

   ```bash
   openspec validate --changes --strict --no-interactive
   openspec list
   ```

   Also search generated artifacts for placeholders:

   ```bash
   rg '<!--|<name>|TODO|FIXME' openspec/changes
   ```

   If validation fails, fix the artifacts before reporting completion.

## Output Report

Report:
- PRD analyzed.
- Number of OpenSpec changes created.
- Ordered implementation sequence.
- Path to `prd-implementation-sequence.md`.
- Validation commands and results.
- Any ambiguity or intentionally deferred scope.

## Quality Checklist

- [ ] Each change can be implemented without editing unrelated later proposals.
- [ ] Each change has at least one spec scenario for each requirement.
- [ ] Each task list embeds verification in the same stage as implementation.
- [ ] No proposal is merely a final testing phase.
- [ ] PRD references are present in every proposal.
- [ ] `prd-implementation-sequence.md` exists beside the PRD.
- [ ] `openspec validate --changes --strict --no-interactive` passes.
