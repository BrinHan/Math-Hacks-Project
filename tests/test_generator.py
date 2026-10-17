import numpy as np
import pytest

from aed.data.synthetic import generate_instance
from aed.params import Params
from aed.pipeline import build
from aed.solvers.greedy import solve_greedy


def _people(inst):
    p = Params()
    scale = p.incidence_per_100k_yr / 1e5 * p.public_fraction * inst.period_hours / 24
    return inst.cell_rate / scale


def test_demand_is_concentrated():
    r = np.sort(generate_instance(seed=0).cell_rate.sum(1))[::-1]
    assert r[: len(r) // 10].sum() / r.sum() >= 0.35


def test_building_people_conserved():
    # One academic building: building people (total minus background) keep the 800:100 day:evening ratio.
    inst = generate_instance(seed=0, n_buildings=1)
    cell_ha = (2000 / 32) ** 2 / 1e4
    bld = _people(inst).sum(0) - np.array([12.8, 7.7, 2.6]) * cell_ha * inst.n_cells
    assert bld[0] / bld[1] == pytest.approx(8.0, rel=1e-9) and abs(bld[2]) < 1e-6
    assert 400 - 1e-6 <= bld[0] <= 1600 + 1e-6


def test_background_density_independent_of_grid():
    a, b = generate_instance(seed=0, grid_n=32, n_buildings=1), generate_instance(seed=0, grid_n=16, n_buildings=1)
    assert _people(a)[:, 2].sum() == pytest.approx(_people(b)[:, 2].sum(), rel=1e-9)


def test_opening_by_kind():
    inst = generate_instance(seed=0); kinds = np.array(inst.site_kind)
    for k in ("academic", "residential", "athletic"):
        assert (kinds == k).any()
    assert inst.site_open[kinds == "residential", 2].all()
    assert inst.site_open[kinds == "academic", 1].all() and not inst.site_open[kinds == "academic", 2].any()
    assert not inst.site_open[kinds == "athletic", 2].any()


def test_indoor_sites_cluster_at_buildings():
    inst = generate_instance(seed=0); kinds = np.array(inst.site_kind)
    assert (kinds == "outdoor").sum() == max(1, round(0.1 * inst.n_sites))
    xy = inst.site_xy[kinds != "outdoor"]
    d = np.linalg.norm(xy[:, None] - xy[None], axis=2); np.fill_diagonal(d, np.inf)
    assert np.median(d.min(1)) < 30.0          # uniform placement gives ~60 m


def test_small_building_count():
    inst = generate_instance(seed=1, extent_m=600, grid_n=5, n_buildings=4, n_sites=8, n_existing=0)
    inst.validate(); kinds = np.array(inst.site_kind)
    assert inst.site_open[kinds != "outdoor", 2].any()   # one site per building guarantees residential/library


def test_fewer_sites_than_buildings():
    generate_instance(seed=0, n_buildings=30, n_sites=10).validate()


def test_zero_buildings_rejected():
    with pytest.raises(ValueError):
        generate_instance(seed=0, n_buildings=0)


def test_coordinates_inside_campus():
    for s in range(5):
        inst = generate_instance(seed=s)
        assert inst.site_xy.min() >= 0 and inst.site_xy.max() <= 2000


def test_concave_k_curve():
    _, cov = build(seed=0)
    l0, l10, l20 = (solve_greedy(cov, K).lives for K in (0, 10, 20))
    assert (l10 - l0) > 1.5 * (l20 - l10)


def test_building_people_exact():
    # n_buildings=1 draws no kinds, so the building's size is the first rng draw.
    inst = generate_instance(seed=0, n_buildings=1)
    cell_ha = (2000 / 32) ** 2 / 1e4
    bld = _people(inst).sum(0) - np.array([12.8, 7.7, 2.6]) * cell_ha * inst.n_cells
    size = np.random.default_rng(0).uniform(0.5, 2.0, size=1)[0]
    assert bld[0] == pytest.approx(800 * size, rel=1e-9)


def test_coarse_grid_large_campus_has_finite_demand():
    inst = generate_instance(seed=0, extent_m=20000, grid_n=5)
    assert np.isfinite(inst.cell_rate).all() and inst.cell_rate.sum() > 0


def test_zero_sites_rejected():
    with pytest.raises(ValueError):
        generate_instance(seed=0, n_sites=0)


def test_one_site_more_existing_than_indoor():
    inst = generate_instance(seed=0, n_sites=1, n_existing=5)
    inst.validate()
    assert inst.n_sites == 1 and not inst.site_existing.any()


def test_cells_inside_campus():
    inst = generate_instance(seed=0)
    assert inst.cell_xy.min() >= 0 and inst.cell_xy.max() <= 2000
