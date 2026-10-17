"""Walking distances over the OSM path network (numpy/scipy only)."""
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

from aed.geo import latlon_to_xy

WALKABLE = frozenset({"footway", "path", "pedestrian", "steps", "service", "residential", "cycleway",
                      "living_street", "track", "unclassified", "tertiary", "secondary", "primary"})


@dataclass
class WalkGraph:
    xy: np.ndarray        # (N, 2) node positions, metres
    adj: csr_matrix       # (N, N) symmetric, edge length in metres


def load_walk_graph(highways_json: str | Path, origin_latlon) -> WalkGraph:
    """Largest connected walkable graph from Overpass `out geom tags` JSON.

    Nodes are keyed by OSM node id when a way lists `nodes`, else by lat/lon rounded to 1e-7 degrees
    (the OSM resolution, so shared junction nodes coincide).
    """
    with open(highways_json, encoding="utf-8") as f:
        elements = json.load(f)["elements"]
    index: dict = {}
    pts: list[tuple[float, float]] = []
    edges: list[tuple[int, int]] = []
    for el in elements:
        tags = el.get("tags", {})
        if el.get("type") != "way" or tags.get("highway") not in WALKABLE:
            continue
        if tags.get("access") in ("private", "no") or tags.get("foot") == "no":
            continue
        geom = el.get("geometry", [])
        keys = el.get("nodes") or [(round(p["lat"], 7), round(p["lon"], 7)) for p in geom]
        ids = []
        for key, p in zip(keys, geom):
            if key not in index:
                index[key] = len(pts)
                pts.append((p["lat"], p["lon"]))
            ids.append(index[key])
        edges += [(a, b) for a, b in zip(ids[:-1], ids[1:]) if a != b]
    if not edges:
        raise ValueError(f"no walkable ways in {highways_json}")
    ll = np.array(pts)
    xy = latlon_to_xy(ll[:, 0], ll[:, 1], origin_latlon)
    e = np.unique(np.sort(np.array(edges), axis=1), axis=0)      # undirected, de-duplicated
    w = np.linalg.norm(xy[e[:, 0]] - xy[e[:, 1]], axis=1)
    n = len(xy)
    adj = csr_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n))
    _, labels = connected_components(adj, directed=False)
    keep = np.flatnonzero(labels == np.bincount(labels).argmax())
    return WalkGraph(xy=xy[keep], adj=adj[keep][:, keep].tocsr())


def walk_distance_matrix(g: WalkGraph, src_xy: np.ndarray, dst_xy: np.ndarray) -> np.ndarray:
    """(I, J) metres: snap to nearest graph node + shortest path + snap, floored at Euclidean distance."""
    src_xy, dst_xy = np.asarray(src_xy, float), np.asarray(dst_xy, float)
    tree = cKDTree(g.xy)
    s_snap, s_node = tree.query(src_xy)
    d_snap, d_node = tree.query(dst_xy)
    uniq, inv = np.unique(d_node, return_inverse=True)
    sp = dijkstra(g.adj, directed=False, indices=uniq)           # (U, N)
    path = sp[:, s_node][inv].T                                  # (I, J)
    d = s_snap[:, None] + path + d_snap[None, :]
    euclid = np.linalg.norm(src_xy[:, None, :] - dst_xy[None, :, :], axis=2)
    return np.maximum(d, euclid)
