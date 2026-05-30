## Why

Questions and answers add explicit unresolved-target coordination on top of ordinary messages, including delivery blockers until responses arrive or are cancelled. This implements PRD lines 185-193, 321-330, and 651-679.

## What Changes

- Add `ask` API requiring explicit aliases or `@everyone` and creating `question_targets`.
- Add `answer` API with first-answer-wins, duplicate rejection, and parent linkage.
- Block buffered delivery to a member while that member has unresolved collab questions in open rooms.
- Cancel unresolved question targets on removal and room closure.

## Capabilities

### New Capabilities
- `collab-questions-answers`: Room questions, answers, unresolved-target blocking, and cancellation semantics.

### Modified Capabilities
- None.

## Impact

- Extends messaging API and delivery eligibility.
- Depends on message transcript, membership cancellation, and immediate delivery.
