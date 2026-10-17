"""Loaders for the York Keele building and AED tables (built by scripts/york/build_tables.py)."""
import csv
import json
from pathlib import Path

import numpy as np

from aed.geo import latlon_to_xy

# South-west corner of the campus boundary box; all York metre coordinates are relative to it.
YORK_ORIGIN = (43.76718, -79.51681)
KINDS = ("academic", "library", "services", "residence", "athletic", "ignore")

YORK_DIR = Path(__file__).resolve().parents[2] / "data" / "york"


def _read(name: str) -> list[dict]:
    with open(YORK_DIR / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_buildings() -> list[dict]:
    out = []
    for r in _read("buildings.csv"):
        out.append({
            "osm_id": int(r["osm_id"]), "name": r["name"], "kind": r["kind"],
            "levels": float(r["levels"]), "levels_source": r["levels_source"],
            "classroom_code": r["classroom_code"], "seats": int(r["seats"]),
            "beds": int(r["beds"]), "beds_source": r["beds_source"],
            "area_m2": float(r["area_m2"]), "cx": float(r["cx"]), "cy": float(r["cy"]),
        })
    return out


def load_aeds() -> list[dict]:
    return [{
        "name": r["name"], "lat": float(r["lat"]), "lon": float(r["lon"]),
        "x": float(r["x"]), "y": float(r["y"]), "osm_id": int(r["osm_id"]),
        "building_name": r["building_name"],
    } for r in _read("aeds_matched.csv")]


def _to_xy(geometry: list[dict]) -> np.ndarray:
    return latlon_to_xy([p["lat"] for p in geometry], [p["lon"] for p in geometry], YORK_ORIGIN)


def _raw(name: str) -> list[dict]:
    with open(YORK_DIR / "raw" / name, encoding="utf-8") as f:
        return json.load(f)["elements"]


def footprint_of(element: dict) -> np.ndarray:
    """Footprint in metres. Ways use their geometry; relations (no member geometry in the
    snapshot) fall back to their bounding rectangle."""
    if element.get("geometry"):
        return _to_xy(element["geometry"])
    b = element["bounds"]
    return _to_xy([{"lat": b["minlat"], "lon": b["minlon"]}, {"lat": b["minlat"], "lon": b["maxlon"]},
                   {"lat": b["maxlat"], "lon": b["maxlon"]}, {"lat": b["maxlat"], "lon": b["minlon"]}])


def load_footprints() -> dict[int, np.ndarray]:
    return {int(e["id"]): footprint_of(e) for e in _raw("buildings.json")}


def load_boundary() -> np.ndarray:
    return _to_xy(_raw("boundary.json")[0]["geometry"])
