import csv
from collections import Counter
from pathlib import Path

import numpy as np

from aed.data.york_tables import (KINDS, YORK_ORIGIN, load_aeds, load_boundary,
                                  load_buildings, load_footprints)

DATA = Path(__file__).resolve().parent.parent / "data" / "york"


def _rows(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def test_buildings_load_and_kinds():
    b = load_buildings()
    assert {r["kind"] for r in b} <= set(KINDS)
    real = [r for r in b if r["kind"] != "ignore"]
    assert len(real) >= 60
    assert all(r["levels"] >= 1 for r in real)


def test_seats_match_classrooms():
    b = load_buildings()
    assert sum(r["seats"] for r in b) == 16008
    codes = Counter(r["classroom_code"] for r in b if r["classroom_code"])
    expected = {r["code"] for r in _rows("classrooms.csv")}
    assert set(codes) == expected
    assert all(n == 1 for n in codes.values())


def test_beds_match_handbook():
    b = load_buildings()
    handbook = [r for r in b if r["beds_source"] == "handbook"]
    assert sum(r["beds"] for r in handbook) == 2347
    assert len(handbook) == len(_rows("residences.csv"))


def test_aeds_matched_to_buildings():
    b = {r["osm_id"]: r for r in load_buildings()}
    aeds = load_aeds()
    assert len(aeds) == 19
    for a in aeds:
        assert a["osm_id"] in b and b[a["osm_id"]]["kind"] != "ignore"
    lo, hi = load_boundary().min(axis=0) - 200, load_boundary().max(axis=0) + 200
    xy = np.array([[a["x"], a["y"]] for a in aeds])
    assert (xy >= lo).all() and (xy <= hi).all()


def test_footprints_and_centroids():
    b = load_buildings()
    fp = load_footprints()
    assert all(r["osm_id"] in fp for r in b)
    assert all(f.ndim == 2 and f.shape[1] == 2 for f in fp.values())
    for r in b:
        assert -500 <= r["cx"] <= 3000 and -500 <= r["cy"] <= 2500


def test_origin():
    assert YORK_ORIGIN == (43.76718, -79.51681)
