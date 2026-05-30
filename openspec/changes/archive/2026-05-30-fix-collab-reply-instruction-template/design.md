## Context

The collaboration service already parses `collab.reply_instruction` through the same instruction-source machinery as `spawn_instruction`. The live delivery formatter still hardcodes `FALLBACK_REPLY_INSTRUCTION` in prompt rendering paths, so configured reply instructions are not reliably reflected in injected room prompts.

This creates a mismatch between the configuration contract and runtime behavior. Operators can define `reply_instruction`, but spawned collaborators may still see the fallback text when receiving join bootstrap, buffered, immediate, hard, or combined backlog deliveries.

## Goals / Non-Goals

**Goals:**

- Ensure every collaboration prompt that includes reply guidance uses the resolved configured `reply_instruction` when present.
- Preserve fallback behavior exactly when `reply_instruction` is absent.
- Keep template semantics simple and consistent with existing instruction rendering: `{room}`, `{alias}`, `{role}`, and `{from}` variable replacement only.
- Add regression tests for configured and fallback reply instruction behavior.

**Non-Goals:**

- Add dynamic template functions such as current date, shell command expansion, or environment-variable expansion.
- Change the `reply_instruction` configuration shape.
- Change external HTTP or CLI API shapes.
- Redesign room transcripts or delivery storage beyond what is needed to render reply guidance consistently.

## Decisions

- Resolve reply instructions at delivery-render time instead of persisting rendered text on every delivery row.
  - Rationale: delivery prompts already query current room/member context, and reply instruction is a service-level template rather than message content. Rendering at injection time keeps storage unchanged and avoids migrations.
  - Alternative considered: store rendered reply text in `deliveries`. Rejected because it adds schema and migration complexity for a configuration rendering bug.

- Use the existing `loadTemplate` and `renderTemplate` helpers rather than introducing a second template engine.
  - Rationale: `spawn_instruction` and `reply_instruction` should share behavior. A second renderer would create subtle divergence.
  - Alternative considered: add richer template symbols now. Rejected because the defect is about honoring existing configuration, not expanding template language.

- Thread the resolved reply template into prompt formatting explicitly.
  - Rationale: the current `formatDeliveryPrompt`/`formatDeliverySection` path is synchronous and hardcoded. Passing a resolved template keeps formatting deterministic while avoiding repeated file reads per section.
  - Alternative considered: make all formatting functions async and resolve the file template inside each section. Rejected because it is noisier and would read the same template repeatedly during combined backlog delivery.

## Risks / Trade-offs

- Configured file template read failure could block delivery → rely on existing startup/config resolution behavior where practical and surface delivery failure clearly if the configured file cannot be read.
- Rendering at delivery time means changing `reply_instruction` affects pending deliveries after worker restart → acceptable because collaboration config is operational prompt policy, not immutable transcript content.
- Some stored join bootstrap message bodies currently include fallback reply text → implementation should avoid relying on that stored body for final rendered reply guidance where possible, but existing historical messages may still contain fallback text in transcript history.
