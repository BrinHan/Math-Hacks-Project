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

## 2026-10-17, York University Keele campus (headline)

Real campus: 86 buildings (OpenStreetMap), 16,008 classroom seats, residence beds from the
York Housing handbook plus York-run apartments, York's 19 published AEDs, walking paths.
About 3.7 public cardiac arrests per year on campus. Files: `results/york/`.

**Absolute numbers first.** York's 19 published AEDs save an expected **0.100 lives per year**
compared with waiting for the ambulance.

| New AEDs on top of York's 19 | ILP | greedy | population-only |
| --- | --- | --- | --- |
| 0 | 0.100 | 0.100 | 0.100 |
| 5 | 0.157 | 0.157 | 0.109 |
| 10 | 0.175 | 0.173 | 0.113 |
| 20 | 0.194 | 0.193 | 0.119 |
| 30 | 0.206 | 0.205 | 0.125 |

Five well-placed AEDs add 0.057 lives/yr (about 0.011 per AED, one extra survivor every
~17 years for the five); greedy stays within 1.0% of the ILP. Monte Carlo (n = 200),
K = 10 plan: 0.156 lives/yr, 90% interval 0.060-0.335.

**Re-siting York's 19 AEDs** (`results/york/york_validation.json`):

| Scenario | York's 19 | same 19 at their door | best 19 | gain |
| --- | --- | --- | --- | --- |
| base case | 0.100 | 0.108 | 0.173 | +74% |
| handbook beds only | 0.099 | 0.107 | 0.158 | +59% |
| incl. private housing | 0.101 | 0.111 | 0.200 | +99% |
| no residents | 0.098 | 0.105 | 0.135 | +38% |
| shortcut radius 200 m | 0.103 | 0.112 | 0.174 | +69% |
| footpaths only | 0.063 | 0.080 | 0.145 | +129% |

Range +38% to +99% across plausible scenarios (the footpaths-only row is inflated by the
footpath map missing indoor routes). The door step mainly tests the 45 s vs 20 s access
assumption; most of the gain comes from moving AEDs to residences and busy college
buildings. Busy buildings over a 3-minute walk from a published AED: Winters, Founders and
McLaughlin colleges, Atkinson, Sherman Health Science Research Centre, Pond Road Residence.
Caveat: York's published map may omit residence or patrol AEDs, which would shrink the gain.

Sensitivity (K = 10): public fraction and ambulance response time move lives most
(0.117-0.244), then shockable fraction (0.132-0.251) and survival decay (0.081-0.186).
