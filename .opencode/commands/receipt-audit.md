---
description: Audit freelance transactions for missing receipts and invoices
agent: sebastian
---

You are running the monthly freelance receipt/invoice audit.

## Purpose

Identify freelance transactions from the previous month that lack supporting documents (receipts for expenses, invoices for income). Report the gaps to the Master so they can upload the missing files to the Google Drive Expenses folder.

## Determine the Audit Period

Default: audit the **previous calendar month** (e.g., if today is July 5, audit all of June). If a month is passed as `$ARGUMENTS` in `YYYY-MM` format, audit that specific month instead.

Derive the year from the audit month and identify the ledger files:
- `~/finance/ledgers/freelance/<year>.beancount`
- `~/finance/ledgers/personal/<year>.beancount`

If neither file exists for that year, respond SEBASTIAN_IDLE — nothing to audit.

## Step 1: Find Freelance Transactions

Parse both ledger files and collect every transaction dated within the audit month that posts to ANY of these account patterns:

**Expenses (need receipts):**
- `Expenses:Freelance:Domain`
- `Expenses:Freelance:Hosting`
- `Expenses:Freelance:Software`
- `Expenses:Freelance:Marketing`
- `Expenses:Freelance:Subcontractors`
- `Expenses:Freelance:Equipment`
- `Expenses:Freelance:Travel`
- `Expenses:Freelance:Banking`

**Income (need invoices issued to clients):**
- `Income:Freelance:TeeSure`
- `Income:Freelance:CamMillion`
- `Income:Freelance:Other`

For split transactions (personal payment covering a business expense), the freelance posting lives in the freelance ledger with a matching `Assets:Receivable:Freelance` / `Liabilities:Freelance:AccountsPayable` pair in the personal ledger. Track these as a single transaction — one receipt covers the whole charge.

**Exclude** these from the audit (no receipt needed):
- `Equity:OwnerDrawings` postings (owner's drawings — internal transfers)
- Pure balance assertions and opening balance entries
- `Assets:Receivable:Freelance` and `Liabilities:Freelance:AccountsPayable` when they are the mirror side of a split that already has an `Expenses:Freelance:*` posting captured above

For each transaction, record: date, payee/narration, total amount (MYR), and the freelance account(s) involved.

## Step 2: Check for Filed Documents

List every file under `~/finance/ledgers/documents/` recursively. Documents follow this convention:
```
ledgers/documents/<FullAccountName>/YYYY-MM-DD <description>.<ext>
```
Where `<FullAccountName>` is the beancount account with colons (e.g., `Expenses:Freelance:Software`).

A document **covers** a transaction if a file exists with a date prefix matching the transaction date (`YYYY-MM-DD`) in **any** subdirectory under `ledgers/documents/`. Check all subdirectories, not just the freelance account's — receipts are sometimes filed under the payment method account (e.g., `Liabilities:CreditCard:RHBVisaSignature/`).

## Step 3: Compile the Gap Report

Build a list of transactions that have **no matching document**. For each, capture:
- Date
- Payee / narration
- Amount (MYR)
- Freelance account
- Document type needed: **Receipt** (for expenses) or **Invoice** (for income)

## Step 4: Report

### If gaps exist

Present a clear, concise table to the Master:

```
Missing Receipts/Invoices for <Month YYYY>:

| Date | Description | Amount | Account | Needed |
|------|-------------|--------|---------|--------|
| ...  | ...         | RM XX  | ...     | Receipt/Invoice |
```

Ask the Master to upload the missing files to the Google Drive `Expenses/<vendor>/` folder. Once uploaded, Sebastian will download and file them into `ledgers/documents/` with the correct date-prefixed naming.

### If no gaps

If every freelance transaction has a matching document, respond **SEBASTIAN_IDLE**. Do not bother the Master — the audit is clean.

## Constraints

- Only audit transactions within the specified month's date range. Do not flag transactions outside the period.
- A single document file can cover multiple postings on the same date (e.g., a split transaction). Match by date, not by individual posting.
- If the ledger file contains syntax errors, report the error instead of guessing.
- Keep the report concise. The Master knows the drill — no ceremony needed.
