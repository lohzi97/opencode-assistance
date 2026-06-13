---
name: master-finance
description: Manage the Master's personal and freelance finances tracked in a Beancount ledger at ~/finance/. Use when recording transactions, checking budgets, generating financial reports, querying account balances, validating the ledger, or answering any question about the Master's money, spending, income, or net worth. Also use when discussing Fava dashboard, account structure changes, or beancount concepts.
---

# Master Finance

## When to use me

Use this skill for anything related to the Master's finances: recording spending/income, budget queries, reports (P&L, cashflow, balance sheet), account balance lookups, ledger validation, Fava dashboard operations, account structure changes, or explaining beancount concepts visible in Fava.

## Rules

- Always run `./bin/validate` from `~/finance/` before committing ledger changes.
- Never commit a ledger with errors.
- All currency is MYR.
- Double-entry must balance: every transaction needs at least two postings that sum to zero.
- Personal accounts go in `ledgers/personal/`, freelance accounts go in `ledgers/freelance/`. Use `config/accounts.yaml` to look up an account's scope.
- Opening balances and cross-scope transactions live in `ledgers/opening_balances.beancount` (included only by `combined.beancount`).
- After recording entries, commit and push to `sebastianloh97/finance`.
- When the Master mentions a transaction verbally (e.g. "lunch RM7"), record it immediately using `./bin/record` or by editing the ledger directly.
- **Always confirm the expense category, tag (if any), and payment method with the Master before recording. Never assume.** When in doubt, ask.

## Repo Structure

```
~/finance/
  bin/                        CLI scripts (run from repo root)
    init                      Initialize repo (venv, deps, dirs)
    record                    Record a transaction
    validate                  Validate all ledger files
    report                    Generate reports (pnl, cashflow, balance, personal)
    budget                    Check budget status
    fava                      Start Fava web dashboard
    close                     Period-end closing
  ledgers/
    personal.beancount        Personal entry point (standalone)
    freelance.beancount       Freelance entry point (standalone)
    combined.beancount        Combined entry point (used by Fava)
    opening_balances.beancount Opening balances (combined-only include)
    personal/2026.beancount   Personal accounts + transactions
    freelance/2026.beancount  Freelance accounts + transactions
  config/
    accounts.yaml             Account metadata (scope, active, budget_category)
    budgets.yaml              Budget limits per category
  PRD.md                      Full system design doc
  README.md                   Usage guide with examples
```

## Account Chart

### Assets (Personal)
- `Assets:Bank:PublicBank:PlusSavings` (6353774926) - main account, salary, daily use
- `Assets:Bank:PublicBank:ShariahSavings` (4915764821) - home loan auto-deduction
- `Assets:Bank:PublicBank:FixedDeposit` - PB fixed deposits (single account, multiple placements)
- `Assets:Investment:VersaCash` - Versa money market fund
- `Assets:Investment:KDISave` - Kenanga KDI money market fund
- `Assets:Investment:StashAway` - StashAway robo advisor (MYR)
- `Assets:Investment:IBKR:Metals` (U19742234) - IBKR metals/commodities (USD, with cost basis lots)
- `Assets:Investment:IBKR:Stocks` (U15501472) - IBKR individual stocks (USD, with cost basis lots)
- `Assets:Investment:MPlusGlobal` - M+ Global Bursa Malaysia positions (MYR, with cost basis lots)
- `Assets:Retirement:KWSP` - KWSP retirement savings
- `Assets:Property:GlenCourt` - Glen Court property (book value: SPA + furniture)
- `Assets:TouchNGo` - TnG e-wallet
- `Assets:Wallet` - physical cash on hand

### Assets (Freelance)
- `Assets:Bank:Maybank` (112820123947) - freelance income collection
- `Assets:Freelance:AccountsReceivable` - unpaid invoices
- `Assets:Freelance:Equipment` - freelance equipment value
- `Assets:Freelance:Deposits` - security deposits paid

