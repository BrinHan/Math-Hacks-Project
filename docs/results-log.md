# Results log

## 2026-10-17, stub campus (seed 0)

- Lives saved per year with existing AEDs only: 0.071.
- ILP: 0.188 at K=5, 0.387 at K=15, 0.610 at K=30.
- Greedy is within 2.1% of the ILP at every K (worst at K=18).
- Monte Carlo, K=10 plan: 0.30 lives/yr, 90% interval 0.08-0.64.
- Most sensitive: ambulance response time, then walking speed.

The stub campus spreads people evenly, so the K-curve is nearly linear; re-run after the
real generator lands.

## 2026-10-17, building-based campus (seed 0, Teammate 2 model)

Realistic generator (30 buildings, occupancy by period), public hazard ratio
0.18 / 0.313, shockable fraction 0.265. About 4.8 public arrests per year on campus.

| K new AEDs | ILP | greedy | swap | population-only | existing only |
| --- | --- | --- | --- | --- | --- |
| 0 | 0.034 | 0.034 | 0.034 | 0.034 | 0.034 |
| 5 | 0.088 | 0.087 | 0.087 | 0.050 | 0.034 |
| 10 | 0.120 | 0.116 | 0.120 | 0.052 | 0.034 |
| 20 | 0.159 | 0.154 | 0.157 | 0.058 | 0.034 |
| 30 | 0.178 | 0.175 | 0.176 | 0.062 | 0.034 |

Expected lives saved per year. Diminishing returns: the first 10 AEDs add 0.086, the
next 20 add 0.058. Greedy is within 4.2% of the ILP at every K; swap closes the gap at
K=10. Population-only placement clusters AEDs in the busiest buildings and reaches
less than half the optimum.

- Monte Carlo (n=200), K=10 plan: 0.116 lives/yr, 90% interval 0.037-0.244;
  re-optimising per scenario only reaches 0.119, so the plan is robust.
- One-at-a-time sensitivity at K=10 (base 0.120): ambulance response time
  (0.066-0.198), public fraction (0.080-0.167), shockable fraction (0.091-0.172),
  survival decay rate (0.058-0.126), incidence (0.087-0.153).
