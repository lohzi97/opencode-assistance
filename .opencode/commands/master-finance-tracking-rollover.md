---
description: Summarize the finance tracking anchor conversation for rollover into a fresh session
agent: sebastian
model: xiaomi/mimo-v2.5
---

The finance tracking anchor session is approaching its context limit and must roll over into a fresh session. Summarize everything so no transaction data is lost.

## Instruction

Review the full conversation in this session and produce a concise, factual summary. Every transaction detail must be preserved.

## Output Format

### Week Range

The YYYYMMDD to YYYYMMDD dates this session covers.

### Transactions Recorded

List every transaction recorded so far this week. One line per transaction including: date, amount, description, payment method (from account), expense category. For example:
- 20260616 | RM 13.50 | Nasi lemak lunch at Restoran Ali | TnG | Food
- 20260616 | RM 18.00 | Grab to office | TnG | Transport

### Pending / Unresolved Items

- Any transactions the Master mentioned but were not yet fully recorded (missing info, awaiting confirmation).
- Any receipts not yet processed.

### Conversation Notes

- Any ongoing threads, questions from the Master, or follow-ups.
- Any corrections or adjustments made during the week.

## Constraints

- Preserve all transaction details. Do not lose amounts, dates, or categories.
- Be precise with numbers — every sen matters.
- Do not interpret or add commentary. Stick to the facts.
