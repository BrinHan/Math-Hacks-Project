"""Build data/york/buildings.csv and data/york/aeds_matched.csv from the raw OSM snapshot.

Run from the repo root:  python scripts/york/build_tables.py
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from matplotlib.path import Path as MplPath

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from aed.data.york_tables import (KINDS, YORK_DIR, YORK_ORIGIN, _raw, _read,  # noqa: E402
                                  footprint_of)
from aed.geo import latlon_to_xy  # noqa: E402

MIN_AREA_M2 = 150.0
M2_PER_BED = 35.0  # ASSUMPTION: gross floor area per bed, for residences without handbook beds
RELATION_FILL = 0.6  # ASSUMPTION: relations have no member geometry; bbox area x this = footprint area
DEFAULT_LEVELS = {"academic": 3, "library": 3, "services": 3, "residence": 4, "athletic": 1}

# OSM `building` values that are never occupied floor space.
IGNORE_BUILDING_TAGS = {"terrace", "roof", "parking", "garage", "train_station", "grandstand",
                        "industrial", "shed", "greenhouse_horticulture"}
SERVICES_KEYWORDS = ("Student Centre", "York Lanes", "Bennett", "Physical Resources", "Central Utilities",
                     "Kinsmen", "Computer Methods", "West Office", "Lorna R. Marsden", "Hoover House",
                     "Gamig", "Stong Barn", "Stong House")
ATHLETIC_KEYWORDS = ("Tait McKenzie", "Canlan", "Track & Field", "Stadium", "Tennis")

# Hand decisions keyed by osm_id: {field: value, "why": reason}. Fields: kind, name, levels.
OVERRIDES = {
    841784443: dict(kind="athletic", name="York Lions Stadium",
                    why="Unnamed grandstand 70-85 m from the published York Lion's Stadium AED; larger of the two "
                        "grandstands there, so used as the stadium footprint (other grandstand stays ignore)"),
    129013573: dict(kind="athletic", name="Field house (unnamed)",
                    why="Unnamed 643 m2 two-storey building next to the western grandstand; assumed sports facility"),
    99375036: dict(kind="athletic", name="Tennis courts (unnamed)",
                   why="Unnamed sports_centre tennis, 4 courts, 2878 m2"),
    660832602: dict(kind="athletic", name="National Tennis Centre",
                    why="Unnamed way carrying the National Tennis Centre wikipedia tag"),
    96020547: dict(kind="ignore", name="Stong Residence (duplicate)",
                   why="Overlaps the 14-level Stong Residence dormitory (1087477874) ~7 m away; duplicate footprint "
                       "of the same tower, dormitory way gets the 278 handbook beds"),
    560851644: dict(kind="academic", name="Founders College",
                    why="Only Founders footprint in OSM; carries both FC classroom seats and the 263 Founders "
                        "Residence handbook beds (residence is inside the college complex); kind kept academic"),
    29004314: dict(kind="ignore", name="Central Utilities",
                   why="Power plant with a handful of operators; not a place the public gathers"),
    29004236: dict(kind="academic", name="Physical Resources",
                   why="Maintenance offices and workshops: office density and hours, not public services"),
    29003461: dict(kind="academic", name="Stephen E. Quinlan Building",
                   why="Tagged building=college; classrooms and offices, so academic"),
    856162986: dict(kind="academic", name="Unnamed university building near Founders College",
                    why="Unnamed building=university, kept as academic per default rule"),
    660213894: dict(kind="academic", name="Unnamed university building (west)",
                    why="Unnamed building=university, kept as academic per default rule"),
}

# AED name -> osm_id where point-in-polygon / nearest centroid picks the wrong building.
AED_OVERRIDES = {
    "Centre for Film and Theatre": (29003113, "Published point is ~80 m west of the CFT footprint and nearest "
                                              "centroid would pick Accolade West; the AED is named for CFT"),
    "York Lion's Stadium": (841784443, "Published point is ~90 m from the stadium grandstand; nearest centroid "
                                       "would pick West Office Building; the AED is named for the stadium"),
}

# York classroom code -> OSM building id (every code in classrooms.csv maps to exactly one building).
CODE_TO_OSM = {
    "CLH": 29003786,    # Curtis Lecture Halls
    "ACW": 157967629,   # Accolade West
    "ACE": 157967627,   # Accolade East
    "VH": 11524916,     # Vari Hall (relation, bbox footprint)
    "R": 839466831,     # Ross Building (includes Nat Taylor Cinema rooms)
    "DB": 29003554,     # Victor Phillip Dahdaleh Building
    "HNE": 29004532,    # Health, Nursing and Environmental Studies
    "LAS": 29003909,    # Lassonde Building
    "SLH": 239783177,   # Stedman Lecture Halls
    "VC": 560851645,    # Vanier College
    "SC": 182214986,    # Stong College
    "LSB": 96005349,    # Life Sciences Building (distinct from Farquharson Life Sciences, FRQ)
    "FC": 560851644,    # Founders College
    "MC": 560851647,    # McLaughlin College
    "CB": 29004010,     # Chemistry Building
    "SCS": 1086117216,  # School of Continuing Studies
    "CC": 1444061802,   # Calumet College
    "BC": 182211062,    # Norman Bethune College
    "CFA": 29003162,    # Goldfarb Centre for Fine Arts
    "BSB": 29003236,    # Behavioural Sciences
    "WC": 8975902,      # Winters College (relation, bbox footprint)
    "PSE": 29003993,    # Petrie Science & Engineering
}
# residences.csv name -> OSM building id.
RES_TO_OSM = {
    "Founders Residence": 560851644,   # Founders College (no separate residence footprint in OSM)
    "Tatham Hall": 448830311,          # Tatham Hall Residence
    "Vanier Residence": 32518699,
    "Winters Residence": 96021083,
    "Atkinson Residence": 29003611,
    "Pond Road Residence": 839196649,  # The Pond Road Residence
    "Bethune Residence": 96004207,     # Norman Bethune Residence
    "Calumet Residence": 29004077,
    "Stong Residence": 1087477874,     # the 14-level dormitory way
}


def poly_area_centroid(p: np.ndarray) -> tuple[float, float, float]:
    """Shoelace area and polygon centroid of an (N, 2) ring (closed or open)."""
    x, y = p[:, 0], p[:, 1]
    x1, y1 = np.roll(x, -1), np.roll(y, -1)
    cross = x * y1 - x1 * y
    a2 = cross.sum()
    if abs(a2) < 1e-9:
        return 0.0, float(x.mean()), float(y.mean())
    cx = ((x + x1) * cross).sum() / (3 * a2)
    cy = ((y + y1) * cross).sum() / (3 * a2)
    return abs(a2) / 2, float(cx), float(cy)


def classify(tags: dict, name: str, area: float) -> str:
    b = tags.get("building", "")
    if b in IGNORE_BUILDING_TAGS or area < MIN_AREA_M2:
        return "ignore"
    if tags.get("amenity") == "library":
        return "library"
    if any(k in name for k in SERVICES_KEYWORDS):
        return "services"
    if any(k in name for k in ATHLETIC_KEYWORDS) or tags.get("leisure") in ("ice_rink", "sports_centre"):
        return "athletic"
    if b in ("dormitory", "apartments") or "Residence" in name:
        return "residence"
    if b in ("stadium",):
        return "athletic"
    if b in ("university", "college") or name:
        return "academic"
    return "ignore"  # unnamed generic building=yes (outbuildings, utilities, kiosks)


def build_buildings() -> list[dict]:
    seats = defaultdict(int)
    for r in _read("classrooms.csv"):
        seats[r["code"]] += int(r["capacity"])
    assert set(CODE_TO_OSM) == set(seats), set(seats) ^ set(CODE_TO_OSM)
    assert len(set(CODE_TO_OSM.values())) == len(CODE_TO_OSM), "two codes share a building"
    beds_hb = {r["residence"]: int(r["beds"]) for r in _read("residences.csv")}
    assert set(RES_TO_OSM) == set(beds_hb)
    code_of = {v: k for k, v in CODE_TO_OSM.items()}
    hb_of = {v: beds_hb[k] for k, v in RES_TO_OSM.items()}

    rows, seen = [], set()
    for e in _raw("buildings.json"):
        oid = int(e["id"])
        assert oid not in seen
        seen.add(oid)
        tags = e.get("tags", {})
        fp = footprint_of(e)
        area, cx, cy = poly_area_centroid(fp)
        if not e.get("geometry"):  # relation: bbox rectangle
            area *= RELATION_FILL
            cx, cy = float(fp[:, 0].mean()), float(fp[:, 1].mean())
        ov = OVERRIDES.get(oid, {})
        name = ov.get("name") or tags.get("name") or ""
        kind = ov.get("kind") or classify(tags, name, area)
        if not name:
            name = f"unnamed {tags.get('building', 'building')} {oid}"
        assert kind in KINDS
        try:
            lev = float(str(tags.get("building:levels", "")).replace(",", "."))
        except ValueError:
            lev = 0.0
        if kind == "ignore":
            levels, lsrc = max(lev, 1.0), ("osm" if lev >= 1 else "default")
        elif lev >= 1:
            levels, lsrc = lev, "osm"
        else:
            levels, lsrc = float(DEFAULT_LEVELS[kind]), "default"
        if oid in hb_of:
            beds, bsrc = hb_of[oid], "handbook"
        elif kind == "residence":
            beds, bsrc = round(area * levels / M2_PER_BED), "estimate"
        else:
            beds, bsrc = 0, ""
        code = code_of.get(oid, "")
        rows.append(dict(osm_id=oid, name=name, kind=kind, levels=f"{levels:g}", levels_source=lsrc,
                         classroom_code=code, seats=seats[code] if code else 0, beds=beds,
                         beds_source=bsrc, area_m2=f"{area:.1f}", cx=f"{cx:.1f}", cy=f"{cy:.1f}"))
    for oid in list(code_of) + list(hb_of):
        row = next(r for r in rows if r["osm_id"] == oid)
        assert row["kind"] != "ignore", row
    return rows


def build_aeds(buildings: list[dict]) -> list[dict]:
    foot = {int(e["id"]): footprint_of(e) for e in _raw("buildings.json")}
    live = [b for b in buildings if b["kind"] != "ignore"]
    cent = np.array([[float(b["cx"]), float(b["cy"])] for b in live])
    out = []
    for r in _read("aeds.csv"):
        lat, lon = float(r["lat"]), float(r["lon"])
        x, y = latlon_to_xy(lat, lon, YORK_ORIGIN)[0]
        forced = AED_OVERRIDES.get(r["name"])
        inside = [] if forced else [b for b in live if MplPath(foot[b["osm_id"]]).contains_point((x, y))]
        if forced:
            b = next(b for b in live if b["osm_id"] == forced[0])
        elif inside:  # smallest containing footprint if several overlap
            b = min(inside, key=lambda b: float(b["area_m2"]))
        else:
            b = live[int(np.argmin(np.hypot(cent[:, 0] - x, cent[:, 1] - y)))]
        out.append(dict(name=r["name"], lat=lat, lon=lon, x=f"{x:.1f}", y=f"{y:.1f}",
                        osm_id=b["osm_id"], building_name=b["name"], _inside=bool(inside)))
    return out


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    buildings = build_buildings()
    write_csv(YORK_DIR / "buildings.csv", buildings,
              ["osm_id", "name", "kind", "levels", "levels_source", "classroom_code", "seats", "beds",
               "beds_source", "area_m2", "cx", "cy"])
    aeds = build_aeds(buildings)
    write_csv(YORK_DIR / "aeds_matched.csv", aeds,
              ["name", "lat", "lon", "x", "y", "osm_id", "building_name"])
    kinds = defaultdict(int)
    for b in buildings:
        kinds[b["kind"]] += 1
    print("buildings by kind:", dict(kinds))
    for a in aeds:
        print(f"AED {a['name'][:40]!r} -> {a['building_name']} ({'inside' if a['_inside'] else 'nearest'})")


if __name__ == "__main__":
    main()
