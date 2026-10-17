# York Keele Campus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Tasks 1 and 2 touch disjoint files and run in parallel in separate worktrees; Task 3 (controller) depends on both.

**Goal:** Build the York Keele `Instance` from the committed data snapshot and make it the default campus.
**Spec:** `docs/superpowers/specs/2026-10-17-york-campus-design.md`. **Branch:** `york-campus` (base commit has `data/york/` and `aed/geo.py`).

## Global Constraints

- Python 3.11, numpy, scipy only (no geopandas/osmnx/shapely/requests). `matplotlib.path.Path` is allowed for point-in-polygon.
- Coordinates: metres via `aed.geo.latlon_to_xy(lat, lon, origin_latlon)`. The York origin is `YORK_ORIGIN = (43.76718, -79.51681)` (south-west corner of the campus boundary box); define it once in `aed/data/york_tables.py` (Task 1) and import it elsewhere.
- Plain commit messages, no `Co-Authored-By` or any attribution trailer.
- All existing tests must keep passing unchanged: `python -m pytest -q`.

---

### Task 1: York building and AED tables (agent)

**Files:** create `scripts/york/build_tables.py`, `aed/data/york_tables.py`, `data/york/buildings.csv`, `data/york/aeds_matched.csv`, `tests/test_york_data.py`. Do not edit other files.

**Produces:**
- `aed/data/york_tables.py`: `YORK_ORIGIN`; `KINDS = ("academic", "library", "services", "residence", "athletic", "ignore")`; `load_buildings() -> list[dict]` reading `data/york/buildings.csv` (typed values); `load_aeds() -> list[dict]` reading `data/york/aeds_matched.csv`; `load_footprints() -> dict[int, np.ndarray]` mapping `osm_id` to its (N, 2) footprint in metres (from `raw/buildings.json`); `load_boundary() -> np.ndarray` (N, 2) metres.
- `data/york/buildings.csv` columns: `osm_id,name,kind,levels,levels_source,classroom_code,seats,beds,beds_source,area_m2,cx,cy` (cx, cy = footprint centroid in metres from `YORK_ORIGIN`). One row per OSM building. `kind="ignore"` for roofs, terraces, canopies, train stations, grandstands, garages, parking, sheds and footprints under 150 m². Classify named buildings by name (residences, colleges, Scott Library, Student Centre, York Lanes, Bennett Centre, Tait McKenzie, Canlan Ice Sports, Toronto Track & Field Centre, York Lions Stadium, etc.); unnamed `university` buildings → academic, unnamed `apartments`/`dormitory` → residence. `levels`: OSM value, else a documented default by kind (academic 3, library/services 3, residence 4, athletic 1) with `levels_source="default"`; residence towers known to be tall (Vanier, Bethune, Stong, Tatham ~14) already have OSM levels. `classroom_code` + `seats` = sum of `classrooms.csv` capacity for that York building code, assigned to the matching OSM building by name (e.g. CLH → Curtis Lecture Halls, ACW → Accolade West, VH → Vari Hall, R → Ross, DB → Dahdaleh, HNE → Health Nursing and Environmental Studies, LAS → Lassonde, SLH → Stedman Lecture Halls, VC → Vanier College, SC → Stong College, LSB → Life Sciences, FC → Founders College, MC → McLaughlin College, CB → Chemistry, SCS → (seek), CC → Calumet College, BC → Bethune College, CFA → Centre for Fine Arts, BSB → Behavioural Sciences, WC → Winters College, PSE → Petrie, ACE → Accolade East). Every code in `classrooms.csv` must map to exactly one building; if a building is genuinely missing from OSM, map the code to the nearest named building and say so in a `notes` comment in the script. `beds`: `residences.csv` values matched by name (`beds_source="handbook"`); other residence-kind buildings `round(area_m2 × levels / 35)` (`beds_source="estimate"`). A manual `OVERRIDES` dict in the script holds every hand decision with a one-line reason.
- `data/york/aeds_matched.csv` columns: `name,lat,lon,x,y,osm_id,building_name` (osm_id of the footprint containing the point, else the nearest non-ignore building centroid).

