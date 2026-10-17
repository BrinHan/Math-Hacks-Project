"""Teitz-Bart vertex substitution: improve a placement by single add / swap moves."""
import time

import numpy as np

from aed.coverage import Coverage
from aed.solvers.common import Solution, evaluate
from aed.solvers.greedy import solve_greedy

EPS = 1e-12


def solve_swap(cov: Coverage, budget: float, init: Solution | None = None,
               max_passes: int = 50) -> Solution:
    start = time.perf_counter()
    init = init or solve_greedy(cov, budget)
    A = cov.A.tocsc()
    R, J = cov.A.shape
    x = init.x.copy()
    count = (cov.A @ x.astype(float)).round().astype(np.int64)  # chosen sites covering each row
    cost = np.where(cov.site_existing, 0.0, cov.site_cost)
    rows = [A.indices[A.indptr[j]:A.indptr[j + 1]] for j in range(J)]

    def apply(j: int, sign: int) -> None:
        x[j] = sign > 0
        count[rows[j]] += sign

    for _ in range(max_passes):
        improved = False
        for j in np.flatnonzero(~x):
            gain = cov.weights[rows[j][count[rows[j]] == 0]].sum()
            if gain <= EPS:
                continue
            spent = cost[x].sum()
            if spent + cost[j] <= budget + EPS:
                apply(j, +1)
                improved = True
                continue
            in_j = np.zeros(R, dtype=bool)
            in_j[rows[j]] = True
            for o in np.flatnonzero(x & ~cov.site_existing):
                if spent - cost[o] + cost[j] > budget + EPS:
                    continue
                ro = rows[o]
                loss = cov.weights[ro[(count[ro] == 1) & ~in_j[ro]]].sum()
                if gain - loss > EPS:
                    apply(o, -1)
                    apply(j, +1)
                    improved = True
                    break
        if not improved:
            break

    return Solution(x=x, lives=evaluate(cov, x), method="swap",
                    runtime_s=time.perf_counter() - start)
