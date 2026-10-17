import dataclasses
import json

import numpy as np
import pytest

from aed.data.synthetic import generate_instance
from aed.geo import latlon_to_xy
from aed.params import Params
from aed.travel import travel_time_matrix
from aed.walknet import load_walk_graph, walk_distance_matrix

ORIGIN = (43.0, -79.0)
M_LAT = 111_320.0
M_LON = 111_320.0 * np.cos(np.radians(43.0))


def _pt(x, y):
    return {"lat": ORIGIN[0] + y / M_LAT, "lon": ORIGIN[1] + x / M_LON}


def _way(wid, ids, pts, **tags):
    tags.setdefault("highway", "footway")
    return {"type": "way", "id": wid, "nodes": ids, "geometry": [_pt(*p) for p in pts], "tags": tags}


def _write(tmp_path, ways):
    f = tmp_path / "hw.json"
    f.write_text(json.dumps({"elements": ways}))
    return f


def _square(tmp_path, extra=()):
    c = [(0, 0), (100, 0), (100, 100), (0, 100)]
    ways = [_way(1, [1, 2], [c[0], c[1]]), _way(2, [2, 3], [c[1], c[2]]),
            _way(3, [3, 4], [c[2], c[3]]), _way(4, [4, 1], [c[3], c[0]])] + list(extra)
    return load_walk_graph(_write(tmp_path, ways), ORIGIN)


def test_square_opposite_corners_follow_edges(tmp_path):
    g = _square(tmp_path)
    assert g.xy.shape == (4, 2) and g.adj.shape == (4, 4)
    d = walk_distance_matrix(g, np.array([[0.0, 0.0]]), np.array([[100.0, 100.0]]))
    assert d[0, 0] == pytest.approx(200.0, abs=0.5)


def test_off_graph_point_adds_snap_distance(tmp_path):
    g = _square(tmp_path)
    d = walk_distance_matrix(g, np.array([[-30.0, 0.0]]), np.array([[100.0, 100.0]]))
    assert d[0, 0] == pytest.approx(230.0, abs=0.5)


def test_private_and_foot_no_ways_excluded(tmp_path):
    extra = [_way(5, [2, 5], [(100, 0), (200, 0)], access="private"),
             _way(6, [3, 6], [(100, 100), (200, 100)], foot="no"),
             _way(7, [4, 7], [(0, 100), (0, 200)], highway="motorway")]
    g = _square(tmp_path, extra)
    assert g.xy.shape[0] == 4


def test_disconnected_fragment_dropped(tmp_path):
    extra = [_way(5, [10, 11, 12], [(500, 500), (520, 500), (540, 500)])]
    g = _square(tmp_path, extra)
    assert g.xy.shape[0] == 4
    assert g.xy.max() < 200


def test_distances_at_least_euclidean(tmp_path):
    g = _square(tmp_path)
    rng = np.random.default_rng(0)
    s, t = rng.uniform(-50, 150, (30, 2)), rng.uniform(-50, 150, (12, 2))
    d = walk_distance_matrix(g, s, t)
    e = np.linalg.norm(s[:, None] - t[None], axis=2)
    assert d.shape == (30, 12) and np.all(d >= e - 1e-9)


def test_real_snapshot():
    g = load_walk_graph("data/york/raw/highways.json", (43.76718, -79.51681))
    assert g.xy.shape[0] > 4000
    rng = np.random.default_rng(1)
    for _ in range(20):
        a = g.xy[rng.integers(len(g.xy))]
        ang = rng.uniform(0, 2 * np.pi)
        b = a + 500 * np.array([np.cos(ang), np.sin(ang)])
        d = walk_distance_matrix(g, a[None], b[None])[0, 0]
        assert 500 - 1e-6 <= d <= 5000
    a, b = latlon_to_xy([43.7740, 43.7740], [-79.5050, -79.5050 + 500 / M_LON], (43.76718, -79.51681))
    d = walk_distance_matrix(g, a[None], b[None])[0, 0]
    assert 500 <= d <= 1000


def test_travel_time_uses_walk_dist():
    inst = generate_instance(seed=0)
    wd = np.full((inst.n_cells, inst.n_sites), 700.0)
    inst = dataclasses.replace(inst, walk_dist_m=wd)
    inst.validate()
    tau = travel_time_matrix(inst, Params())
    assert tau[3, 4] == pytest.approx(60 + 2 * 700.0 / 1.4 + inst.site_floor_delay[4])


def test_validate_rejects_bad_walk_dist():
    inst = generate_instance(seed=0)
    bad = dataclasses.replace(inst, walk_dist_m=np.zeros((inst.n_cells, inst.n_sites - 1)))
    with pytest.raises(ValueError):
        bad.validate()
    neg = dataclasses.replace(inst, walk_dist_m=-np.ones((inst.n_cells, inst.n_sites)))
    with pytest.raises(ValueError):
        neg.validate()
