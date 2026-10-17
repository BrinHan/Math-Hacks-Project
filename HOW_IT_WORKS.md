# How the AED Placement Optimizer Works

A plain-language guide to the whole project, built up from the questions asked while learning it.

---

## 1. The problem

A campus has limited money for defibrillators (AEDs). Where should K of them go to save the most lives per year?

- **Lives saved** is measured against waiting for an ambulance.
- **Budget K** limits the total cost of the AEDs placed.
- Some sites are closed at certain times, and some already have an AED.

---

## 2. The big picture

```
generate campus  ->  travel times  ->  coverage rows  ->  solver picks AED sites  ->  score the plan
                                                                                  ->  test it (Monte Carlo)
```

The code is in `aed/`:

| Step | File | What it does |
|---|---|---|
| Campus data | `aed/data/synthetic.py` | Creates cells, sites, arrests per year, opening hours |
| Travel times | `aed/travel.py` | Time for an AED at each site to reach each cell |
| Survival and benefit | `aed/survival.py` | How much an earlier AED improves survival |
| Coverage rows | `aed/coverage.py` | Builds the table of cases the solver scores |
| Solvers | `aed/solvers/` | ILP, greedy, swap: pick the sites |
| Scoring | `aed/solvers/common.py` | Lives saved per year for any plan |
| Uncertainty | `aed/uncertainty.py` | Monte Carlo and sensitivity tests |
| Experiments | `experiments/` | Runs everything and writes CSVs |

---

## 3. The pieces, one at a time

**Cell.** A small square of the campus grid. Each cell has a number of cardiac arrests per year for each period (day, evening, night).

**Site.** A place an AED could go, mostly inside buildings, some outdoors. Each site has a cost, a walk-in delay (time inside the building), and opening hours.

**Travel time.** The time from collapse until an AED at a site reaches the patient in a cell: dispatch delay, plus a round-trip walk, plus time inside the building. One number per cell-site pair, in seconds.

**Time band.** A fixed cut-off, such as "within 2 minutes" or "within 3 minutes." The bands go in 1-minute steps up to the ambulance time. A site falls into a band if its travel time is at or below that band's limit.

**Benefit.** How much better a patient's survival chance is if an AED arrives within a band, compared with waiting for the ambulance. It's a probability per arrest.
- Formula: `S(t) = S0 × exp(−k × t)` is survival if shocked at time t. Benefit for a band = `S(band limit) − S(ambulance time)`, never below 0.
- Example with the project's values: an AED within 2 minutes gives about 0.29 extra survival chance per arrest. Within 4 minutes, about 0.18.

