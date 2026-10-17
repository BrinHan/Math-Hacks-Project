import numpy as np
import pytest

from aed.coverage import build_coverage
from aed.params import Params
from aed.pipeline import build
from aed.solvers.common import evaluate
from aed.solvers.greedy import solve_greedy
from aed.solvers.ilp import solve_ilp
from aed.travel import travel_time_matrix


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_greedy_bound(seed):
    # The (1 - 1/e) guarantee needs unit costs.
    _, cov = build(seed=seed, grid_n=12, n_buildings=8, n_sites=40, n_existing=0, outdoor_cost=1.0)
    for K in (2, 5):
        g, opt = solve_greedy(cov, K), solve_ilp(cov, K)
        assert g.x.sum() <= K
        assert (1 - 1 / np.e) * opt.lives - 1e-9 <= g.lives <= opt.lives + 1e-9
        assert g.lives == pytest.approx(evaluate(cov, g.x))


@pytest.mark.parametrize("seed", [0, 1])
def test_objective_monotone_submodular(seed):
    # The premise of the (1 - 1/e) bound: for S subset of T and j outside T,
    # 0 <= f(T + j) - f(T) <= f(S + j) - f(S).
    _, cov = build(seed=seed, grid_n=12, n_buildings=8, n_sites=40, n_existing=0)
    rng = np.random.default_rng(seed)
    J = cov.A.shape[1]
    for _ in range(200):
        T = rng.random(J) < rng.uniform(0.1, 0.6)
        S = T & (rng.random(J) < 0.5)
        j = rng.choice(np.flatnonzero(~T))
        gain_T = evaluate(cov, T | (np.arange(J) == j)) - evaluate(cov, T)
        gain_S = evaluate(cov, S | (np.arange(J) == j)) - evaluate(cov, S)
        assert -1e-12 <= gain_T <= gain_S + 1e-12


def test_greedy_zero_budget():
    _, cov = build(seed=0, grid_n=12, n_buildings=8, n_sites=40, n_existing=2)
    assert np.array_equal(solve_greedy(cov, 0).x, cov.site_existing)


def test_budget_exceeds_all(tiny_instance):
    p = Params()
    cov = build_coverage(tiny_instance, travel_time_matrix(tiny_instance, p), p)
    g = solve_greedy(cov, 1e6)
    assert g.lives == pytest.approx(evaluate(cov, np.ones(8, bool)))


def test_greedy_respects_costs():
    _, cov = build(seed=0, grid_n=12, n_sites=40, n_existing=2, outdoor_cost=1.5)
    sol = solve_greedy(cov, 3)
    assert cov.site_cost[sol.x & ~cov.site_existing].sum() <= 3 + 1e-9


def test_greedy_deterministic():
    _, cov = build(seed=1, grid_n=12, n_sites=40, n_existing=2)
    assert np.array_equal(solve_greedy(cov, 4).x, solve_greedy(cov, 4).x)
