import dataclasses

import numpy as np
import pytest

from aed.data.synthetic import generate_instance
from aed.params import Params
from aed.survival import band_benefits, survival
from aed.travel import travel_time_matrix


def test_travel_formula():
    inst = generate_instance(seed=0); p = Params()
    tau = travel_time_matrix(inst, p)
    assert tau.shape == (inst.n_cells, inst.n_sites)
    i, j = 10, 20
    d = np.linalg.norm(inst.cell_xy[i] - inst.site_xy[j])
    assert tau[i, j] == pytest.approx(60 + 2 * 1.3 * d / 1.4 + inst.site_floor_delay[j])


def test_survival_exp_and_linear():
    p = Params()
    assert survival(0.0, p) == pytest.approx(0.7)
    assert survival(60.0, p) == pytest.approx(0.7 * np.exp(-0.1))
    pl = dataclasses.replace(p, survival_form="linear")
    assert survival(60.0, pl) == pytest.approx(0.63)
    assert survival(1e5, pl) == 0.0


def test_band_benefits_drop_after_ems():
    edges, b = band_benefits(Params())
    assert edges.max() < 540 and np.all(np.diff(b) <= 0) and np.all(b > 0)


def test_band_benefits_empty_when_ems_fastest():
    edges, b = band_benefits(Params(ems_response_s=30.0))
    assert edges.size == 0 and b.size == 0


def test_travel_time_grows_with_distance():
    inst = generate_instance(seed=0, grid_n=6, n_sites=10)
    inst.site_floor_delay[:] = 0.0
    tau = travel_time_matrix(inst, Params())
    d = np.linalg.norm(inst.cell_xy[:, None] - inst.site_xy[None], axis=2)
    order = np.argsort(d[0])
    assert np.all(np.diff(tau[0, order]) >= -1e-9)


def test_floor_delay_adds_directly():
    inst = generate_instance(seed=0, grid_n=6, n_sites=10)
    before = travel_time_matrix(inst, Params())
    inst.site_floor_delay[3] += 30.0
    after = travel_time_matrix(inst, Params())
    assert np.allclose(after[:, 3] - before[:, 3], 30.0)
