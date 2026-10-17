# Results log

## 2026-10-17, stub campus (seed 0)

- Lives saved per year with existing AEDs only: 0.071.
- ILP: 0.188 at K=5, 0.387 at K=15, 0.610 at K=30.
- Greedy is within 2.1% of the ILP at every K (worst at K=18).
- Monte Carlo, K=10 plan: 0.30 lives/yr, 90% interval 0.08-0.64.
- Most sensitive: ambulance response time, then walking speed.

The stub campus spreads people evenly, so the K-curve is nearly linear; re-run after the
real generator lands.
