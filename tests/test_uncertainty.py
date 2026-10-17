import dataclasses

import numpy as np

from aed import uncertainty
from aed.data.synthetic import generate_instance
from aed.params import RANGES, Params
from aed.uncertainty import monte_carlo, monte_carlo_curve, oat_sensitivity, sample_scenario

SMALL = dict(grid_n=12, n_buildings=8, n_sites=40, n_existing=2)


def test_monte_carlo_deterministic_and_bounded(monkeypatch):
    monkeypatch.setattr(uncertainty, "GEN_KWARGS", SMALL)
    a = monte_carlo(seed=0, budget=3, n=20, rng_seed=7)
    b = monte_carlo(seed=0, budget=3, n=20, rng_seed=7)
    assert np.array_equal(a.lives_fixed, b.lives_fixed)
    assert np.all(a.lives_fixed >= 0) and np.all(a.lives_reopt >= 0)
    assert np.all((a.site_freq >= 0) & (a.site_freq <= 1))


def test_existing_sites_always_selected(monkeypatch):
    monkeypatch.setattr(uncertainty, "GEN_KWARGS", SMALL)
    res = monte_carlo(seed=0, budget=3, n=10)
    inst = generate_instance(seed=0, **SMALL)
    assert np.all(res.site_freq[inst.site_existing] == 1.0)


def test_sample_scenario_does_not_mutate():
    inst = generate_instance(seed=0, **SMALL); before = inst.site_open.copy()
    rate_before = inst.cell_rate.copy()
    sample_scenario(inst, Params(), np.random.default_rng(0))
    assert np.array_equal(inst.site_open, before) and np.array_equal(inst.cell_rate, rate_before)


def test_sampled_incidence_rescales_demand():
    inst = generate_instance(seed=0, **SMALL)
    s_inst, s_p = sample_scenario(inst, Params(), np.random.default_rng(1))
    for name, (lo, hi) in RANGES.items():
        assert lo <= getattr(s_p, name) <= hi
    ratio = s_inst.cell_rate.sum() / inst.cell_rate.sum()
    epi = (s_p.incidence_per_100k_yr / 55.0) * (s_p.public_fraction / 0.18)
    assert 0.7 * epi - 1e-9 <= ratio <= 1.3 * epi + 1e-9


def test_oat_covers_every_range(monkeypatch):
    monkeypatch.setattr(uncertainty, "GEN_KWARGS", SMALL)
    rows = oat_sensitivity(seed=0, budget=3)
    assert {r.param for r in rows} == set(RANGES)
    spans = [abs(r.lives_at_high - r.lives_at_low) for r in rows]
    assert spans == sorted(spans, reverse=True)
    inc = next(r for r in rows if r.param == "incidence_per_100k_yr")
    assert inc.lives_at_high > inc.base_lives > inc.lives_at_low


def test_curve_matches_single_budget(monkeypatch):
    monkeypatch.setattr(uncertainty, "GEN_KWARGS", SMALL)
    curve = monte_carlo_curve(seed=0, budgets=[0, 3], n=8, rng_seed=2)
    single = monte_carlo(seed=0, budget=3, n=8, rng_seed=2)
    assert np.allclose(curve[3], single.lives_fixed)


def test_rescale_respects_away_time_share():
    inst = generate_instance(seed=0, **SMALL)
    base = Params()
    p = dataclasses.replace(base, away_time_share=base.away_time_share * 2)
    assert np.allclose(uncertainty._rescale_demand(inst, base, p).cell_rate, inst.cell_rate / 2)


def test_oat_skips_detour_when_walking_paths_are_used(monkeypatch):
    real = uncertainty._base

    def with_walk(seed, base):
        inst, p = real(seed, base)
        d = np.linalg.norm(inst.cell_xy[:, None] - inst.site_xy[None], axis=2) * 1.3
        return dataclasses.replace(inst, walk_dist_m=d), p

    monkeypatch.setattr(uncertainty, "GEN_KWARGS", SMALL)
    monkeypatch.setattr(uncertainty, "_base", with_walk)
    assert "detour_factor" not in {r.param for r in oat_sensitivity(seed=0, budget=3)}
