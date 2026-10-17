"""York University Keele campus Instance from the committed data snapshot (data/york/).

Real buildings, entrances and walking paths (OpenStreetMap), classroom seats (York UIT),
residence beds (York Housing) and York's 19 published AEDs. Occupancy by period is an
assumed teaching pattern (the timetable needs a login); every constant is an ASSUMPTION.
"""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
from matplotlib.path import Path as Polygon

from aed.data.york_tables import YORK_ORIGIN, load_aeds, load_boundary, load_buildings, load_footprints
from aed.geo import latlon_to_xy
from aed.instance import Instance
from aed.params import Params
from aed.walknet import load_walk_graph, walk_distance_matrix

DATA = Path(__file__).resolve().parents[2] / "data" / "york"

PERIODS = ["weekday_morning", "weekday_afternoon", "weekday_evening", "night", "weekend"]
# Hours per week (Mon-Fri 8-13, 13-18, 18-24; every day 0-8; Sat-Sun 8-24) averaged per day.
PERIOD_HOURS = np.array([25.0, 25.0, 30.0, 56.0, 32.0]) / 7.0

# ASSUMPTION: share of booked classroom seats in use by period (no public timetable).
BOOKING = np.array([0.70, 0.65, 0.25, 0.0, 0.05])
# ASSUMPTION: share of enrolled students attending (literature 50-75%).
ATTENDANCE = 0.60
# ASSUMPTION: office/lab users, 1 person per 40 m2 of floor area, present by period.
STAFF_M2 = 40.0
STAFF_PRESENCE = np.array([0.8, 0.8, 0.2, 0.0, 0.05])
# ASSUMPTION: library, student centre, retail and services, 1 person per 25 m2.
SERVICES_M2 = 25.0
SERVICES_PRESENCE = np.array([0.6, 0.7, 0.4, 0.0, 0.2])
# ASSUMPTION: share of residents at home by period.
RESIDENT_PRESENCE = np.array([0.30, 0.30, 0.60, 0.90, 0.60])
# ASSUMPTION: athletic facilities, 1 person per 100 m2, busiest evenings and weekends.
ATHLETIC_M2 = 100.0
ATHLETIC_PRESENCE = np.array([0.3, 0.4, 0.8, 0.0, 0.7])
# ASSUMPTION: people walking outdoors on campus paths at any moment, by period.
OUTDOOR_PEOPLE = np.array([3000.0, 3000.0, 800.0, 100.0, 800.0])

# ASSUMPTION: which kinds of building are open (AED reachable) in each period.
OPEN = {
    "academic": (1, 1, 1, 0, 0),
    "library": (1, 1, 1, 0, 1),
    "services": (1, 1, 1, 0, 1),
    "residence": (1, 1, 1, 1, 1),   # residents' card access
    "athletic": (1, 1, 1, 0, 1),
    "outdoor": (1, 1, 1, 1, 1),
}
FLOOR_DELAY_ENTRANCE_S = 20.0   # ASSUMPTION: AED mounted at the entrance
FLOOR_DELAY_EXISTING_S = 45.0   # ASSUMPTION: York AEDs are inside, location named only
# ASSUMPTION: a bystander indoors must leave and re-enter the building to use an outdoor cabinet.
FLOOR_DELAY_OUTDOOR_S = 30.0
N_OUTDOOR = 20                  # outdoor cabinets at the busiest path junctions
OUTDOOR_SPACING_M = 150.0
OUTDOOR_COST = 1.5
ENTRANCE_SNAP_M = 40.0          # entrance must be this close to a kept building
ENTRANCE_DEDUPE_M = 15.0        # merge entrances of one building closer than this
CELL_KEEP_M = 50.0              # keep cells this close to a kept building outside the boundary
# ASSUMPTION: people cut through buildings and plazas that the mapped footpaths miss, so the
# walking distance is capped at 1.3 x the straight line up to 100 m, rising smoothly beyond
# (+0.7 m per extra metre) so there is no cliff at the radius.
SHORTCUT_M = 100.0
SHORTCUT_DETOUR = 1.3
SHORTCUT_RAMP = 0.7
# ASSUMPTION: York Housing operates these apartment buildings; their beds are estimated from
# floor area. Other unlisted housing (e.g. the privately run Quad) is excluded in the base case.
YORK_APARTMENTS = ("Assiniboine", "Passy")
BED_MODES = ("york", "handbook", "all", "none")


