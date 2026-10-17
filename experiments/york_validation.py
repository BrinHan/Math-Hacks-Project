"""Compare York's 19 published AEDs with the model's best placements -> results/york_validation.json.

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
from aed.data.york import PERIODS, load_york  # noqa: E402
from aed.data.york_tables import load_buildings  # noqa: E402
from aed.params import Params  # noqa: E402
from aed.solvers.common import evaluate  # noqa: E402
from aed.solvers.ilp import solve_ilp  # noqa: E402
from aed.travel import travel_time_matrix  # noqa: E402

GAP_S = 180.0   # "no AED within 3 minutes" of a building


def main(out="results") -> dict:
    p = Params()
    inst = load_york(p)
    tau = travel_time_matrix(inst, p)
    cov = build_coverage(inst, tau, p)
    york = inst.site_existing.copy()
    n_york = int(york.sum())

    # Re-siting: the same number of AEDs, anywhere, unit cost, nothing pre-installed.
    free = dataclasses.replace(inst, site_existing=np.zeros(inst.n_sites, dtype=bool),
                               site_cost=np.ones(inst.n_sites))
    free_cov = build_coverage(free, tau, p)
    best = solve_ilp(free_cov, n_york)
    york_lives = evaluate(free_cov, york)

    # Coverage gaps: busy buildings whose nearest published AED is over 3 minutes away
    # (weekday afternoon, AED must be open).
    q = PERIODS.index("weekday_afternoon")
    reach = np.where(york & inst.site_open[:, q], tau, np.inf).min(1)
    gaps = []
    for b in load_buildings():
        if b["kind"] == "ignore":
            continue
        cell = int(np.argmin(np.linalg.norm(inst.cell_xy - [b["cx"], b["cy"]], axis=1)))
        if reach[cell] > GAP_S:
            gaps.append({"building": b["name"] or f"osm {b['osm_id']}", "kind": b["kind"],
                         "seconds_to_aed": None if np.isinf(reach[cell]) else round(float(reach[cell])),
                         "weekday_rate": round(float(inst.cell_rate[cell, :2].sum()), 5)})
    gaps.sort(key=lambda g: -g["weekday_rate"])

    result = {
        "n_published_aeds": n_york,
        "lives_published_19": round(york_lives, 5),
        "lives_best_19": round(best.lives, 5),
        "resiting_gain_pct": round(100 * (best.lives - york_lives) / york_lives, 1) if york_lives else None,
        "overlap_sites": int((best.x & york).sum()),
        "best_19_kinds": sorted({inst.site_kind[j] for j in np.flatnonzero(best.x)}),
        "gap_threshold_s": GAP_S,
        "coverage_gaps": gaps[:15],
    }
    path = Path(out) / "york_validation.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1))
    print(json.dumps({k: v for k, v in result.items() if k != "coverage_gaps"}, indent=1))
    print("top gaps:", [g["building"] for g in gaps[:8]])
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="results")
    main(out=ap.parse_args().out)
