import numpy as np
import pytest

from aed.coverage import build_coverage
from aed.params import Params
from aed.pipeline import build
from aed.solvers.common import evaluate, evaluate_by_period
from aed.survival import band_benefits
from aed.travel import travel_time_matrix


def brute_lives(inst, tau, p, x):
    """Direct spec formula: sum over (i, p) of rate * b(fastest open selected site)."""
    edges, b = band_benefits(p)
    total = 0.0
    for i in range(inst.n_cells):
        for q in range(inst.n_periods):
            ok = x & inst.site_open[:, q] & (tau[i] <= p.max_tau_s)
            if ok.any():
                k = np.searchsorted(edges, tau[i, ok].min())  # first edge >= t
                if k < len(b):
                    total += inst.cell_rate[i, q] * b[k]
    return total


def cov_for(inst, p=None):
    p = p or Params()
    return build_coverage(inst, travel_time_matrix(inst, p), p)


def test_evaluate_matches_direct_formula(tiny_instance):
    p = Params(); tau = travel_time_matrix(tiny_instance, p)
    cov = build_coverage(tiny_instance, tau, p)
    rng = np.random.default_rng(0)
    for _ in range(10):
        x = rng.random(8) < 0.4
        assert evaluate(cov, x) == pytest.approx(brute_lives(tiny_instance, tau, p, x))


def test_evaluate_by_period_sums_to_total(tiny_instance):
    cov = cov_for(tiny_instance)
    x = np.ones(8, bool)
    assert evaluate_by_period(cov, x).sum() == pytest.approx(evaluate(cov, x))


def test_all_closed_period(tiny_instance):
    tiny_instance.site_open[:, 2] = False
    assert evaluate_by_period(cov_for(tiny_instance), np.ones(8, bool))[2] == 0.0


def test_unreachable_cell(tiny_instance):
    tiny_instance.cell_xy[0] = [1e6, 1e6]
    assert 0 not in cov_for(tiny_instance).row_cell


def test_ems_faster_than_all_bands(tiny_instance):
    cov = cov_for(tiny_instance, Params(ems_response_s=30.0))
    assert cov.A.shape[0] == 0 and evaluate(cov, np.ones(8, bool)) == 0.0


def test_build_pipeline():
    inst, cov = build(seed=0, grid_n=12, n_sites=40, n_existing=2)
    assert cov.A.shape[1] == inst.n_sites == 40
    assert np.array_equal(cov.site_existing, inst.site_existing)


def test_max_lives_is_all_sites(tiny_instance):
    cov = cov_for(tiny_instance)
    assert cov.max_lives() == pytest.approx(evaluate(cov, np.ones(8, bool)))
    assert cov.n_rows == cov.A.shape[0]


def test_band_sets_nested(tiny_instance):
    cov = cov_for(tiny_instance)
    sites = {}
    for r in range(cov.n_rows):
        key = (cov.row_cell[r], cov.row_period[r], cov.row_band[r])
        sites[key] = set(cov.A.indices[cov.A.indptr[r]:cov.A.indptr[r + 1]])
    for (i, q, k), s in sites.items():
        if (i, q, k + 1) in sites:
            assert s <= sites[(i, q, k + 1)]
