import itertools

import numpy as np
import pytest

from aed.coverage import build_coverage
from aed.params import Params
from aed.pipeline import build
from aed.solvers.common import evaluate
from aed.solvers.ilp import solve_ilp
from aed.travel import travel_time_matrix

SMALL = dict(grid_n=12, n_buildings=8, n_sites=40, n_existing=2)


def brute_best(cov, K):
    J = cov.A.shape[1]
    best = 0.0
    for S in itertools.combinations(range(J), K):
        x = np.zeros(J, bool); x[list(S)] = True
        best = max(best, evaluate(cov, x))
    return best


def tiny_cov(inst, p=None):
    p = p or Params()
    return build_coverage(inst, travel_time_matrix(inst, p), p)


def test_ilp_matches_bruteforce(tiny_instance):
    cov = tiny_cov(tiny_instance)
    for K in (1, 2, 3):
        sol = solve_ilp(cov, budget=K)
        assert sol.x.sum() <= K
        assert sol.lives == pytest.approx(brute_best(cov, K), rel=1e-6)


def test_ilp_monotone_in_budget():
    _, cov = build(seed=0, **SMALL)
    lives = [solve_ilp(cov, K).lives for K in range(6)]
    assert all(b >= a - 1e-9 for a, b in zip(lives, lives[1:]))


def test_existing_forced_on():
    _, cov = build(seed=0, **SMALL)
    assert solve_ilp(cov, 3).x[cov.site_existing].all()


def test_zero_budget():
    _, cov = build(seed=0, **SMALL)
    sol = solve_ilp(cov, 0)
    assert np.array_equal(sol.x, cov.site_existing)
    assert sol.lives == pytest.approx(evaluate(cov, cov.site_existing))


def test_empty_coverage(tiny_instance):
    cov = tiny_cov(tiny_instance, Params(ems_response_s=30.0))
    assert solve_ilp(cov, 3).lives == 0.0


def test_ilp_respects_costs():
    _, cov = build(seed=0, outdoor_cost=1.5, **SMALL)
    sol = solve_ilp(cov, 3)
    assert cov.site_cost[sol.x & ~cov.site_existing].sum() <= 3 + 1e-9
