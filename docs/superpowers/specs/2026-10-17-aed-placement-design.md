# Spatio-Temporal AED Placement Optimizer: Design Spec

Date: 2026-10-17. Hackathon deadline: Sun 2026-10-18 13:00 (code freeze 11:00).

## 1. Goal

Choose where to place K automated external defibrillators (AEDs) across one small
area (a campus) to maximize **expected out-of-hospital cardiac arrest (OHCA)
survivors per year attributable to AEDs**, under a budget, accounting for
time-of-day building lockout, existing AEDs, and parameter uncertainty.

Success for the hackathon:
- A correct, linear ILP with stated assumptions and cited parameters.
- Baselines (greedy, swap, population-only) with a reported optimality gap.
- A lives-saved-vs-K curve, Monte Carlo 90% intervals, and a sensitivity tornado.
- A live Streamlit + folium demo (budget K slider, time-of-day period selector).
- README with assumptions, citations, results, and a 2-minute pitch outline.

Non-goals: city-scale instances, hosting the app, routing vehicles, exact
(non-probabilistic) survival claims.

## 2. Team and ownership

Parallel modules around one data contract (`Instance`). Claude Code builds the
core and freezes interfaces first; teammates then own modules.

| Owner | Modules |
|---|---|
| Core (Claude Code) | `instance.py`, `data/synthetic.py`, `travel.py`, `survival.py`, `coverage.py`, `solvers/ilp.py`, `solvers/greedy.py`, `experiments/k_curve.py`, core tests |
| A | `solvers/swap.py` (Teitz-Bart), population-only baseline, optimality-gap experiments |
| B | `uncertainty.py`: Monte Carlo (90% CI, site selection frequency), one-at-a-time sensitivity tornado, optional robust variant |
| C | `app.py`: Streamlit + folium UI |
| D | `params.py` values + citations, real data (OSMnx campus, AED registry), README, pitch |

## 3. Repository layout

```
aed/
  __init__.py
  instance.py          Instance dataclass (the contract)
  params.py            Params dataclass: every value, its range, its citation
  data/
    __init__.py
    synthetic.py       generate_instance(seed, ...) -> Instance
    osm.py             (later, D) load_campus(...) -> Instance
  travel.py            travel_time_matrix(inst, params) -> tau (I x J, seconds)
  survival.py          survival(t, params) -> S(t)
  coverage.py          build_coverage(inst, tau, params) -> Coverage
  solvers/
    __init__.py
    common.py          Solution dataclass, evaluate(coverage, x) -> lives/yr
    ilp.py             solve_ilp(coverage, budget, ...) -> Solution
    greedy.py          solve_greedy(coverage, budget) -> Solution
    swap.py            (A) solve_swap(coverage, budget, init) -> Solution
  uncertainty.py       (B)
experiments/
  k_curve.py           lives saved vs K for ILP and greedy, gap table
results/               generated figures and CSVs (gitignored except final figs)
tests/
app.py                 (C)
requirements.txt
README.md
```

## 4. Data contract

All arrays are numpy. Coordinates are local metres; `origin_latlon` anchors them
for mapping (synthetic data uses a fixed arbitrary anchor).

```python
@dataclass
class Instance:
    cell_xy: np.ndarray        # (I, 2) float, metres, cell centroids
    cell_rate: np.ndarray      # (I, P) float, public OHCA per year in cell i during period p
    site_xy: np.ndarray        # (J, 2) float, metres
    site_cost: np.ndarray      # (J,) float, cost units (1.0 = one standard AED)
    site_floor_delay: np.ndarray  # (J,) float, seconds to reach the AED inside the building
    site_open: np.ndarray      # (J, P) bool, a_jp: accessible in period p
    site_existing: np.ndarray  # (J,) bool, already has an AED (forced x_j = 1, zero cost)
    site_kind: list[str]       # (J,) building type label, for display
    periods: list[str]         # e.g. ["day", "evening", "night"]
    period_hours: np.ndarray   # (P,) hours per day in each period (sums to 24)
    origin_latlon: tuple[float, float]
```

