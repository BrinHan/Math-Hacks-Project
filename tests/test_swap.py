import numpy as np
import pytest

from aed.pipeline import build
from aed.solvers.common import evaluate
from aed.solvers.greedy import solve_greedy
from aed.solvers.ilp import solve_ilp
from aed.solvers.swap import solve_swap


@pytest.mark.parametrize("seed", [0, 1])
def test_swap_between_greedy_and_ilp(seed):
    _, cov = build(seed=seed, grid_n=12, n_buildings=8, n_sites=40, n_existing=2, outdoor_cost=1.0)
    for K in (3, 6):
        g, s, opt = solve_greedy(cov, K), solve_swap(cov, K), solve_ilp(cov, K)
        assert g.lives - 1e-9 <= s.lives <= opt.lives + 1e-9
        assert s.x[cov.site_existing].all() and (s.x & ~cov.site_existing).sum() <= K
        assert s.lives == pytest.approx(evaluate(cov, s.x))


def test_swap_improves_bad_start():
    _, cov = build(seed=0, grid_n=12, n_buildings=8, n_sites=40, n_existing=0, outdoor_cost=1.0)
    worst = np.zeros(40, bool)
    worst[np.argsort(np.asarray(cov.A.sum(axis=0)).ravel())[:4]] = True  # least-covering sites
    init = solve_greedy(cov, 0)
    init.x, init.lives = worst, evaluate(cov, worst)
    s = solve_swap(cov, 4, init=init)
    assert s.lives > init.lives and s.x.sum() <= 4


def test_swap_zero_budget():
    _, cov = build(seed=0, grid_n=12, n_buildings=8, n_sites=40, n_existing=2)
    assert np.array_equal(solve_swap(cov, 0).x, cov.site_existing)


def test_swap_respects_costs():
    _, cov = build(seed=0, grid_n=12, n_sites=40, n_existing=2, outdoor_cost=1.5)
    sol = solve_swap(cov, 3)
    assert cov.site_cost[sol.x & ~cov.site_existing].sum() <= 3 + 1e-9
