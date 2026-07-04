---
description: Monthly freelance reimbursement check — verify balance, recommend transfer, record entries on confirmation
agent: sebastian
---

You are running the monthly freelance reimbursement check.

## Purpose

The freelance business incurs expenses paid with the owner's personal funds (split transactions). The personal ledger tracks these as `Assets:Receivable:Freelance` and the freelance ledger mirrors them as `Liabilities:Freelance:AccountsPayable`. Once a month, reimburse the owner by transferring the outstanding balance from the freelance Maybank account to the owner's personal PublicBank PlusSavings, then record the clearing entries.

## Step 1: Read Both Balances

Run `cd ~/finance && ./bin/report balance --scope all` and read two figures:

- `Assets:Receivable:Freelance` (personal) — a positive number.
- `Liabilities:Freelance:AccountsPayable` (freelance) — a negative number.

The amount the freelance business owes the owner is the magnitude of either balance. These two are meant to mirror each other.

## Step 2: Sync Check (Critical)

Before presenting any amount, verify the two balances match in magnitude:

```
|Receivable:Freelance| == |AccountsPayable|
```

### If they match

Proceed to Step 3.

### If they diverge

They are out of sync — an entry exists on one side with no counterpart on the other. **Do not present a transfer amount yet.** Investigate:

1. Grep both ledgers for postings to the two accounts:
   - `grep -n "Receivable:Freelance" ledgers/personal/<year>.beancount`
   - `grep -n "AccountsPayable" ledgers/freelance/<year>.beancount`
2. Sum the postings on each side and identify which entries are orphaned (present on one side only).
3. Read the orphaned transaction's full context to determine the correct fix:
   - A personal split with no freelance counterpart usually means the freelance bookkeeping was simply missed (add the missing `Expenses:Freelance:*` + `AccountsPayable` entry).
   - Conversely, a freelance entry with no personal counterpart may mean a receivable posting was missed.
4. Surface the discrepancy to the Master: state both balances, the delta, the orphaned transaction(s), and a recommended fix. Present options and let the Master decide.
5. After the Master approves a fix, apply it, re-run the balance report, and confirm the accounts now sync. Then proceed to Step 3.

Never propose a transfer amount derived from only one side of a mismatched pair.

## Step 3: Zero or Near-Zero Check

If the (synced) balance is less than 1 MYR, respond **SEBASTIAN_IDLE**. Nothing to reimburse.

## Step 4: Present the Outstanding Balance

Present to the Master:

- The total amount the freelance business owes (the synced balance).
- Recommend transferring that exact amount from **Maybank** to **PublicBank PlusSavings**.
- Explain that this clears the reimbursement balance to zero on both sides.

## Step 5: Wait for Confirmation

Wait for the Master to confirm the transfer is complete before recording anything.

### If the Master defers

If the Master chooses not to transfer now (e.g., the amount is small), **record no entries**. The balance carries forward to next month's check, accumulating with any new freelance expenses. Confirm to the Master that the balance is carried forward and stop here.

## Step 6: Record the Reimbursement Entries

After the Master confirms the transfer, record two entries using the transfer amount:

**Personal ledger** (`ledgers/personal/<year>.beancount`):
```
<date> * "Monthly reimbursement - freelance expenses"
  Assets:Bank:PublicBank:PlusSavings
  Assets:Receivable:Freelance
```

**Freelance ledger** (`ledgers/freelance/<year>.beancount`):
```
<date> * "Monthly reimbursement - freelance expenses"
  Liabilities:Freelance:AccountsPayable
  Assets:Bank:Maybank
```

Use the transfer amount as the explicit posting amount on the debit side of each entry; let beancount balance the credit side implicitly.

## Step 7: Validate

Run `cd ~/finance && ./bin/validate`. If validation fails, fix the error before proceeding. Never commit a ledger that fails validation.

## Step 8: Commit and Push

```
cd ~/finance && git add -A && git commit -m 'reimbursement: monthly freelance reimbursement <Month>' && git push
```

Replace `<Month>` with the full month name (e.g., `July`).

## Step 9: Confirm

Confirm to the Master that the reimbursement has been recorded and pushed. Include the commit hash and the cleared balance.

## Constraints

- Never record entries without the Master confirming an actual transfer took place.
- Never propose a transfer amount when the two ledgers are out of sync — resolve the discrepancy first.
- Never commit a ledger that fails validation.
- If the Master defers, record nothing and carry the balance forward.
- Keep communication concise. The Master knows the drill — no ceremony needed.