`Params` (in `params.py`) holds, each with a base value, a low/high range for
sensitivity, and a citation string:
- `incidence_per_100k_yr` (base 55; range 40-70).
- `public_fraction`: share of OHCA in public locations (base 0.18; range 0.12-0.25).
- `walk_speed_mps` (base 1.4; range 1.2-2.0).
- `detour_factor` (base 1.3; range 1.2-1.5).
- `dispatch_delay_s`: time from collapse until a bystander starts to fetch the AED (base 60).
- `ems_response_s`: time until the ambulance defibrillates (base 540 = 9 min; range 420-720).
- `survival_S0`: survival if defibrillated at t=0 (base 0.7).
- `survival_k_per_min`: exponential decay rate (base derived from ~10%/min relative decline without CPR; range covering 3-10%/min).
- `survival_form`: "exp" or "linear".
- `band_edges_s`: time-band upper edges T_1..T_K (base 60..600 step 60).
- `max_tau_s`: pruning cutoff (600).

Exact citations are D's task. Each value enters `params.py` with a source or an
explicit `ASSUMPTION` label.

## 5. Model

**Demand.** For cell i and period p:
`λ_ip = pop_ip × incidence/100k × public_fraction × (period_hours_p / 24)`,
where `pop_ip` is the people present in the cell during period p (foot traffic).
Arrests at home are excluded by `public_fraction`, which is a stated assumption.

**Travel time.** `d_ij` = Euclidean distance × detour factor (fallback; OSMnx
network distance replaces it later).
`τ_ij = dispatch_delay + 2·d_ij / v + floor_delay_j`. The factor 2 models a
bystander walking to fetch the AED and returning.

**Survival.** `S(t) = S0·exp(−k·t)` (or linear, clipped at 0), t in minutes.

**Benefit relative to EMS.** Without an AED the patient waits for the ambulance:
`S_EMS = S(ems_response)`. Covering cell i in period p within band k gives benefit
`b_k = max(0, S(T_k) − S_EMS)` per arrest. The objective is lives saved per year
compared with the ambulance-only baseline. Bands with `T_k ≥ ems_response` give
zero benefit and are dropped.

**Coverage.** `N_ipk = { j : τ_ij ≤ T_k and site_open[j,p] }`. Pairs with
`τ_ij > max_tau_s` are pruned. Stored sparsely: for each (i,p,k) with non-zero
weight, the list of sites.

**ILP (gradual-cover maximal covering).**
- Variables: `x_j ∈ {0,1}`; `y_ipk ∈ [0,1]` (continuous is enough: it is integral
  at optimum given x binary, which keeps HiGHS fast).
- max `Σ_{i,p,k} λ_ip · b_k · y_ipk`
- s.t. `y_ipk ≤ Σ_{j ∈ N_ipk} x_j` for all (i,p,k)
- `Σ_k y_ipk ≤ 1` for all (i,p)
- `Σ_j c_j x_j ≤ Budget` (existing AEDs cost 0)
- `x_j = 1` for existing AEDs.

An equivalent, smaller "incremental" form will be used if needed. Let
`Δb_k = b_k − b_{k+1}` (with b non-increasing in k), and let `z_ipk ∈ [0,1]` mean
"cell i in period p is served within T_k". Then the objective is
`Σ λ_ip Δb_k z_ipk` with `z_ipk ≤ Σ_{N_ipk} x_j`. Both forms are linear. The
implementation picks one and the tests check it against brute force.

Solver: `scipy.optimize.milp` (HiGHS) with a time limit and the reported MIP gap.

**Placement across periods.** One placement x serves all periods. The UI's
period selector shows per-period coverage and lockout, not a re-optimization.

**Greedy.** Lazy greedy on marginal gain per unit cost; for unit costs the
objective is monotone submodular, so greedy achieves ≥ (1 − 1/e) of optimal.
`evaluate(coverage, x)` is shared by every solver so all report the same units.