**Tests (`tests/test_york_data.py`), write first:**
- buildings.csv loads; kinds ⊆ `KINDS`; at least 60 non-ignore buildings; every non-ignore building has `levels >= 1`.
- seats over buildings == 16008 and every `classrooms.csv` code appears in exactly one building row.
- handbook beds over buildings == 2347; every `residences.csv` name matched once.
- 19 AEDs, every one with an `osm_id` of a non-ignore building, all inside the campus boundary bounding box expanded by 200 m.
- `load_footprints()` has an entry for every buildings.csv row; centroids `cx, cy` lie inside `[-500, 3000] × [-500, 2500]`.

Commit: `data: classify York buildings and match AEDs`.

---

### Task 2: Walking network distances (agent)

**Files:** create `aed/walknet.py`, `tests/test_walknet.py`; modify `aed/instance.py` (one new trailing optional field) and `aed/travel.py`. Do not edit other files.

**Produces:**
- `Instance` gets a last field `walk_dist_m: np.ndarray | None = None`; `validate()` checks shape (I, J), finite and ≥ 0 when present.
- `travel_time_matrix`: when `inst.walk_dist_m is not None`, distance = `walk_dist_m` (no detour factor); otherwise unchanged.
- `aed/walknet.py`:
  - `@dataclass class WalkGraph: xy: np.ndarray` (N, 2 metres) `adj: scipy.sparse.csr_matrix` (N × N symmetric, edge length metres).
  - `load_walk_graph(highways_json: str | Path, origin_latlon) -> WalkGraph`: Overpass `out geom tags` JSON; walkable `highway` ∈ {footway, path, pedestrian, steps, service, residential, cycleway, living_street, track, unclassified, tertiary, secondary, primary}; drop ways with `access` ∈ {private, no} or `foot=no`; nodes keyed by OSM node id (`nodes` list) so shared nodes connect; edge length = metre distance between consecutive points; keep only the largest connected component.
  - `walk_distance_matrix(g: WalkGraph, src_xy: np.ndarray, dst_xy: np.ndarray) -> np.ndarray` (I × J metres): snap each point to its nearest graph node (`scipy.spatial.cKDTree`), distance = snap(src) + shortest path + snap(dst) via `scipy.sparse.csgraph.dijkstra` run from the unique destination nodes; result is `np.maximum(result, euclidean)`.

**Tests (`tests/test_walknet.py`), write first:**
- A hand-built 4-node square graph (write a tiny Overpass-style JSON to `tmp_path`): distance between opposite corners = 2 sides, not the diagonal; a point off-graph adds its snap distance.
- Ways tagged `access=private` are excluded; a disconnected fragment is dropped (largest component only).
- Distances ≥ Euclidean always.
- Real snapshot: `load_walk_graph("data/york/raw/highways.json", (43.76718, -79.51681))` has > 4000 nodes; walking distance between two points 500 m apart on campus is between 500 m and 1000 m.
- `travel_time_matrix` uses `walk_dist_m` when set (set it on a small synthetic instance to a constant matrix and check the formula).
- `Instance.validate()` rejects a wrong-shaped `walk_dist_m`.

Commit: `feat: walking-network distances and optional Instance.walk_dist_m`.

---

### Task 3: York loader, wiring, results (controller)

- `aed/data/york.py`: `load_york(params=None, cell_m=50.0) -> Instance` per the spec (periods, occupancy rules, cells, sites, opening, floor delay, walking distances). Constants with `ASSUMPTION:` comments; `docs/assumptions.md` York section.
- Tests `tests/test_york.py`: validates; 5 periods with hours summing to 24; 19 existing sites; total arrests per year plausible (1-30); night demand concentrated in residences; weekday-morning demand highest in classroom buildings; walking distance ≥ Euclidean; ILP runs at K = 5.
- `pipeline.build(..., campus=...)`; `experiments/k_curve.py`, `uncertainty.py`, `run_all.py` gain `--campus` (default `york`); `aed/uncertainty.py` gains `CAMPUS` / builds via `pipeline`; new `experiments/york_validation.py` (re-siting and coverage gaps → `results/york_validation.json`).
- Run all experiments; independent review agent; fix; results log; push.
