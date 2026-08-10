---
name: financial-decision
description: Advise the Master on major financial decisions (house, car, investment property, personal loan, mortgage refinancing, large one-off spending) by evaluating impact on the path from current state to ideal life. Use when the Master asks whether to buy, refinance, take a loan, or commit to a large expense, or asks about affordability, DSR, or how a purchase affects long-term financial goals.
---

# Financial Decision Advisory

## When to use me

Use when the Master asks about any major financial commitment: buying a house, car, or investment property; taking a personal loan or new mortgage; refinancing; large discretionary spending; or evaluating whether an investment or business decision is affordable. Also use when the Master asks "can I afford X" or "should I do X" where X has a material financial impact.

## Context sources to load

Before advising, load these in order:

1. **Ideal life vision:** `notes/master/ideal-life-vision.md` — phased end-state (single, married, children, dream home), income path decision, life timeline.
2. **Goal roadmap:** `notes/master/goal-roadmap.md` — short/medium/long-term goals with done-criteria.
3. **Realistic financial plan summary:** `~/financial-planner/private-plans/zi-jian-realistic/summary.md` — actual income, individual investment accounts, Astrum loan, 35-year projection with phase gaps.
4. **Conservative plan (for comparison):** `~/financial-planner/private-plans/zi-jian-conservative/summary.md` — conservative baseline.
5. **Banking and finance notes:** `notes/master/banking-and-finance.md` — DSR preference, card usage, account structure, savings patterns.
6. **Beancount ledger (current balances):** Use the `master-finance` skill to query `~/finance/` for current account balances, debt positions, and recent spending patterns.
7. **Financial planner operating guide:** `~/financial-planner/docs/GUIDE.md` — how to read plans, import/export, analyze projections, and model scenarios.

## Rules

- Always load the full context before giving advice. Never advise from memory alone.
- Use the realistic plan as the primary baseline (it reflects actual income and assets).
- Apply the Master's 50% DSR (Debt Service Ratio) ceiling when evaluating any new loan or mortgage.
- Present all comparisons on a like-for-like basis (Real 2026 MYR vs Real 2026 MYR, never nominal vs Real).
- Use conservative assumptions for unknown variables (interest rates, yields, rental income).
- Contributions to investments reduce household cash; retained investment yield is not spendable income.
- Never commit private plan data. All Master-specific plan artifacts stay under `private-plans/` (git-ignored).
- Present options with Sebastian's opinion and recommendation; Master decides.

## Decision frameworks

### Affordability check (quick)

1. Query the ledger for current monthly income and debt obligations.
2. Calculate current DSR: (total monthly debt obligations / monthly gross income). Include all existing loans (Astrum mortgage RM750/mo, credit card minimums, any other commitments).
3. Add the proposed new monthly payment.
4. If new DSR exceeds 50%, flag as high risk and recommend against unless mitigating factors exist.
5. If new DSR is under 50%, proceed to path-impact analysis.

### Path-impact analysis (detailed)

1. Identify which phase(s) of the ideal-life timeline the purchase affects.
2. Check the realistic plan's projection for those phases — is there already a shortfall?
3. Estimate the incremental monthly cost (loan payment, maintenance, opportunity cost of downpayment).
4. Compare the incremental cost against the projected operating surplus/deficit for the relevant phase.
5. If the purchase pushes a phase from "tight" to "impossible", flag the specific years where cash goes critical.

### Planner scenario modeling (rigorous)

For material decisions (house, investment property, large loan), model the scenario directly in the financial planner:

1. Import the realistic plan JSON into the app as a copy (do not modify the original).
2. Add the proposed purchase as new spending/capital rows (e.g. new mortgage payment, downpayment one-off, property-related costs).
3. Add any new income the purchase generates (e.g. rental from a new investment property).
4. Compare the modified projection against the original realistic plan.
5. Report the delta in: end cumulative cash, phase-level operating surplus, FI gap, and salary-coverage years.
6. The planner is at `~/financial-planner/`. Run `bun run preview` to serve it, then use Chrome/DevTools with the `window.financialPlanner` automation API to extract projections. See `~/financial-planner/docs/GUIDE.md` section 6 for the API reference.

## Output format

Present advice in this structure:

1. **Recommendation** — one-paragraph summary with Sebastian's opinion (proceed / proceed with caution / do not proceed / defer).
2. **Affordability** — DSR before and after, cash-flow impact.
3. **Path impact** — which phases are affected, by how much, and which years go from tight to critical.
4. **FI impact** — how the decision changes the Financial Independence gap.
5. **Risks** — interest rate sensitivity, income interruption, market downturn.
6. **Alternatives** — if recommending against, suggest what would make it feasible (timing, size, terms).

Keep it concise. The Master reviews the numbers and decides.
