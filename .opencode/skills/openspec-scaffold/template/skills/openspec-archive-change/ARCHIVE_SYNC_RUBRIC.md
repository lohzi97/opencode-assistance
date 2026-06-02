# Archive Sync Rubric

Use this rubric before syncing OpenSpec delta specs into `openspec/specs/` during archive. The goal is a modular, high-signal, low-blast-radius main spec tree.

## Core Rule

The delta capability folder is a proposal workspace detail, not automatically the final main spec destination. A delta may create a new main spec, merge into an existing one, update an existing requirement, or split across multiple destinations.

## Placement Filters

Evaluate in this order. Stop once a clear decision emerges.

### 1. Deletability And Dependency

Ask: if this feature were removed tomorrow, could one main spec be deleted without leaving another main spec missing its baseline flow?

- If yes, create or keep a separate spec.
- If no, merge or update the parent spec that owns the baseline flow.

### 2. Global Infrastructure Vs Orchestration

For global or ambient behavior that applies across many domains, keep one shared utility spec and reference it instead of duplicating rules.

For transactional interactions, put the rule in the orchestrator's spec, not the passive target's spec.

Example: if hard interrupt flushes older buffered records before injecting, the hard-interrupt behavior belongs with the hard interrupt or delivery orchestration contract. Do not make the passive buffered-delivery capability depend on every future trigger.

### 3. Lifecycle And Drift

Create or keep a separate spec when the feature introduces distinct lifecycle states, timeout loops, permission scopes, or validation mechanics.

Merge or update when the delta only adds a parameter, error case, guard clause, or scenario to an existing lifecycle.

## Size Guardrails

- Fewer than 3 behavioral rules: merge into the closest parent unless lifecycle or permissions are genuinely distinct.
- 3 to 12 behavioral rules: good standalone spec size.
- More than 15 behavioral rules: consider splitting at an orchestrator/target or lifecycle boundary.

## Conflict Defense

- Inspect destination main specs before editing.
- If the destination already has the same requirement heading, do not duplicate it. Merge scenarios or refactor the requirement text cleanly.
- If a delta modifies a requirement that no longer exists in the destination, stop and report a structural sync conflict.
- Do not leave delta headers such as `## ADDED Requirements`, `## MODIFIED Requirements`, or `## REMOVED Requirements` in main specs.
- Main specs must have `## Purpose` and `## Requirements` sections.

## Proposal Format

Before mutating files, present:

```markdown
### Architectural Sync Proposal

1. **Change Summary:** <brief behavior summary>
2. **Target Domains Evaluated:** <existing specs inspected>
3. **Decision:** <CREATE / MERGE / UPDATE / SPLIT>
4. **Destination:** <openspec/specs/.../spec.md>
5. **Risks:** <heading collisions, stale modified targets, split requirements, external dependencies>
```

## Examples

- A close-drain/failure delta should usually modify a delivery-engine spec, not create a tiny `close-drain-failures` main spec.
- Separate CLI room and messaging deltas should usually merge into one `agent-collab-cli` main spec because the CLI is one adapter capability.
- Core room lifecycle, membership, and transcript behavior usually belong together when removing any one would leave the baseline collaboration flow incomplete.
