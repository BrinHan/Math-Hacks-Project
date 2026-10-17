"""Compare York's 19 published AEDs with the model's best placements -> results/york_validation.json.

Three steps: York's AEDs as published, the same AEDs moved to their building's nearest door,
and the best 19 sites anywhere. Repeated under structural scenarios so the headline is a range.
Run: python experiments/york_validation.py --out results
"""
import argparse
import dataclasses
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed.coverage import build_coverage  # noqa: E402
from aed.data import york  # noqa: E402
from aed.data.york_tables import load_buildings  # noqa: E402
from aed.params import Params  # noqa: E402
from aed.solvers.common import evaluate  # noqa: E402
from aed.solvers.ilp import solve_ilp  # noqa: E402
from aed.travel import travel_time_matrix  # noqa: E402

GAP_WALK_S = 180.0   # a building is a gap if the nearest published AED is over 3 min walk one way

SCENARIOS = [
    ("base case", {}, None),
    ("handbook beds only", {"beds": "handbook"}, None),
    ("all housing incl. private", {"beds": "all"}, None),
    ("no residents", {"beds": "none"}, None),
    ("no outdoor cabinets", {"outdoor_cabinets": False}, None),
    ("York AEDs 20 s to reach", {}, york.FLOOR_DELAY_ENTRANCE_S),
    ("shortcut radius 200 m", {"shortcut_m": 200.0}, None),
    ("footpaths only, no shortcut", {"shortcut_m": None}, None),
]


def _steps(p: Params, load_kwargs: dict, existing_delay) -> dict:
    inst = york.load_york(p, **load_kwargs)
    names = np.array(york.site_buildings(**load_kwargs))
    published = inst.site_existing.copy()
    if existing_delay is not None:
        inst = dataclasses.replace(inst, site_floor_delay=np.where(published, existing_delay,
                                                                   inst.site_floor_delay))
    # nothing pre-installed, unit cost: every placement competes on the same terms
    free = dataclasses.replace(inst, site_existing=np.zeros(inst.n_sites, dtype=bool),
                               site_cost=np.ones(inst.n_sites))
    cov = build_coverage(free, travel_time_matrix(free, p), p)

    door = np.zeros(inst.n_sites, dtype=bool)
    candidates = ~published & (np.array(inst.site_kind) != "outdoor")
    for j in np.flatnonzero(published):
        same = np.flatnonzero(candidates & (names == names[j]) & ~door)   # one AED per door
        if len(same):
            door[same[np.argmin(np.linalg.norm(inst.site_xy[same] - inst.site_xy[j], axis=1))]] = True
        else:
            door[j] = True
    assert door.sum() == published.sum()
    best = solve_ilp(cov, int(published.sum()))
    out = {"published": evaluate(cov, published), "published_at_door": evaluate(cov, door),
           "best": best.lives}
    out["gain_vs_published_pct"] = 100 * (out["best"] / out["published"] - 1)
    out["gain_vs_door_pct"] = 100 * (out["best"] / out["published_at_door"] - 1)
    out["best_buildings"] = sorted(set(names[best.x]))
    return out


def _gaps(p: Params) -> list[dict]:
    """Busy buildings whose nearest published AED (open on weekday afternoons) is over
    3 minutes' walk one way, by walking-path distance from the building's centre cell."""
    inst = york.load_york(p)
    q = york.PERIODS.index("weekday_afternoon")
    usable = inst.site_existing & inst.site_open[:, q]
    walk_s = np.where(usable, inst.walk_dist_m, np.inf).min(1) / p.walk_speed_mps
    hazard = p.public_fraction / p.away_time_share
    gaps = []
    for b in load_buildings():
        if b["kind"] == "ignore":
            continue
        cell = int(np.argmin(np.linalg.norm(inst.cell_xy - [b["cx"], b["cy"]], axis=1)))
        if walk_s[cell] <= GAP_WALK_S:
            continue
        people = york._building_people(b, york._beds(b, "york"))
        rate = float((people * york.PERIOD_HOURS)[:2].sum() / 24 * p.incidence_per_100k_yr / 1e5 * hazard)
        gaps.append({"building": york._label(b), "kind": b["kind"],
                     "walk_to_nearest_published_aed_s": round(float(walk_s[cell])),
                     "weekday_arrests_per_year": round(rate, 4)})
    return sorted(gaps, key=lambda g: -g["weekday_arrests_per_year"])


def main(out="results") -> dict:
    p = Params()
    table = []
    for label, kwargs, delay in SCENARIOS:
        r = _steps(p, kwargs, delay)
        table.append({"scenario": label, **{k: (round(v, 5) if isinstance(v, float) else v)
                                            for k, v in r.items()}})
        print(f"{label:28s} published {r['published']:.4f}  at door {r['published_at_door']:.4f}  "
              f"best {r['best']:.4f}  gain {r['gain_vs_published_pct']:+.0f}% "
              f"({r['gain_vs_door_pct']:+.0f}% vs door)")
    gains = [row["gain_vs_published_pct"] for row in table]
    door_gains = [row["gain_vs_door_pct"] for row in table]
    gaps = _gaps(p)
    result = {
        "n_published_aeds": 19,
        "base": table[0],
        "gain_vs_published_range_pct": [round(min(gains)), round(max(gains))],
        "gain_vs_door_range_pct": [round(min(door_gains)), round(max(door_gains))],
        "scenarios": table,
        "gap_walk_threshold_s": GAP_WALK_S,
        "coverage_gaps": gaps[:15],
    }
    path = Path(out) / "york_validation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1))
    print("gain range", result["gain_vs_published_range_pct"], "vs door", result["gain_vs_door_range_pct"])
    print("top gaps:", [g["building"] for g in gaps[:8]])
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="results")
    main(out=ap.parse_args().out)
