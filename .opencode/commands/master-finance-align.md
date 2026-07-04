---
description: Reconcile a finance account against attached transaction records and align Beancount to the real balance
agent: sebastian
model: xiaomi/mimo-v2.5
---

The Master wants to reconcile a finance account against attached transaction records.

Target account from the command arguments:

`$ARGUMENTS`

Follow this workflow exactly.

## Goal

Align the specified Beancount account to the attached real-world transaction record and the Master's stated current balance.

The attached files may be CSV, PDF, screenshots, or images. Use them as the source of truth for the account's real cash movement over the covered period.

## Step 1: Prepare

1. Load the `master-finance` skill.
2. If `$ARGUMENTS` is empty or ambiguous, ask the Master which account to align.
3. Map the supplied account name to the exact Beancount account.
4. If no transaction record is attached, ask the Master to attach it before proceeding.

## Step 2: Read the Attached Record

1. Read the attached transaction file(s).
2. Extract a normalized transaction list with:
   - date
   - description / merchant / payee
   - amount with sign
   - transaction type if available
   - reference number if available
3. If a file is partially unreadable, say so clearly and ask only for the missing portion.

## Step 3: Compare Against Beancount

1. Read the relevant ledger entries for the target account from `~/finance/`.
2. Compare the normalized statement/export against Beancount.
3. Categorize findings into:
   - missing from Beancount
   - recorded incorrectly in Beancount
   - likely date mismatches
   - likely description mismatches
   - extra Beancount-only entries not present in the attached record
4. Be careful with opening balances and partial export windows. If the attached record begins after the ledger's opening balance date, do not blindly mark earlier activity as missing.
5. For incoming reimbursements or transfers, verify the posting direction. Do not leave asset-increasing transactions recorded as decreases.

## Step 4: Present Findings Before Editing

1. Show the Master a concise reconciliation report.
2. Include the items that appear missing, incorrect, or mismatched.
3. Ask for context needed to understand ambiguous transactions.
4. If the Master has not already given the current real-world balance of the target account, ask for it now.
5. Do not edit the ledger yet unless the evidence is fully sufficient and the Master has already provided the needed context.

## Step 5: Resolve Ambiguities With the Master

1. Ask focused follow-up questions only for the unresolved items.
2. Accept merchant-name versus personal-description differences when the Master confirms they refer to the same transaction.
3. Treat the attached transaction record plus the Master's clarifications as the source of truth.

## Step 6: Update the Ledger

Once the Master has provided enough context:

1. Edit the appropriate Beancount ledger file(s) under `~/finance/ledgers/`.
2. Add genuinely missing transactions.
3. Correct wrongly signed or wrongly dated transactions.
4. Rename descriptions where useful for clarity, while preserving the Master's preferred narrative style.
5. Remove or rewrite extra Beancount-only entries when they are contradicted by the attached transaction record.
6. Ensure the final Beancount balance for the target account matches the Master's stated current balance.

## Step 7: Validate, Commit, and Report

1. Run `./bin/validate` from `~/finance/`.
2. Confirm the final Beancount balance for the target account.
3. If the ledger validates and the final Beancount balance matches the Master's stated current balance, commit and push the finance repo changes immediately.
4. Report:
   - what was changed
   - the final reconciled balance
   - the commit hash if a commit was created
   - any still-open questions, if any remain

## Constraints

1. Do not guess transaction meaning when a short question can resolve it.
2. Commit and push immediately after successful reconciliation unless the Master explicitly says not to.
3. Keep the interaction practical and reconciliation-focused.
4. The task is only complete when the ledger validates, the Beancount balance matches the actual account balance, and the finance repo changes have been committed and pushed.