def _seg_dist(p: np.ndarray, poly: np.ndarray) -> float:
    """Distance from point p to the boundary of polygon poly (N, 2)."""
    a, b = poly, np.roll(poly, -1, axis=0)
    ab = b - a
    t = np.clip(((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0.0, 1.0)
    return float(np.linalg.norm(a + t[:, None] * ab - p, axis=1).min())


def _beds(b: dict, mode: str) -> float:
    """Beds counted for building b under a bed scenario (see BED_MODES)."""
    if mode not in BED_MODES:
        raise ValueError(f"beds must be one of {BED_MODES}, got {mode!r}")
    beds = b.get("beds") or 0
    if mode == "none" or not beds:
        return 0
    if b["beds_source"] == "handbook" or mode == "all":
        return beds
    if mode == "york" and any(k in (b["name"] or "") for k in YORK_APARTMENTS):
        return beds
    return 0


def _label(b: dict) -> str:
    return b["name"] or f"osm {b['osm_id']}"


def resident_beds(mode: str = "york") -> dict[str, float]:
    """Beds per building under a bed scenario."""
    return {_label(b): _beds(b, mode) for b in load_buildings()
            if b["kind"] != "ignore" and _beds(b, mode) > 0}


def _building_people(b: dict, beds: float) -> np.ndarray:
    """People present by period: classroom seats, floor-area users and residents add up
    (one footprint can hold all three, e.g. Founders College has classrooms and beds)."""
    floor = b["area_m2"] * b["levels"]
    kind = b["kind"]
    people = (b.get("seats") or 0) * BOOKING * ATTENDANCE
    if kind == "academic":
        people = people + floor / STAFF_M2 * STAFF_PRESENCE
    elif kind in ("library", "services"):
        people = people + floor / SERVICES_M2 * SERVICES_PRESENCE
    elif kind == "athletic":
        people = people + floor / ATHLETIC_M2 * ATHLETIC_PRESENCE
    return people + beds * RESIDENT_PRESENCE


@lru_cache(maxsize=12)
def _geometry(cell_m: float, beds: str = "york", outdoor_cabinets: bool = True,
              shortcut_m: float | None = SHORTCUT_M):
    """Everything that does not depend on Params: cells, people, sites, walking distances."""
    buildings = [b for b in load_buildings() if b["kind"] != "ignore"]
    feet = load_footprints()
    boundary = load_boundary()
    graph = load_walk_graph(DATA / "raw" / "highways.json", YORK_ORIGIN)

    # cells: grid over the boundary box, inside the boundary or near a kept building
    lo, hi = boundary.min(0), boundary.max(0)
    xs = np.arange(lo[0] + cell_m / 2, hi[0], cell_m)
    ys = np.arange(lo[1] + cell_m / 2, hi[1], cell_m)
    gx, gy = np.meshgrid(xs, ys)
    grid = np.column_stack([gx.ravel(), gy.ravel()])
    centres = np.array([[b["cx"], b["cy"]] for b in buildings])
    near = np.linalg.norm(grid[:, None] - centres[None], axis=2).min(1) <= CELL_KEEP_M
    cell_xy = grid[Polygon(boundary).contains_points(grid) | near]

    # people: buildings spread by a footprint-sized kernel, walkers by path length per cell
    people = np.zeros((len(cell_xy), len(PERIODS)))
    for b, c in zip(buildings, centres):
        sigma = max(20.0, np.sqrt(b["area_m2"]) / 2.0)
        d2 = ((cell_xy - c) ** 2).sum(1)
        k = np.exp(-(d2 - d2.min()) / (2.0 * sigma ** 2))
        people += np.outer(k / k.sum(), _building_people(b, _beds(b, beds)))
    edges = graph.adj.tocoo()
    one_way = edges.row < edges.col
    mid = (graph.xy[edges.row[one_way]] + graph.xy[edges.col[one_way]]) / 2.0
    edge_cell = np.argmin(((mid[:, None] - cell_xy[None]) ** 2).sum(2), axis=1)
    path_share = np.bincount(edge_cell, weights=edges.data[one_way], minlength=len(cell_xy))
    people += np.outer(path_share / path_share.sum(), OUTDOOR_PEOPLE)

    # candidate sites: entrances snapped to buildings, deduplicated per building
    raw = json.loads((DATA / "raw" / "entrances.json").read_text(encoding="utf-8"))["elements"]
    ent = latlon_to_xy([e["lat"] for e in raw], [e["lon"] for e in raw], YORK_ORIGIN)
    sites, kinds, delays, costs, existing = [], [], [], [], []
    for p in ent:
        dists = [_seg_dist(p, feet[b["osm_id"]]) for b in buildings]
        i = int(np.argmin(dists))
        inside = Polygon(feet[buildings[i]["osm_id"]]).contains_point(p)
        if dists[i] > ENTRANCE_SNAP_M and not inside:
            continue
        same = [s for s, k in zip(sites, kinds) if k[1] == i]
        if any(np.linalg.norm(p - s) < ENTRANCE_DEDUPE_M for s in same):
            continue
        sites.append(p)
        kinds.append((buildings[i]["kind"], i))
        delays.append(FLOOR_DELAY_ENTRANCE_S)
        costs.append(1.0)
        existing.append(False)

    # every building without a mapped entrance gets one site: its footprint vertex closest
    # to the walking network (a stand-in for the door)
    has_site = {i for _, i in kinds}
    for i, b in enumerate(buildings):
        if i in has_site:
            continue
        poly = feet[b["osm_id"]]
        gap = np.linalg.norm(poly[:, None] - graph.xy[None], axis=2).min(1)
        sites.append(poly[int(np.argmin(gap))])
        kinds.append((b["kind"], i))
        delays.append(FLOOR_DELAY_ENTRANCE_S)
        costs.append(1.0)
        existing.append(False)

    # outdoor cabinets: busiest path junctions (weekday people within 150 m), spaced apart
    degree = np.diff(graph.adj.indptr)
    junctions = graph.xy[degree >= 3]
    weekday = people[:, :2].sum(1)
    score = np.array([weekday[np.linalg.norm(cell_xy - j, axis=1) <= OUTDOOR_SPACING_M].sum()
                      for j in junctions])
    chosen: list[np.ndarray] = []
    for j in np.argsort(-score, kind="stable"):
        if len(chosen) == N_OUTDOOR:
            break
        if all(np.linalg.norm(junctions[j] - c) >= OUTDOOR_SPACING_M for c in chosen):
            chosen.append(junctions[j])
    for p in (chosen if outdoor_cabinets else []):
        sites.append(p)
        kinds.append(("outdoor", -1))
        delays.append(FLOOR_DELAY_OUTDOOR_S)
        costs.append(OUTDOOR_COST)
        existing.append(False)

    # York's published AEDs, already installed (matched to their building by OSM id)
    index = {b["osm_id"]: i for i, b in enumerate(buildings)}
    for a in load_aeds():
        i = index.get(a["osm_id"], -2)
        sites.append(np.array([a["x"], a["y"]]))
        kinds.append((buildings[i]["kind"] if i >= 0 else "services", i))
        delays.append(FLOOR_DELAY_EXISTING_S)
        costs.append(1.0)
        existing.append(True)

    site_xy = np.array(sites)
    site_kind = [k for k, _ in kinds]
    # a building with residents is reachable whenever they are home (card access)
    has_beds = [i >= 0 and _beds(buildings[i], beds) > 0 for _, i in kinds]
    site_open = np.array([np.maximum(OPEN[k], OPEN["residence"]) if r else OPEN[k]
                          for k, r in zip(site_kind, has_beds)], dtype=bool)
    names = [_label(buildings[i]) if i >= 0 else "outdoor cabinet" for _, i in kinds]

    walk = walk_distance_matrix(graph, cell_xy, site_xy)
    straight = np.linalg.norm(cell_xy[:, None] - site_xy[None], axis=2)
    if shortcut_m is not None:
        cap = SHORTCUT_DETOUR * straight + SHORTCUT_RAMP * np.maximum(0.0, straight - shortcut_m)
        walk = np.minimum(walk, cap)
    return (cell_xy, people, site_xy, np.array(costs), np.array(delays), site_open,
            np.array(existing), site_kind, walk, names)


def site_buildings(cell_m: float = 50.0, beds: str = "york", outdoor_cabinets: bool = True,
                   shortcut_m: float | None = SHORTCUT_M) -> list[str]:
    """Building name for every site of load_york(...) with the same arguments."""
    return list(_geometry(float(cell_m), beds, bool(outdoor_cabinets), shortcut_m)[-1])


def load_york(params: Params | None = None, cell_m: float = 50.0, beds: str = "york",
              outdoor_cabinets: bool = True, shortcut_m: float | None = SHORTCUT_M) -> Instance:
    """The Keele campus as an Instance; walking distances replace Euclidean x detour.

    beds: "york" (handbook + York-run apartments, base case), "handbook", "all" (adds
    privately run and unknown housing), "none". outdoor_cabinets=False drops the 20 cabinets.
    shortcut_m: radius of the walking shortcut (None = mapped footpaths only).
    """
    params = params or Params()
    (cell_xy, people, site_xy, cost, delay, site_open, existing, kind, walk,
     _) = _geometry(float(cell_m), beds, bool(outdoor_cabinets), shortcut_m)
    hazard = params.public_fraction / params.away_time_share
    rate = people * params.incidence_per_100k_yr / 1e5 * hazard * PERIOD_HOURS / 24.0
    return Instance(
        cell_xy=cell_xy.copy(), cell_rate=rate, site_xy=site_xy.copy(), site_cost=cost.copy(),
        site_floor_delay=delay.copy(), site_open=site_open.copy(), site_existing=existing.copy(),
        site_kind=list(kind), periods=list(PERIODS), period_hours=PERIOD_HOURS.copy(),
        origin_latlon=YORK_ORIGIN, walk_dist_m=walk.copy(),
    )
