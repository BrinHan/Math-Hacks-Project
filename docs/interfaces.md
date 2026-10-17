# Interfaces

| Function | Returns |
| --- | --- |
| `build(seed=0, params=None, campus="synthetic", **gen_kwargs)` | `(Instance, Coverage)`; `campus="york"` loads Keele |
| `load_york(params=None, cell_m=50.0)` | York Keele `Instance` (with `walk_dist_m`) |
| `solve_ilp(cov, budget)` / `solve_greedy` / `solve_swap` | `Solution` |
| `solve_population(inst, cov, budget, radius_s=180.0, params=None)` | `Solution` (population-only baseline) |
| `evaluate(cov, x)` | expected lives saved per year |
| `evaluate_by_period(cov, x)` | lives per period (day, evening, night) |
| `metres_to_latlon(xy, origin_latlon)` | `(N, 2)` lat, lon |

`Solution` has `x`, `lives`, `method`, `runtime_s`, `mip_gap`, `new_sites(existing)`, `to_dict()`.

## Result files (`results/`)

| File | Columns |
| --- | --- |
| `k_curve.csv` | `K, ilp_lives, greedy_lives, swap_lives, pop_lives, existing_lives, gap_pct, ilp_time_s` |
| `mc_kcurve.csv` | `K, mean, p5, p95` |
| `site_freq.csv` | `site_id, x_m, y_m, lat, lon, kind, existing, freq` |
| `oat.csv` | `param, low_value, high_value, lives_at_low, lives_at_high, base_lives` |
| `placements.json` | new site ids chosen by the ILP for each K |

Fake rows in the same formats live in `results/mock/`.

## Running

```bash
pip install -r requirements.txt
python -m pytest -q
python experiments/run_all.py --seed 0 --n 200
```

`Instance.walk_dist_m` (optional, I x J metres): when set, travel time uses these walking-path
distances instead of straight-line x detour. Experiments take `--campus york|synthetic` (default york).
