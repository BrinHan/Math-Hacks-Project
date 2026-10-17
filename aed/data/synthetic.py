"""Synthetic campus generator."""
import numpy as np

from aed.instance import Instance
from aed.params import Params

PERIODS = ["day", "evening", "night"]
PERIOD_HOURS = np.array([10.0, 6.0, 8.0])        # 08-18, 18-24, 00-08
ORIGIN_LATLON = (43.4723, -80.5449)               # ASSUMPTION: arbitrary map anchor
INDOOR_KINDS = ["academic", "library", "residential", "athletic", "dining"]
OPEN_EVENING = {"library", "residential", "athletic", "dining", "outdoor"}
OPEN_NIGHT = {"library", "residential", "outdoor"}


def generate_instance(seed: int = 0, extent_m: float = 2000.0, grid_n: int = 32,
                      n_buildings: int = 30, n_sites: int = 300, n_existing: int = 5,
                      outdoor_cost: float = 1.5, params: Params | None = None) -> Instance:
    """STUB: Teammate 2 replaces this body; keep the signature and tests/test_contract.py passing.

    Uniform random campus with no buildings (n_buildings is ignored).
    """
    params = params or Params()
    rng = np.random.default_rng(seed)

    step = extent_m / grid_n
    centres = (np.arange(grid_n) + 0.5) * step
    gx, gy = np.meshgrid(centres, centres)
    cell_xy = np.column_stack([gx.ravel(), gy.ravel()])

    people = rng.gamma(2.0, 50.0, size=len(cell_xy))[:, None] * np.array([1.0, 0.6, 0.3])
    cell_rate = (people * params.incidence_per_100k_yr / 1e5 * params.public_fraction
                 * PERIOD_HOURS / 24.0)

    n_outdoor = max(1, round(0.1 * n_sites))
    n_indoor = n_sites - n_outdoor
    site_xy = rng.uniform(0.0, extent_m, size=(n_sites, 2))
    site_kind = list(rng.choice(INDOOR_KINDS, size=n_indoor)) + ["outdoor"] * n_outdoor
    site_kind = [str(k) for k in site_kind]
    outdoor = np.array([k == "outdoor" for k in site_kind])

    site_cost = np.where(outdoor, outdoor_cost, 1.0)
    site_floor_delay = np.where(outdoor, 0.0, rng.uniform(30.0, 120.0, size=n_sites))
    site_open = np.column_stack([
        np.ones(n_sites, dtype=bool),
        np.array([k in OPEN_EVENING for k in site_kind]),
        np.array([k in OPEN_NIGHT for k in site_kind]),
    ])

    site_existing = np.zeros(n_sites, dtype=bool)
    site_existing[rng.choice(n_indoor, size=min(n_existing, n_indoor), replace=False)] = True

    return Instance(
        cell_xy=cell_xy, cell_rate=cell_rate, site_xy=site_xy, site_cost=site_cost,
        site_floor_delay=site_floor_delay, site_open=site_open, site_existing=site_existing,
        site_kind=site_kind, periods=list(PERIODS), period_hours=PERIOD_HOURS.copy(),
        origin_latlon=ORIGIN_LATLON,
    )
