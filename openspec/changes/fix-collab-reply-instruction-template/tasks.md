## 1. Delivery Rendering

- [x] 1.1 Refactor collaboration delivery prompt formatting so it receives a resolved reply-instruction template instead of hardcoding `FALLBACK_REPLY_INSTRUCTION`.
- [x] 1.2 Render reply guidance with the target member variables for normal buffered, immediate, hard, and combined backlog deliveries.
- [x] 1.3 Ensure join bootstrap delivery uses the same resolved reply-instruction template when formatting injected prompts.

## 2. Template Resolution

- [x] 2.1 Reuse existing `loadTemplate` and `renderTemplate` semantics for configured `collab.reply_instruction` text and file sources.
- [x] 2.2 Preserve built-in fallback reply guidance when no `reply_instruction` is configured.
- [x] 2.3 Avoid adding date, command, environment-variable, or other dynamic template expansion beyond existing supported variables.

## 3. Verification

- [x] 3.1 Add tests proving configured text `reply_instruction` appears in injected delivery prompts with rendered target member variables.
- [x] 3.2 Add or update tests proving fallback reply guidance remains when `reply_instruction` is absent.
- [x] 3.3 Add coverage for bootstrap and combined backlog delivery paths if not already exercised by the configured-template tests.
- [x] 3.4 Run the relevant collaboration test suite and OpenSpec validation for this change.
