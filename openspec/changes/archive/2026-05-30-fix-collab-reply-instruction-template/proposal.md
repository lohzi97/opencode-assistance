## Why

`reply_instruction` is configurable in the collaboration service, but delivery prompt formatting still hardcodes the built-in fallback in several paths. This makes the configuration misleading and prevents room operators from reliably customizing how collaborators are instructed to reply.

## What Changes

- Make configured `collab.reply_instruction` the authoritative template for every collaboration prompt that includes reply guidance.
- Apply the same template rendering semantics already documented for collaboration instructions: support configured `text` or `file`, use fallback only when absent, and replace supported template variables.
- Ensure normal deliveries, combined backlog deliveries, join bootstrap prompts, and spawn-related collaboration injections use the resolved reply instruction consistently.
- Preserve existing fallback behavior when no `reply_instruction` is configured.
- Add tests proving configured reply instructions appear in delivered prompts and fallback text is retained when no config is supplied.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `collab-core`: Clarify that `reply_instruction` configuration is not merely parsed; it must be used wherever collaboration prompt reply guidance is rendered.
- `collab-delivery`: Require every injected collaboration delivery that includes reply guidance to use the resolved configured reply template for the target member.

## Impact

- Affected code: `.opencode/server/collab.ts`, especially template resolution and delivery prompt formatting.
- Affected config: `.opencode/server.jsonc#collab.reply_instruction` becomes operationally reliable.
- Affected tests: `.opencode/server/collab.test.ts` should cover configured and fallback reply-instruction behavior.
- No API shape change is expected; this is a behavior correction for existing configuration.