### Liabilities (Personal)
- `Liabilities:CreditCard:PBQuantumVisa` (7107)
- `Liabilities:CreditCard:PBQuantumMastercard` (2119)
- `Liabilities:CreditCard:RHBVisaSignature` (1844)
- `Liabilities:CreditCard:RHBWorldMastercard` (1561)
- `Liabilities:Mortgage` - Public Bank home loan (Astrum Ampang)

### Liabilities (Freelance)
- `Liabilities:Freelance:AccountsPayable` - money owed to subcontractors
- `Liabilities:Freelance:TaxProvision` - provisional tax reserve

### Expenses (Personal)
Food, Transport, Rent, Utilities, Subscriptions, Insurance, Medical, Education, Discretionary, Mortgage, Housing

### Expenses (Freelance)
Domain, Hosting, Software, Marketing, Subcontractors, Equipment, Travel, Banking

### Income
- `Income:Salary` - DotDash salary (net)
- `Income:Freelance:TeeSure`, `Income:Freelance:CamMillion`, `Income:Freelance:Other`

### Category and Tag Reference
The authoritative source for category descriptions, tag conventions, and account metadata is `config/accounts.yaml` in the finance repo. Run `./bin/categories` for a quick formatted reference. Always consult this before recording a transaction to select the correct category.

## Workflows

### Record a Transaction
```bash
cd ~/finance && ./bin/record --date 2026-06-13 --description "Lunch" \
  --amount 7.00 --from Assets:Wallet --to Expenses:Personal:Food
```
Or edit the ledger file directly for complex entries (multiple postings, metadata, tags).

### Validate
```bash
cd ~/finance && ./bin/validate
```
Must pass for all three entry points (personal, freelance, combined) before committing.

### Reports
```bash
./bin/report personal --month 2026-06     # Personal spending by category
./bin/report pnl --month 2026-06          # Freelance P&L
./bin/report cashflow --year 2026         # Freelance cashflow
./bin/report balance --scope all          # Balance sheet (net worth)
```

### Budget
```bash
./bin/budget status --week    # Weekly budget remaining
./bin/budget status --month   # Monthly budget remaining
```

### Fava Dashboard
- Public URL: https://finance.lohzi.com (behind Cloudflare Access)
- Local: tmux session `fava`, port 5000, bound to 0.0.0.0
- Nginx config: `~/nginx-proxy/conf.d/finance.conf`
- Fava auto-detects file changes — new entries appear immediately without restart
- To restart: kill tmux session, run `./bin/fava` in a new tmux session

## Key Beancount Concepts

- **Everything is a commodity.** MYR is a commodity, same as AAPL stock. Bank balances are "units of MYR."
- **Balance conventions:** Assets and Expenses are positive. Liabilities, Income, and Equity are negative. This is normal.
- **Holdings view in Fava** is for investment positions (units, cost basis, market price). For cash accounts, use Balance Sheet or Trial Balance instead.
- **Cost basis lots:** `Assets:Investment:IBKR  10 AAPL {150.00 MYR}` tracks 10 shares bought at RM150 each. Used for unrealized gain/loss tracking.
- **Price directives:** `2026-06-13 price AAPL 180.00 MYR` records market price for valuation.
- **Balance assertions:** `2026-06-13 balance Assets:Wallet 30.20 MYR` verifies the balance matches. Use after reconciling.
- **Multi-currency:** Ledger operates in MYR. IBKR positions are in USD with cost basis lots. Fava shows separate MYR/USD sections. Report script has a known limitation with commodity accounts (shows lot counts, not values) — use Fava for accurate investment valuations.
- **Investment lots tracked:** DBB, IAUM, ICOP, LIT, SIVR, COIN, PYPL (USD). ALSREIT, AXREIT, MAHSING, SENTRAL, SUNREIT, TENAGA (MYR).
- **Price updates:** Record price directives when making new purchases. Optionally do a monthly batch update. No daily/weekly cadence needed.
- **Property:** Glen Court recorded at book value (SPA price + furniture). Periodic revaluation (annual or when market data available) via adjusting entry.

## Reference

- Official beancount docs: https://github.com/beancount/docs
- Full PRD: `~/finance/PRD.md`
- Usage guide: `~/finance/README.md`
