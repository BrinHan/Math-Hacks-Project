import dataclasses

import numpy as np

from aed.data.synthetic import generate_instance
from aed.params import CITATIONS, RANGES, Params


def test_params_have_ranges_and_citations():
    p = Params()
    for f in dataclasses.fields(p):
        assert f.name in CITATIONS
    for name, (lo, hi) in RANGES.items():
        assert lo <= getattr(p, name) <= hi


def test_band_edges_default():
    assert Params().band_edges_s == tuple(float(s) for s in range(60, 601, 60))


def test_generate_shapes_and_validate():
    inst = generate_instance(seed=0)
    inst.validate()
    assert inst.cell_xy.shape == (32 * 32, 2)
    assert inst.site_xy.shape == (300, 2)
    assert inst.cell_rate.shape == (1024, 3)
    assert inst.site_existing.sum() == 5


def test_generate_deterministic():
    a, b = generate_instance(seed=3), generate_instance(seed=3)
    assert np.array_equal(a.site_xy, b.site_xy) and np.array_equal(a.cell_rate, b.cell_rate)


def test_total_rate_plausible():
    total = generate_instance(seed=0).cell_rate.sum()
    assert 0.1 < total < 20  # public arrests/yr on one campus


def test_night_lockout_exists():
    inst = generate_instance(seed=0)
    assert inst.site_open[:, 0].sum() > inst.site_open[:, 2].sum() > 0


def test_outdoor_cost_applied():
    inst = generate_instance(seed=0, outdoor_cost=2.5)
    outdoor = np.array([k == "outdoor" for k in inst.site_kind])
    assert outdoor.any() and np.all(inst.site_cost[outdoor] == 2.5) and np.all(inst.site_open[outdoor])


def test_tiny_instance(tiny_instance):
    tiny_instance.validate()
    assert tiny_instance.n_sites == 8 and tiny_instance.n_cells == 25
