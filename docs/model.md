# Model

We choose where to put K new AEDs on one campus to maximise **expected lives saved per
year compared with waiting for the ambulance**, given that buildings lock at night and
some AEDs already exist.

## Demand

The campus is a grid of cells i. Over a day there are three periods p (day 10 h,
evening 6 h, night 8 h). Expected public cardiac arrests per year in cell i during p:

```
rate_ip = people_ip * incidence / 100,000 * public_fraction * hours_p / 24
```

Only public arrests count: an arrest at home is rarely reachable from a public AED.

## Time to defibrillation

A bystander sets off after a dispatch delay, walks to the AED, and brings it back:

```
tau_ij = dispatch_delay + 2 * detour * distance_ij / walk_speed + floor_delay_j
```

Distance is straight-line times a detour factor until real walking paths (OSMnx) are added.

The synthetic campus places 30 buildings of five kinds (academic core, residential ring,
athletic fields) whose occupancy changes by period; see `docs/assumptions.md`.

## Survival and the ambulance baseline

Survival if shocked t minutes after collapse: `S(t) = S0 * exp(-k t)`. Without a nearby
AED the patient waits for the ambulance, so the benefit of an AED arriving within band
T_k is `b_k = f * max(0, S(T_k) - S(T_ems))`, where `f` is the shockable fraction: an AED only
helps arrests with a shockable rhythm (VF/pVT; 0.40, range 0.26-0.60, Weisfeldt 2011,
Fordyce 2017). Bands slower than the ambulance are worth 0.

## Optimisation (gradual-cover maximal covering)

With `x_j` = AED at site j and `z_ipk` = cell i in period p reached within band k:

```latex
\max \sum_{i,p,k} rate_{ip} (b_k - b_{k+1}) z_{ipk}
\quad \text{s.t.} \quad z_{ipk} \le \sum_{j:\ \tau_{ij} \le T_k,\ open_{jp}} x_j,
\quad \sum_j c_j x_j \le K, \quad x_j = 1 \text{ for existing AEDs}.
```

Reachable sets grow with k, so the covered terms add up to `rate_ip * b(fastest band)`.
Solved with HiGHS through `scipy.optimize.milp`.

Only `x` is declared integer. For fixed binary `x` each `z_ipk` is either forced to 0 or
free up to 1, and the objective pushes it to 1, so the optimum is integral anyway. This
keeps the solver fast: about 13,700 rows solve in a few seconds.

## Baselines

- **Greedy** adds the site with the largest gain per unit cost. The objective is monotone
  submodular, so with equal costs greedy reaches at least 63% (1 - 1/e) of optimal.
- **Swap (Teitz-Bart)** starts from greedy and exchanges one chosen site for one unchosen
  site while that improves the objective.
- **Population-only** ranks sites by the arrest rate within a 3-minute one-way walk
  (about 194 m), ignoring opening hours and survival, and takes the top sites that fit.

## Uncertainty

Monte Carlo: each scenario draws every parameter uniformly in its range, scales demand by
0.7-1.3, and flips the opening hours of 10% of sites. We report the base-case plan's lives
saved as a mean with a 90% interval, and how often each site is chosen when re-optimised.
One-at-a-time sensitivity moves each parameter to its low and high value (tornado chart).

## Validation

- The ILP matches brute-force enumeration on a small campus.
- Greedy stays above the 63% bound, and swap lands between greedy and the ILP.
- The optimality gap of greedy vs the ILP is reported for every K.
- Numbers are always expected lives per year with an interval, never exact.
