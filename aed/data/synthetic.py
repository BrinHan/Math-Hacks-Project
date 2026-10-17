"""Synthetic campus generator."""
import numpy as np

from aed.instance import Instance
from aed.params import Params

PERIODS = ["day", "evening", "night"]
PERIOD_HOURS = np.array([10.0, 6.0, 8.0])        # 08-18, 18-24, 00-08
ORIGIN_LATLON = (43.4723, -80.5449)               # ASSUMPTION: arbitrary map anchor

# ASSUMPTION: illustrative people present (day, evening, night) in a building of size 1.0;
# chosen to mimic a lecture/work day, evening study and a residential night. Not measured data.
PEOPLE = {
    "academic": (800.0, 100.0, 0.0),
    "library": (400.0, 300.0, 50.0),
    "residential": (150.0, 500.0, 600.0),
    "athletic": (200.0, 300.0, 0.0),
    "dining": (300.0, 250.0, 0.0),
}
# ASSUMPTION: share of campus buildings of each kind (after one of each of the first five).
KIND_P = {"academic": 0.35, "residential": 0.30, "dining": 0.13, "library": 0.12, "athletic": 0.10}
# ASSUMPTION: people per hectare away from buildings (paths, quads, car parks), per period.
BACKGROUND_PER_HA = (12.8, 7.7, 2.6)
# ASSUMPTION: spatial spread (m) of each building's occupants around its centre; illustrative.
SIGMA_M = 60.0
# ASSUMPTION: AEDs inside one building sit within this radius (m) of its centre; illustrative.
SITE_JITTER_M = 30.0
# ASSUMPTION: share of sites that are outdoor cabinets; illustrative.
OUTDOOR_SHARE = 0.10
# ASSUMPTION: relative building size range (scales occupancy, site count and floor delay).
SIZE_RANGE = (0.5, 2.0)
# ASSUMPTION: in-building time (s) to reach the AED grows from 30 s (smallest) to 120 s (largest).
FLOOR_DELAY_RANGE_S = (30.0, 120.0)


