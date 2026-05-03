---
description: Inspect a local file and capture durable memory candidates without promoting them
agent: sebastian
subtask: false
model: deepseek/deepseek-v4-flash
---

Inspect the local text file at `$ARGUMENTS` and use the `memorize` skill to stage any durable memory candidates you can responsibly extract.

## Workflow

1. Validate that `$ARGUMENTS` is present and points to a readable local text file, then read it.
2. Identify only durable, review-worthy information.
3. Classify each item as one of:
   - normal candidate
   - private candidate
   - project-note routing candidate
   - ignore
   - clarification needed
4. Load the `memorize` skill and use it as the shared pending-candidate workflow.
5. Keep the skill's candidate-writing rules unless overridden here:
   - use `source-kind: source-file` instead of `direct-request`
   - include `source-path`
   - use `basis: explicit-source-text` or `inferred-from-source`, whichever fits
   - use a stable source-based filename with one pending candidate file per source, appending on reruns while pending
   - route project-specific rules toward `notes/projects/<slug>.md` rather than canonical memory
   - never extract, store, or ask to store raw secrets from the file
6. Ignore low-value or non-durable content such as raw transcript chunks, debug trails, session TODOs, arbitrary copied commands, large implementation details better suited for notes, and weakly supported claims.
7. Ask concise clarification questions before writing any doubtful candidate.
8. If nothing durable should be captured, say so and do not write any candidate file.
9. Report what was captured, skipped, routed, or left pending, and state clearly that everything remains pending review until `/update-memory`.