**Row.** One specific case: one cell, in one period, reached within one time band. Each row has:
- a **weight**: lives per year at stake for that case (arrests × the band's benefit difference)
- a **reach list**: the sites that get to that cell within that band and are open in that period

The coverage table is the full list of rows. The model has about 13,700 rows.

**x (one per site).** The decision: 1 means put an AED at that site, 0 means don't.

**z (one per row).** Whether that case is covered: 1 means yes, 0 means no. z can only be 1 if at least one site on its reach list has x = 1. The rule is `z ≤ sum of x over the reach list`. Once the sites are chosen, z is 1 if any chosen site is on the row's reach list, and 0 otherwise.

**Budget.** The total cost of sites with x = 1 can't exceed K. Costs are in "cost units": 1.0 for an indoor site, 1.5 for an outdoor cabinet (an assumption in the code, not a real price). The budget is a rule the solver respects while searching, not a filter applied afterwards.

**Objective.** Maximize the sum of (weight × z) over all rows. That's the total lives saved per year.

Without a budget, the best answer would be an AED at every site. The budget is what forces a trade-off.

---

## 4. The ILP and how it's solved

**ILP** = integer linear program. Linear rules (no squares or products of variables), and some variables must be whole numbers. Here, every x must be 0 or 1.

**LP** = linear program. The same problem, but variables may take any value in their range. LPs are fast to solve.

**HiGHS** is an open-source solver for LPs and ILPs. The project calls it through `scipy.optimize.milp`. You never call HiGHS directly.

The solver works like this:

1. **Relax.** Drop the whole-number rule so each x can be anything from 0 to 1. Solve this LP quickly. Its score is a **ceiling**: no real plan within budget can beat it. It's computed by solving, not by setting values to 1.
2. **Branch.** If some x comes out fractional (say 0.6), split the plans into two groups: one with x = 0, one with x = 1. Each group keeps every other site free, and each group is re-solved.
3. **Prune.** If a group's ceiling is below the best real plan found so far, drop the whole group without checking its plans.
4. **Repeat** on the groups still in play, until every group is dropped or reduced to a real plan. Or stop at the 60-second time limit.
5. **Answer.** The best real plan found, with a **gap** showing how close it is to the ceiling. A gap under 0.01% (1e-4) means it's proven nearly optimal.

Details that often confuse:
- **Branching never rounds.** A fractional x is never turned into 0. Each split is an exact choice.
- **A branch is a group of plans**, not one plan. "B = 1" means every plan on the whole campus that includes an AED at B.
- **Only one site is split per step.** A child branch fixes one more site, and its solve still covers the rest of the map jointly.
- **Branches aren't compared one-on-one.** Each is checked against the same bar: the best real plan found so far.
- **Two main branches** exist for the whole map, from the first split. Each level below doubles the count, but pruning keeps the tree small.
- **Both children of a split can't be 0 for the same site.** One child has it at 1, the other at 0. Two children can both have a ceiling of 0, though, if their sites reach nothing useful.
- **The first best real plan** comes from a branch whose solve happens to be whole, from rounding a fractional answer into a valid placement, or from diving down one path of splits.
- **The best real plan is a moving target.** It starts poor and improves as the search goes on.
- **A split's children can't lose the record.** The record is an already-found real plan. Children are only explored if their ceiling is above it.
- **How x's are handled:** one LP solve covers all ~300 site values at once. Only the fractional ones get split.

**Analogy: speedcubing world record.** The best real plan is the record to beat. A branch is an attempt in progress. Its ceiling is the best time it could still finish with. If even that is slower than the record, stop the attempt early.

---

## 5. Other ways to get a plan

- **Greedy.** Repeatedly add the site that gives the most new lives per unit cost, until the budget runs out. Fast, and at least about 63% of optimal, because the objective is monotone submodular with unit costs.
- **Swap (Teitz-Bart).** Start from greedy, then try swapping one chosen site for one unchosen site, keeping any swap that improves the total. Repeat until nothing improves.
- **Population-only.** Ranks sites by people nearby, ignoring lockout and survival. Planned, not yet on `main`.
- **Brute force.** Tries every combination of K sites. Used only in tests, on a tiny 8-site campus, to check that the ILP finds the true best. Too slow for the real campus.

---

## 6. Monte Carlo: the tester, not the planner

Monte Carlo doesn't choose the placement. It checks how well a chosen placement holds up.

1. The ILP picks the base plan.
2. Draw a random scenario: each parameter uniform in its range, demand scaled 0.7 to 1.3, and about 10% of opening schedules flipped.
3. Rebuild coverage and score the same plan.
4. Repeat (200 scenarios in the experiments).

Outputs:
- **Average and 90% range** (5th to 95th percentile) of lives saved.
- **Site frequency.** Greedy re-optimizes in each scenario, and the share of scenarios that pick each site is recorded. A site picked in most scenarios is robust.
- **K-curve bands** for each budget.

**Sensitivity (tornado).** Each parameter is moved to its low and high value, one at a time, to see which ones matter most.

---

## 7. Corrections made during the conversation

- The toy numbers (0.5, 0.2, and so on) were made up for illustration, not from the model. The real benefits come from the survival formula.
- "Covered1" and "z" in the first explanation were shorthand. The full version: z1, z2, z3 are 0-or-1 coverage switches, one per cell.
- A relaxed x value is not a measure of how important a site is. It depends on the budget and the other sites.
- The ceiling isn't "everything set to 1." It's the best score the relaxed problem can reach within the budget.
- Branching doesn't pick between plans by rounding, and it doesn't test different fractional values. It fixes one site and asks the solver for the best score in each group.

---

## 8. Glossary

| Term | Plain meaning |
|---|---|
| Cell | A small square of the campus grid |
| Site | A possible AED location |
| Period | Day, evening or night |
| Band | A time cut-off, like "within 3 minutes" |
| Travel time | Time for an AED at a site to reach a cell |
| Benefit | Extra survival chance from an AED arriving in a band |
| Row | One cell, period and band: one case being scored |
| Reach list | The sites that cover a row in time |
| Weight | Lives per year at stake for a row |
| x | 1 if an AED is placed at a site, else 0 |
| z | 1 if a row is covered, else 0 |
| Budget K | Maximum total cost of AEDs |
| Plan | A complete yes/no choice for every site |
| ILP | Linear program where x must be whole numbers |
| LP | Linear program; variables may be fractional |
| Relaxation | The LP with the whole-number rule dropped |
| Ceiling | The best score a relaxed problem reaches; no real plan beats it |
| Branch | A group of plans with some sites fixed |
| Prune | Drop a branch whose ceiling can't beat the best real plan |
| Gap | How far the best real plan is from the ceiling |
| HiGHS | The open-source solver doing the ILP work |
| Greedy | Add the best value-per-cost site until the budget is spent |
| Monte Carlo | Random re-testing of a plan under uncertain inputs |

---

## 9. Where the project stands

- The model, solvers and tests are built. The test suite passes (65 tests on the `t2-data` branch).
- The campus generator is a uniform random placeholder, so current numbers aren't meaningful yet.
- The realistic building-based generator and population baseline are planned (see `docs/superpowers/plans/2026-10-17-t2-data.md`) but not built.
- `results/mock/` contains fake numbers in the real file formats. The numbers in `docs/results-log.md` are from the placeholder campus.
- The Streamlit app, OSMnx loader and `docs/sources.md` do not exist yet.
- Every citation in `aed/params.py` is still marked as an assumption.
