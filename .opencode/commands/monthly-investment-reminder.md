---
description: Remind the Master to report investment portfolio market values for monthly revaluation
agent: sebastian
---

You are initiating the monthly investment portfolio revaluation reminder.

## Purpose

Prompt the Master to provide current market values for all investment and savings portfolios. These values are used to record revaluation entries (for aggregate accounts) and update price directives (for lot-based positions) in the Beancount ledger at `~/finance/`.

## What to Do

Greet the Master and present a clean checklist requesting the following values as of today:

1. **Public Bank Fixed Deposit** - current balance (principal + accrued interest)
2. **VersaCash** - total current balance across all envelopes
3. **KDI Save** - current balance
4. **KWSP (EPF)** - current statement balance
5. **Versa PRS** - current portfolio value (cost basis only if reconciling)
6. **StashAway** - current portfolio value (cost basis only if reconciling)
7. **IBKR Metals** - current market price per position in USD (DBB, IAUM, ICOP, LIT, SIVR)
8. **IBKR Stocks** - current market price per position in USD (COIN, PYPL)
9. **M+ Global Bursa** - current market price per stock in MYR (ALSREIT, AXREIT, MAHSING, SENTRAL, SUNREIT, TENAGA)
10. **USD/MYR exchange rate** - current spot rate (for valuing USD-denominated IBKR holdings)

Present this as a numbered list. Keep the greeting brief — the Master knows the drill.

## After the Master Provides Values

Once the Master responds with values:

1. Load and follow the `master-finance` skill for all ledger operations.
2. For **aggregate accounts** (Fixed Deposit, VersaCash, KDI Save, KWSP, Versa PRS, StashAway):
   - Calculate the difference between current balance and the last recorded balance.
   - Record a revaluation entry dated today, booking the delta to `Income:Investment:UnrealizedGains` (for investment portfolios) or `Income:Investment:Interest` (for interest-bearing accounts).
3. For **lot-based accounts** (IBKR Metals, IBKR Stocks, M+ Global):
   - Update the price directives in `ledgers/opening_balances.beancount` (or the current year's ledger) with today's market prices.
   - Also update the `USD` price directive with today's USD/MYR spot rate so USD-denominated holdings are valued correctly in MYR.
4. Validate with `./bin/validate` from `~/finance/`.
5. Commit and push to `sebastianloh97/finance`.
6. Confirm to the Master with a brief summary of changes made.

## Tone

Professional and concise. This is a routine monthly task — no ceremony needed.

## Constraints

- Never record entries with missing values. Ask if anything is unclear.
- Never commit a ledger that fails validation.
- If the Master provides partial values, record what is available and note what is still pending.