def generate_instance(seed: int = 0, extent_m: float = 2000.0, grid_n: int = 32,
                      n_buildings: int = 30, n_sites: int = 300, n_existing: int = 5,
                      outdoor_cost: float = 1.5, params: Params | None = None) -> Instance:
    """Building-based synthetic campus.

    Buildings of five kinds (academic, residential, library, dining, athletic) get random
    sizes and centres (residential halls on a ring, athletic facilities anywhere, the rest
    clustered near the centre). Each building holds a period-dependent number of people
    (PEOPLE x size), spread over grid cells by a Gaussian kernel (SIGMA_M) normalised so the
    building's people are conserved, plus a per-hectare background. Cell arrest rate is people
    x incidence x public fraction x period share of the day. Indoor AED sites are placed near
    buildings (one per building when possible, the rest in proportion to size) and are open in
    a period iff the building has people then; outdoor sites are uniform and always open.
    All randomness comes from one default_rng(seed) in a fixed draw order.
    """
    if n_buildings < 1:
        raise ValueError("n_buildings must be >= 1")
    if n_sites < 1:
        raise ValueError("n_sites must be >= 1")
    params = params or Params()
    rng = np.random.default_rng(seed)

    # 1. kinds
    kind_names = list(KIND_P)
    first = ["academic", "residential", "library", "dining", "athletic"][:min(n_buildings, 5)]
    kinds = first + [str(k) for k in rng.choice(kind_names, size=n_buildings - 5,
                                                p=list(KIND_P.values()))] if n_buildings > 5 else first
    # 2. sizes
    size = rng.uniform(*SIZE_RANGE, size=n_buildings)
    # 3. centres
    c0 = extent_m / 2.0
    centres = np.empty((n_buildings, 2))
    for b, k in enumerate(kinds):
        if k == "residential":
            a = rng.uniform(0, 2 * np.pi)
            r = rng.uniform(0.30, 0.42) * extent_m
            centres[b] = c0 + r * np.array([np.cos(a), np.sin(a)])
        elif k == "athletic":
            centres[b] = rng.uniform(0.05 * extent_m, 0.95 * extent_m, size=2)
        else:
            centres[b] = rng.normal(c0, 0.15 * extent_m, size=2)
    centres = np.clip(centres, 0.03 * extent_m, 0.97 * extent_m)

    # 4. indoor allocation
    n_outdoor = max(1, round(OUTDOOR_SHARE * n_sites))
    n_indoor = n_sites - n_outdoor
    share = size / size.sum()
    if n_indoor >= n_buildings:
        per_building = 1 + rng.multinomial(n_indoor - n_buildings, share)
    else:
        per_building = rng.multinomial(n_indoor, share)

    # 5. indoor sites
    xy_list, kind_list, open_list, delay_list = [], [], [], []
    for b, k in enumerate(kinds):
        opens = np.array(PEOPLE[k]) > 0
        delay = FLOOR_DELAY_RANGE_S[0] + (FLOOR_DELAY_RANGE_S[1] - FLOOR_DELAY_RANGE_S[0]) \
            * (size[b] - SIZE_RANGE[0]) / (SIZE_RANGE[1] - SIZE_RANGE[0])
        for _ in range(int(per_building[b])):
            ang = rng.uniform(0, 2 * np.pi)
            rad = rng.uniform(0, SITE_JITTER_M)
            xy_list.append(np.clip(centres[b] + rad * np.array([np.cos(ang), np.sin(ang)]), 0.0, extent_m))
            kind_list.append(k)
            open_list.append(opens)
            delay_list.append(delay)
    # 6. outdoor sites
    outdoor_xy = rng.uniform(0, extent_m, size=(n_outdoor, 2))

    # 7. order: indoor first, then outdoor
    site_xy = np.vstack([np.array(xy_list).reshape(-1, 2), outdoor_xy])
    site_kind = kind_list + ["outdoor"] * n_outdoor
    site_open = np.vstack([np.array(open_list, dtype=bool).reshape(-1, 3),
                           np.ones((n_outdoor, 3), dtype=bool)])
    site_floor_delay = np.concatenate([np.array(delay_list), np.zeros(n_outdoor)])
    site_cost = np.concatenate([np.ones(len(kind_list)), np.full(n_outdoor, outdoor_cost)])

    # 8. existing AEDs
    site_existing = np.zeros(n_sites, dtype=bool)
    site_existing[rng.choice(n_indoor, size=min(n_existing, n_indoor), replace=False)] = True

    # demand
    step = extent_m / grid_n
    axis = (np.arange(grid_n) + 0.5) * step
    gx, gy = np.meshgrid(axis, axis)
    cell_xy = np.column_stack([gx.ravel(), gy.ravel()])
    d2 = ((cell_xy[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
    # Shift by each building's nearest-cell distance so the exp never underflows to all zeros.
    kernel = np.exp(-(d2 - d2.min(axis=0, keepdims=True)) / (2.0 * SIGMA_M ** 2))
    kernel /= kernel.sum(axis=0, keepdims=True)
    building_people = np.array([PEOPLE[k] for k in kinds]) * size[:, None]      # (B, P)
    cell_ha = step ** 2 / 10_000.0
    people = kernel @ building_people + np.array(BACKGROUND_PER_HA) * cell_ha
    cell_rate = (people * params.incidence_per_100k_yr / 1e5 * params.public_fraction
                 * PERIOD_HOURS / 24.0)

    return Instance(
        cell_xy=cell_xy, cell_rate=cell_rate, site_xy=site_xy, site_cost=site_cost,
        site_floor_delay=site_floor_delay, site_open=site_open, site_existing=site_existing,
        site_kind=site_kind, periods=list(PERIODS), period_hours=PERIOD_HOURS.copy(),
        origin_latlon=ORIGIN_LATLON,
    )
