# Model

We choose where to put K new AEDs on one campus to maximise **expected lives saved per
year compared with waiting for the ambulance**, given that buildings lock at night and
some AEDs already exist.

## Demand

The campus is a grid of cells i. The week has five periods p (weekday morning, afternoon
and evening, night, weekend; `PERIOD_HOURS` in `aed/data/york.py`). Expected public
cardiac arrests per year in cell i during p:

```
rate_ip = people_ip * incidence / 100,000 * (public_fraction / away_time_share) * hours_p / 24
```

`people_ip` already counts only people present on campus, so they are in public. 17.8% of
arrests happen in public while people spend 31.3% of their time away from home (Klepeis
2001), so a person in public has about 0.57 times the average arrest hazard (younger and
healthier people are the ones out). Arrests at home are excluded, with one stated
exception: residents of residential halls are counted (assumption 11) and given the same
public hazard ratio, although their at-home hazard would be about 2x higher.

Where the ratio comes from. Take N people with incidence λ per person-year. They spend a
share a = `away_time_share` of their time away from home, and a share f = `public_fraction`
of their arrests happen there. Let h be the arrest rate per person-year spent in public.
Counting public arrests two ways gives `h * a * N = f * λ * N`, so `h = λ * f / a`. A person
on campus for a fraction `hours_p / 24` of the day therefore contributes
`λ * (f / a) * hours_p / 24`, which is the formula above. The step assumes that time away
from home is time in a public setting (CARES counts every non-home, non-nursing-home arrest
as public), and that the hazard per hour in public is the same for everyone out. Both are
approximations: the campus is younger than the population behind λ (assumption 12).

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
helps arrests with a shockable rhythm (VF/pVT; 0.265 = all public arrests, Fordyce 2017;
range 0.20-0.38, Weisfeldt 2011). Bands slower than the ambulance are worth 0.

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
keeps the solver fast: York has 14,875 rows and 193 sites, and most budgets solve in about
1 s (K = 1 and 2 are the slowest, at 18 s and 9 s; `results/york/k_curve.csv`).

## Baselines

- **Greedy** adds the site with the largest gain per unit cost. With equal costs it reaches
  at least 63% (1 - 1/e) of optimal (Nemhauser, Wolsey and Fisher, 1978), because the
  objective is monotone submodular. Why: for a set X of sites, `f(X) = sum_r w_r [X reaches r]`
  with `w_r = rate_ip (b_k - b_{k+1}) >= 0`, since `b_k` does not increase with k. Each term is
  0 until some site in X reaches row r and 1 after. Adding a site never lowers f (monotone).
  Adding site j to a larger set T helps only on rows no site in T already reaches, which
  are a subset of the rows it helps for any S inside T (submodular). A sum of such terms
  with non-negative weights keeps both properties. Forcing the existing AEDs on keeps them
  too, so the bound holds for the K new sites. `tests/test_greedy.py` checks the diminishing
  gains on random nested sets.
- **Swap (Teitz-Bart)** starts from greedy and exchanges one chosen site for one unchosen
  site while that improves the objective.
- **Population-only** ranks sites by the arrest rate within a 3-minute one-way walk
  (about 194 m), ignoring opening hours and survival, and takes the top sites that fit.

## Shape of the survival curve

The exponential form is an assumption, so we re-solved York with a linear curve,
`S(t) = S0 (1 - k t)`, at the same S0 and k (`experiments/survival_form.py`,
`results/york/survival_form.json`). The level changes a lot: the linear curve drops the
ambulance baseline to S(9 min) = 0.07 instead of 0.28, so every AED is worth more, and lives
saved roughly double (0.175 to 0.324 at K = 10). The decision barely changes:

- K = 10 on top of the published 19: the two plans share 8 of 10 sites. Using the exponential
  plan when the truth is linear loses 0.12% of the achievable lives; the reverse loses 0.21%.
- Best 19 anywhere: 13 of 19 sites shared, regret under 0.3% either way, and the gain over
  York's published 19 is +68% (linear) against +74% (exponential).

So the curve's shape sets how many lives the plan saves, not where the AEDs should go.

## Occupancy schedule

Occupancy comes from an assumed schedule, because York's timetable needs a login.
`experiments/occupancy.py` tests it two ways (`results/york/occupancy.json`):

- Scaling every schedule value by an independent factor in [0.5, 1.5] (40 draws). The
  K = 10 plan loses 0.13% on average against re-optimising (95th percentile 0.48%). The
  best 19 loses 2.1% (95th percentile 4.7%). The re-siting gain over York's published 19
  stays between +63% and +87% (5th to 95th percentile), around the base +74%.
- Flattening the schedule so demand is the same all week. That plan, scored under the real
  schedule, loses 2.5% at K = 10 and 8.2% for the best 19. So modelling the week adds a few
  percent; most of the gain comes from where the AEDs are relative to people and paths.

## Uncertainty

Monte Carlo: each scenario draws every parameter uniformly in its range, scales demand by
0.7-1.3, and flips the opening hours of 10% of sites. Uniform is deliberate: the sources
give ranges, not distributions, and uniform puts the most weight on the range ends, so it
gives the widest band. A triangular prior over the same ranges, peaked at the base values,
gives a K = 10 mean of 0.166 with a 90% interval of 0.084-0.302, against 0.156 and
0.060-0.335 for uniform (`experiments/prior_check.py`, `results/york/prior_check.json`). We report the base-case plan's lives
saved as a mean with a 90% interval, and how often each site is chosen when re-optimised.
One-at-a-time sensitivity moves each parameter to its low and high value (tornado chart).

## Validation

- The ILP matches brute-force enumeration on a small campus.
- Greedy stays above the 63% bound, and swap lands between greedy and the ILP.
- The optimality gap of greedy vs the ILP is reported for every K.
- Numbers are always expected lives per year with an interval, never exact.

### Reading the sensitivity results

- `incidence_per_100k_yr`, `public_fraction` and `shockable_fraction` only rescale the
  objective: they change lives saved but never which sites are chosen.
- Lives saved *rise* with the decay rate `k` over its range. Faster decay hurts the
  ambulance baseline more than a nearby AED, so the gap an AED closes grows (the benefit
  peaks near k = 0.17/min). The range for `k` (0.03-0.12) is centred below the no-CPR
  base of 0.10, so the Monte Carlo mean sits slightly below the base case.

## York University Keele campus

The headline results use the real Keele campus (`aed/data/york.py`, data in `data/york/`):
86 buildings from OpenStreetMap classified by use, 16,008 classroom seats (York UIT),
2,347 residence beds (York Housing) and York's 19 published AEDs. Demand is built per
building from seats, floor area and beds over five weekly periods (`docs/assumptions.md`
14-22), and travel time uses shortest walking paths on the campus footpath network.

Validation compares York's 19 published AEDs with the best 19 sites the ILP would choose
(`experiments/york_validation.py`), and lists busy buildings whose nearest published AED
is more than 4 minutes from collapse to shock.
