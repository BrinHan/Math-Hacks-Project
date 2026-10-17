# Interfaces

| Function | Returns |
| --- | --- |
| `build(seed=0, params=None, **gen_kwargs)` | `(Instance, Coverage)` |
| `solve_ilp(cov, budget)` / `solve_greedy` / `solve_swap` | `Solution` |
| `evaluate(cov, x)` | expected lives saved per year |
| `evaluate_by_period(cov, x)` | lives per period (day, evening, night) |
| `metres_to_latlon(xy, origin_latlon)` | `(N, 2)` lat, lon |

`Solution` has `x`, `lives`, `method`, `runtime_s`, `mip_gap`, `new_sites(existing)`, `to_dict()`.
