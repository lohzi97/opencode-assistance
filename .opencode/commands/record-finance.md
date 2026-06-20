---
description: Record a one-off or recurring finance transaction into the Beancount ledger
agent: sebastian
model: xiaomi/mimo-v2.5
---

The Master wants to record a finance transaction. Here is what they said:

> $ARGUMENTS

Follow these steps:

1. Load the `master-finance` skill to understand the finance repo structure, account chart, and recording conventions.
2. Determine whether this is a **one-off transaction** or a **recurring subscription/bill** by checking for signals in the Master's input (e.g. "per month", "monthly", "subscribed", "subscription", "recurring", "every month").

## If one-off transaction

1. Consult `config/accounts.yaml` (run `./bin/categories` if needed) to identify the correct expense category, payment method, and any applicable tags.
2. Formulate the proposed Beancount entry with proper date (beancount format `YYYY-MM-DD`), payee, narration, and balanced postings.
3. Present the proposed entry to the Master with a brief rationale for each decision (category, payment method, date, description). Wait for approval before making any changes.
4. After approval, append the entry to the appropriate scope/year ledger file, run `./bin/validate`, and commit + push to the finance repo.

## If recurring transaction

1. Read `~/finance/config/recurring.yaml` to understand the existing recurring item structure. Each item needs: `id`, `description`, `amount`, `from` (payment account), `to` (expense category), `day` (charge day of month), and `start` (first occurrence date in `YYYY-MM-DD`).
2. Ask the Master for any missing details needed to build the recurring entry. Use the `question` tool to confirm:
   - Exact description/payee name
   - Monthly amount (MYR)
   - Payment method (which credit card / bank / wallet)
   - Expense category (propose the best match from `config/accounts.yaml`)
   - Day of month the charge occurs
   - Start date (first occurrence)
3. Formulate the proposed recurring item and show the YAML snippet that will be added to `config/recurring.yaml`, along with a rationale for each decision. Wait for approval.
4. After approval, append the new item to `~/finance/config/recurring.yaml`, then run `./bin/recurring --dry-run` to preview the generated entry. If it looks correct, run `./bin/recurring` (without `--dry-run`) to generate it, run `./bin/validate`, and commit + push to the finance repo.
