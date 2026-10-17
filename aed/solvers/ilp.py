"""Gradual-cover maximal covering ILP solved with HiGHS via scipy.optimize.milp.

Variables [x (J) binary, z (R) continuous in [0, 1]]:
    max  weights . z
    s.t. z_r <= sum_j A_rj x_j          (row covered only if a chosen site reaches it)
         sum_j cost_j x_j <= budget     (existing AEDs cost 0)
         x_j = 1 for existing AEDs
z is integral at the optimum once x is binary, so only x needs integrality.
"""
import time

import numpy as np
import scipy.sparse as sp
from scipy.optimize import Bounds, LinearConstraint, milp

from aed.coverage import Coverage
from aed.solvers.common import Solution, evaluate


def solve_ilp(cov: Coverage, budget: float, time_limit_s: float = 60.0,
              mip_rel_gap: float = 1e-4) -> Solution:
    start = time.perf_counter()
    R, J = cov.A.shape
    existing = cov.site_existing
    if R == 0:
        x = existing.copy()
        return Solution(x=x, lives=evaluate(cov, x), method="ilp",
                        runtime_s=time.perf_counter() - start, mip_gap=0.0)

    cost = np.where(existing, 0.0, cov.site_cost)
    c = np.concatenate([np.zeros(J), -cov.weights])
    cover = LinearConstraint(sp.hstack([-cov.A, sp.identity(R)], format="csr"), -np.inf, 0.0)
    budget_row = LinearConstraint(np.concatenate([cost, np.zeros(R)])[None, :], -np.inf, budget)
    lb = np.concatenate([existing.astype(float), np.zeros(R)])
    integrality = np.concatenate([np.ones(J), np.zeros(R)])

    res = milp(c, constraints=[cover, budget_row], bounds=Bounds(lb, np.ones(J + R)),
               integrality=integrality,
               options={"time_limit": time_limit_s, "mip_rel_gap": mip_rel_gap})
    if res.x is None:
        raise RuntimeError(f"ILP failed: {res.message}")
    x = res.x[:J] > 0.5
    return Solution(x=x, lives=evaluate(cov, x), method="ilp",
                    runtime_s=time.perf_counter() - start,
                    mip_gap=getattr(res, "mip_gap", None))
