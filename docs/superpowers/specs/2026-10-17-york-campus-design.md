# York University Keele Campus Model: Design Spec

Date: 2026-10-17. Approved in conversation. Branch `york-campus`.

## Goal

Make York University's Keele campus the headline study area. Real buildings, walking
paths, classroom seats, residence beds and York's 19 published AEDs replace the synthetic
campus for all headline results, figures, README and the app. The synthetic generator
stays for tests and as a generalisation check.

## Data (committed snapshot, `data/york/`, see `SOURCES.md`)

- OpenStreetMap: campus boundary, 144 building footprints, 1,372 walkable ways, 207 entrances.
- York UIT Learning Spaces: 249 Keele classrooms, 16,008 seats, by building code.
- York Housing handbook 2025-26: 9 residences, 2,347 beds.
- York Keele AED map: 19 existing AEDs (name, lat, lon).
- Timetable: not public (Passport York login); replaced by an assumed teaching pattern.

## Periods (5, weighted by hours per week, averaged per day so they sum to 24)

| Period | Hours | Hours per week | `period_hours` |
| --- | --- | --- | --- |
| weekday morning | Mon-Fri 08-13 | 25 | 25/7 |
| weekday afternoon | Mon-Fri 13-18 | 25 | 25/7 |
| weekday evening | Mon-Fri 18-24 | 30 | 30/7 |
| night | every day 00-08 | 56 | 8 |
| weekend day | Sat-Sun 08-24 | 32 | 32/7 |

## Occupancy (people present, per building, per period)

Every constant is an `ASSUMPTION` with a range in `docs/assumptions.md`.

- **Classroom buildings:** seats × booking share × attendance, with booking share
  (0.70, 0.65, 0.25, 0, 0.05) by period and attendance 0.60 (range 0.50-0.75). Plus staff
  and other users: floor area × 1 person per 40 m² × presence (0.8, 0.8, 0.2, 0, 0.05).
- **Library and services** (Scott Library, Student Centre, York Lanes, Bennett Centre):
  floor area × 1 person per 25 m² × presence (0.6, 0.7, 0.4, 0, 0.2).
- **Other academic buildings** (offices, labs, no booked classrooms): floor area × 1 per
  40 m² × presence (0.8, 0.8, 0.2, 0, 0.05).
- **Residences:** beds × share at home (0.30, 0.30, 0.60, 0.90, 0.60). Beds from the
  handbook; York Apartments without published counts use floor area / 35 m² (estimate).
- **Athletic:** floor area × 1 per 100 m² × presence (0.3, 0.4, 0.8, 0, 0.7).
- **Outdoor foot traffic:** 3,000 people walking during weekday morning and afternoon
  (spread over path cells), 800 in the evening and at weekends, 100 at night.
- Building people are spread over grid cells by a Gaussian kernel (sigma = half the square
  root of the footprint area, at least 20 m) around the footprint centroid, normalised.
- Rates: unchanged formula, people × incidence × (public_fraction / away_time_share)
  × period_hours / 24, residents included as already documented.

## Grid, sites, travel

- Cells: 50 m grid over the campus boundary's bounding box, kept if inside the boundary
  polygon or within 50 m of a kept building. Origin = south-west corner of that box.
- Candidate sites: OSM entrances snapped to the nearest kept building within 40 m (kind
  from the building), plus 20 outdoor cabinets at the busiest path junctions, plus the 19
  existing AEDs (fixed, `site_existing = True`).
- Opening by kind and period (morning, afternoon, evening, night, weekend):
  academic (1,1,1,0,0), library/services (1,1,1,0,1), residence (1,1,1,1,1, residents'
  card access assumed), athletic (1,1,1,0,1), outdoor (1,1,1,1,1).
- Floor delay: entrance sites 20 s; existing AEDs 45 s (inside, location named only).
  Cost: indoor 1.0, outdoor 1.5.
- Travel: shortest walking path on the OSM network (Dijkstra), replacing Euclidean ×
  detour for York. `detour_factor` therefore has no effect on York results (stated).

## Validation and outputs

- Re-siting: lives with York's 19 AEDs vs the best 19 sites (existing treated as not
  installed, budget 19 at unit cost).
- Adding: lives from K new AEDs on top of York's 19 (K = 0-30), all methods.
- Coverage gaps: which major buildings have no AED within 3 minutes.
- Monte Carlo and sensitivity unchanged in method, run on York.
- Experiments take `--campus york|synthetic`, default `york`. The app export switches to York.

## Interfaces

- `Instance` gains one optional trailing field `walk_dist_m: np.ndarray | None = None`
  (I × J metres). `travel_time_matrix` uses it instead of Euclidean × detour when present.
  Everything else in the frozen contract is unchanged.
- `aed.data.york.load_york(params: Params | None = None, cell_m: float = 50.0) -> Instance`.
- `aed.pipeline.build(seed=0, params=None, campus="synthetic", **gen_kwargs)`;
  `campus="york"` ignores `seed` and `gen_kwargs`.

## Limitations to state

Indoor tunnels and building interiors are not in the walking graph; the AED map may be
incomplete; floor counts are partly estimated; occupancy is assumed, not measured; the
timetable could not be used.
