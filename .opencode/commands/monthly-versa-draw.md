---
description: Monthly Versa Cash draw-down review — surface envelope-eligible spend, record reimbursements on approval
agent: sebastian
---

You are running the monthly Versa Cash draw-down review.

## Purpose

The Master pre-saves into Versa Cash envelopes each month but pays daily expenses from cards, TnG, and bank transfers — never directly from Versa. Once a month, the Master reviews the previous month's spending and decides which transactions to "reimburse" themselves for by drawing down the corresponding Versa Cash envelope into PublicBank PlusSavings. This command automates that review cycle.

## Inputs

- `$ARGUMENTS` (optional): the review month in `YYYY-MM` format. If empty, default to **last month** relative to today's date (compute from the current date).
- If the Master passes a year-month, use that instead.

## Step 1: Load Context

1. Load the `master-finance` skill for repo structure, account chart, and conventions.
2. Read `~/finance/config/accounts.yaml` to get the full list of `Assets:Investment:VersaCash:*` sub-accounts and their `description` fields. These descriptions define what each envelope is meant to fund.

## Step 2: Scan the Review Month for Candidate Spending

1. Generate the personal spending report for the review month: `cd ~/finance && ./bin/report personal --month <YYYY-MM>`.
2. Read the full month's transactions from `~/finance/ledgers/personal/<year>.beancount` (grep for the review month's `YYYY-MM` dates).
3. For each transaction, check whether its **purpose** matches any Versa Cash envelope description. The envelope purposes are the matching criteria, not the expense category. For example:
   - A haircut matches `SkinHairCare` ("skin care and hair care products").
   - A car service or car part matches `CarMaintenance` ("car servicing and maintenance").
   - A fancy dinner or date matches `Entertainment` ("travel, fancy dinners, dates").
   - A health screening or vaccination matches `BodyCheckup` ("annual body checkup").
   - An Astrum strata fee or access card matches `Astrum:Maintenance` ("Astrum Ampang monthly maintenance/strata fee").
   - A Glen Court repair or sinking-fund cost matches `GlenCourt:Maintenance` ("taxes, maintenance fees, fire insurance, repairs").
   - A digital purchase or software credit matches `DigitalProduct` ("digital product purchases").
   - Pet-related costs (vet, pet food) match `Pet` ("pet care"). Note: animal-shelter donations are charity, not pet care.
   - Dental treatment matches `Dental`. Eyewear matches `Spectacles`.
4. Exclude routine spending that only loosely relates (e.g. daily vitamins are not a "body checkup", petrol is not "car maintenance", tolls are not "car maintenance").
5. A transaction tagged `^versa-drawn-<YYYYMM>` has definitively been drawn in a prior review — exclude it. For transactions predating the tag convention (before 2026-08), fall back to reading prior draw-down narrations in the ledger and flag any residual ambiguity as "likely already drawn".

## Step 3: Present Candidates

Present all candidate transactions grouped by matching envelope, in a table:

| Envelope | Date | Transaction | Amount | Paid from |

Add a **confidence** note for borderline fits (e.g. a fancy dinner with relatives rather than a date). Also list envelopes that had **zero** matching spend so the Master knows they simply roll forward.

Present the **maximum possible draw-down** total (sum of all candidates) as a reference figure.

Then ask the Master which transactions to draw down. Wait for their decision.

## Step 4: Record the Draw-Down Reimbursements

For each transaction the Master approves, append a draw-down entry to `~/finance/ledgers/personal/<year>.beancount`. Date the entries as **today's date** (when the review happens). Use this format:

```
<today> * "Versa Cash draw-down - <Envelope> (<Mon>: <original transaction summary>)" ^versa-drawn-<YYYYMM>
  Assets:Bank:PublicBank:PlusSavings              <amount> MYR
  Assets:Investment:VersaCash:<Envelope>          -<amount> MYR
```

Replace `<Envelope>` with the full sub-account name (e.g. `CarMaintenance`, `Astrum:Maintenance`). Replace `<Mon>` with the 3-letter review-month abbreviation. Keep the original transaction summary short.

Then tag both sides with `^versa-drawn-<YYYYMM>` (the **review** month, not today's month):

- Append the tag to each approved **original transaction** in place. Tag-only edit — never change its date, narration, amounts, or accounts.
- The same tag goes on the draw-down entries (shown in the format above).

This makes "already drawn" definitive for future reviews: a candidate is either tagged (drawn) or untagged (available), queryable in Fava and grep.

Place new entries in chronological order. If today's date already has entries, append after the last same-date entry. Add a section comment header:

```
; --- Versa Cash monthly draw-down (<Mon YYYY> review) ---
```

## Step 5: Fix Balance Assertions (Critical)

Draw-down entries increase `Assets:Bank:PublicBank:PlusSavings` and decrease envelope balances. After adding the entries:

1. Run `cd ~/finance && ./bin/validate`.
2. If a balance assertion fails (e.g. on `Assets:Bank:PublicBank:PlusSavings` in `~/finance/ledgers/opening_balances.beancount` or any envelope account), update the assertion value by adding the draw-down total to the expected PlusSavings balance (and adjusting any envelope assertion accordingly).
3. Re-run `./bin/validate` and confirm all three entry points pass (`personal`, `freelance`, `combined`).

Never commit a ledger that fails validation.

## Step 6: Commit and Push

```
cd ~/finance && git add -A && git commit -m 'Versa Cash monthly draw-down (<Mon YYYY> review): <summary>' && git push
```

Summarise each envelope and amount in the commit message body or subject (e.g. `CarMaintenance 12.00, Astrum:Maintenance 50.00`).

## Step 7: Report the Transfer Total

Present a final summary to the Master:

| Envelope | Purpose | Amount |

With a **Total** row. Then give the action instruction: withdraw the total amount from the specified Versa pockets back to PublicBank PlusSavings, listing each pocket and its amount.

## Constraints

- Never draw down an envelope without the Master's explicit approval for that specific transaction.
- Never draw the `Emergency` or `Unallocated` envelopes for routine envelope-matched spending without explicit instruction — they are reserves.
- Never modify the original expense entries' date, narration, amounts, or accounts — the only permitted edit is appending the `^versa-drawn-*` tag at draw time. The draw-down is purely an inter-account transfer (envelope to PlusSavings).
- Never commit a ledger that fails validation.
- Keep communication concise. The Master knows the drill.
