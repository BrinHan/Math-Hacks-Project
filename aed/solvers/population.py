"""Population-only baseline: put AEDs where the most arrests happen, ignoring time bands.

Score of site j = sum over cells i and periods p of cell_rate[i, p] for every cell whose
one-way walking time detour_factor * ||cell_i - site_j|| / walk_speed_mps <= radius_s.
There is no dispatch delay, no round trip and no floor delay in the score (180 s is about
194 m at the default parameters). Opening hours and survival are ignored. Starting from the
existing AEDs, non-existing sites are walked in descending score (stable: ties go to the
lower index) and each one whose cost fits the remaining budget is added, zero-score sites
included while budget remains. The reported lives value is the true objective, evaluate().
"""
import time

import numpy as np

from aed.coverage import Coverage
from aed.instance import Instance
from aed.params import Params
from aed.solvers.common import Solution, evaluate


def solve_population(inst: Instance, cov: Coverage, budget: float,
                     radius_s: float = 180.0, params: Params | None = None) -> Solution:
    start = time.perf_counter()
    p = params or Params()
    dist = np.linalg.norm(inst.cell_xy[:, None, :] - inst.site_xy[None, :, :], axis=2)
    near = p.detour_factor * dist / p.walk_speed_mps <= radius_s       # (I, J)
    score = inst.cell_rate.sum(axis=1) @ near                          # (J,)

    x = cov.site_existing.copy()
    remaining = float(budget)
    for j in np.argsort(-score, kind="stable"):
        if x[j] or cov.site_cost[j] > remaining + 1e-12:
            continue
        x[j] = True
        remaining -= cov.site_cost[j]

    return Solution(x=x, lives=evaluate(cov, x), method="population",
                    runtime_s=time.perf_counter() - start)
