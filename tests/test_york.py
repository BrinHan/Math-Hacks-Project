import numpy as np
import pytest

from aed.data.york import PERIODS, load_york
from aed.params import Params
from aed.pipeline import build
from aed.solvers.ilp import solve_ilp


@pytest.fixture(scope="module")
def york():
    return load_york()


def test_york_validates(york):
    york.validate()
    assert york.periods == PERIODS and york.period_hours.sum() == pytest.approx(24.0)


def test_york_has_published_aeds(york):
    assert york.site_existing.sum() == 19
    assert york.n_sites > 100 and york.n_cells > 300


def test_york_demand_plausible(york):
    assert 1.0 < york.cell_rate.sum() < 30.0


def test_night_demand_is_residential(york):
    # At night the busiest cells sit next to buildings with beds.
    from aed.data.york_tables import load_buildings
    beds = np.array([[b["cx"], b["cy"]] for b in load_buildings() if (b["beds"] or 0) > 0])
    night = york.cell_rate[:, PERIODS.index("night")]
    top = york.cell_xy[np.argsort(night)[-20:]]
    assert np.median(np.linalg.norm(top[:, None] - beds[None], axis=2).min(1)) < 60.0


def test_every_building_has_a_candidate_site(york):
    from aed.data.york_tables import load_buildings
    sites = york.site_xy[np.array(york.site_kind) != "outdoor"]
    for b in load_buildings():
        if b["kind"] == "ignore":
            continue
        d = np.linalg.norm(sites - [b["cx"], b["cy"]], axis=1).min()
        assert d < np.sqrt(b["area_m2"]) + 60.0, b["name"]


def test_weekday_peak_is_daytime(york):
    hourly = york.cell_rate.sum(0) / york.period_hours
    assert hourly.argmax() in (PERIODS.index("weekday_morning"), PERIODS.index("weekday_afternoon"))


def test_walking_at_least_straight_line(york):
    d = np.linalg.norm(york.cell_xy[:, None] - york.site_xy[None], axis=2)
    assert np.all(york.walk_dist_m >= d - 1e-6)


def test_rates_follow_params(york):
    doubled = load_york(Params(incidence_per_100k_yr=110.0))
    assert np.allclose(doubled.cell_rate, 2 * york.cell_rate)


def test_build_york_and_solve():
    inst, cov = build(campus="york")
    sol = solve_ilp(cov, 5)
    assert sol.x[inst.site_existing].all() and sol.lives > 0