**Swap (A).** Teitz-Bart: starting from greedy, try every (in, out) swap and
accept improvements until no swap improves.

**Population-only baseline (A).** Place AEDs at the sites with the most
population within 2-3 min walk, ignoring lockout and survival.

## 6. Synthetic generator

`generate_instance(seed, extent_m=2000, n_cells≈1000, n_sites≈300, n_existing≈5)`:
- Grid of cells (about 32 × 32 over 2 km × 2 km).
- About 25-40 buildings placed as clusters, each with a kind: academic, library,
  residential, athletic, dining. The kind sets the population profile per
  period (academic busy by day and empty at night; residential busy evening and
  night; library open late).
- Cell population per period is the sum of nearby building populations
  (Gaussian kernel) plus a low background for outdoor foot traffic.
- Candidate sites are inside buildings (several per large building) plus a
  few outdoor 24/7 cabinets. `site_open` follows building hours; outdoor
  cabinets are always open. Floor delay depends on building size (30-120 s).
- Costs: 1.0 indoor, 1.5 outdoor cabinet (ASSUMPTION).
- The same seed always produces the same instance.

## 7. Experiments and outputs (core)

`experiments/k_curve.py`: for K = 0..30 (budget = K with unit cost), solve with
the ILP and greedy. It writes `results/k_curve.csv` (K, ilp_lives, greedy_lives,
gap, ilp_time_s) and `results/k_curve.png`. Expected outcome: a concave curve,
greedy within a few percent of the ILP.

The figures for the pitch are, from the teammates: Monte Carlo CI band on the
K-curve, site-frequency map, tornado, and baseline comparison bar chart.

## 8. Testing

- `tests/test_ilp_bruteforce.py`: tiny instance (about 20 cells, 8 sites, K=3):
  the ILP objective equals brute-force enumeration over all subsets.
- `tests/test_greedy_bound.py`: greedy ≥ (1 − 1/e)·ILP on several seeds, and greedy ≤ ILP.
- `tests/test_monotone.py`: the ILP optimum does not decrease in K.
- `tests/test_lockout.py`: a site closed in period p contributes nothing to period p.
- `tests/test_contract.py`: `generate_instance` output shapes, dtypes and value ranges are valid.

## 9. Validation plan

- Internal: brute-force equivalence, greedy bound, optimality gap reported.
- Comparison: optimal placement vs existing AEDs (synthetic now; registry
  later) gives the "lives gained by re-siting" result.
- Backtest on real arrest locations is out of scope unless data appears.
- Every headline number is reported as expected lives saved per year with a 90% interval.

## 10. Dependencies

`numpy`, `scipy>=1.9` (milp/HiGHS), `matplotlib`, `pytest`, `streamlit`,
`folium`, `streamlit-folium`. Later and optional: `osmnx`, `geopandas`.

## 11. Assumptions register (summary)

1. Only public-location arrests can be served by public AEDs.
2. A bystander fetches the AED and returns (round trip at walking speed).
3. Euclidean × detour approximates network distance (until OSMnx).
4. One placement for all periods; periods differ in demand and lockout only.
5. Survival depends only on time to defibrillation (CPR effect is folded into k range).
6. Ambulance response is constant across the campus (varied in sensitivity analysis).
7. Synthetic campus geography and foot traffic are illustrative.

## 12. Timeline

| When | Milestone |
|---|---|
| Sat ~15:00 | Core done, contract frozen, k_curve result |
| Sat 15:00-23:00 | A/B/C/D modules in parallel |
| Sat night / Sun early | Real data swap if on track |
| Sun 09:00-11:00 | Integration, figures, README |
| Sun 11:00 | Code freeze |
| Sun 13:00 | Submit |

## 13. Further reading

See `docs/model.md`, `docs/assumptions.md` and `docs/interfaces.md`.
