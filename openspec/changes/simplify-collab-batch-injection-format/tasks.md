## 1. Delivery Formatter

- [x] 1.1 Refactor `.opencode/server/collab.ts` delivery prompt rendering so normal message backlogs share one room header, optional public-message block, `[Message]` transcript block, and final reply instruction.
- [x] 1.2 Render each normal delivered message as `[YYYYMMDDHHmmss|kind] sender:` followed by its body, preserving existing chronological backlog order.
- [x] 1.3 Omit delivery mode labels from normal prompt text while preserving delivery mode storage, routing, and API inspection data.
- [x] 1.4 Keep join bootstrap content first in bootstrap-containing batches and render the reply instruction once at the end of the injected prompt.

## 2. Tests And Validation

- [x] 2.1 Add server tests for compact combined buffered prompts with one room header, one public-message block, one `[Message]` block, ordered timestamped entries, and one reply instruction.
- [x] 2.2 Update existing immediate, hard, configured reply-instruction, and bootstrap delivery tests to match the compact prompt contract without relying on `Delivery:` text.
- [x] 2.3 Run the relevant Bun collaboration test suite and fix any regressions.
- [x] 2.4 Run `openspec validate simplify-collab-batch-injection-format --strict` and fix any proposal/spec issues.
