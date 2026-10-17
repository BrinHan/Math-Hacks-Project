"""Lazy greedy by marginal gain per unit cost (>= 1 - 1/e of optimal for unit costs)."""
import heapq
import time

import numpy as np

from aed.coverage import Coverage
from aed.solvers.common import Solution, evaluate


def solve_greedy(cov: Coverage, budget: float) -> Solution:
    start = time.perf_counter()
    A = cov.A.tocsc()
    x = cov.site_existing.copy()
    covered = (cov.A @ x.astype(float)) >= 1

    def gain(j: int) -> float:
        rows = A.indices[A.indptr[j]:A.indptr[j + 1]]
        return float(cov.weights[rows[~covered[rows]]].sum())

    remaining = float(budget)
    heap = [(-gain(j) / cov.site_cost[j], j) for j in np.flatnonzero(~x)]
    heapq.heapify(heap)
    while heap:
        neg_ratio, j = heapq.heappop(heap)
        if cov.site_cost[j] > remaining + 1e-12:
            continue  # budget only shrinks, so j never becomes affordable again
        ratio = gain(j) / cov.site_cost[j]
        if heap and ratio < -heap[0][0]:
            heapq.heappush(heap, (-ratio, j))  # stale bound; re-queue with the true value
            continue
        if ratio <= 0:
            break  # j has the best true ratio and every other bound is no higher
        x[j] = True
        remaining -= cov.site_cost[j]
        covered[A.indices[A.indptr[j]:A.indptr[j + 1]]] = True

    return Solution(x=x, lives=evaluate(cov, x), method="greedy",
                    runtime_s=time.perf_counter() - start)
