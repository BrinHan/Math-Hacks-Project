import numpy as np

from aed.params import Params
from aed.pipeline import build
from aed.solvers.common import evaluate
from aed.solvers.ilp import solve_ilp
from aed.solvers.population import solve_population

SMALL = dict(grid_n=12, n_buildings=8, n_sites=40, n_existing=2)


def _score(inst, radius_s=180.0):
    p = Params()
    d = np.linalg.norm(inst.cell_xy[:, None] - inst.site_xy[None], axis=2)
    walk = p.detour_factor * d / p.walk_speed_mps
    return np.where(walk <= radius_s, inst.cell_rate.sum(1)[:, None], 0.0).sum(0)


def test_population_within_budget_and_below_ilp():
    inst, cov = build(seed=0, **SMALL)
    for K in (2, 5):
        pop, opt = solve_population(inst, cov, K), solve_ilp(cov, K)
        assert cov.site_cost[pop.x & ~cov.site_existing].sum() <= K + 1e-9
        assert evaluate(cov, cov.site_existing) - 1e-9 <= pop.lives <= opt.lives * (1 + 1e-4) + 1e-9
        assert pop.method == "population" and pop.x[cov.site_existing].all()


def test_population_zero_budget():
    inst, cov = build(seed=0, **SMALL)
    assert np.array_equal(solve_population(inst, cov, 0).x, cov.site_existing)


def test_population_picks_busiest_site_first():
    inst, cov = build(seed=0, grid_n=12, n_buildings=8, n_sites=40, n_existing=0, outdoor_cost=1.0)
    assert solve_population(inst, cov, 1).x[np.argmax(_score(inst))]


def test_population_uses_one_way_walk_with_given_params():
    inst, cov = build(seed=0, grid_n=12, n_buildings=8, n_sites=40, n_existing=0, outdoor_cost=1.0)
    p = Params(walk_speed_mps=2.0, detour_factor=1.2)
    d = np.linalg.norm(inst.cell_xy[:, None] - inst.site_xy[None], axis=2)
    score = np.where(1.2 * d / 2.0 <= 400.0, inst.cell_rate.sum(1)[:, None], 0.0).sum(0)
    sol = solve_population(inst, cov, 1, radius_s=400.0, params=p)
    assert sol.x[np.argmax(score)] and sol.x.sum() == 1
