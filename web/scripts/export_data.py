"""Export the lead's campus and results to JSON for the web app.

Run from the repo root after `python experiments/run_all.py --seed 0 --n 200`:
    python web/scripts/export_data.py --seed 0

Writes web/public/data/lead.json: the York Keele Instance from aed.data.york (default) or the
synthetic campus for a seed (--campus synthetic),
(so site ids match results/placements.json and site_freq.csv) plus every results file.
"""
import argparse
import csv
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from aed.data.synthetic import generate_instance  # noqa: E402
from aed.data.york import load_york, site_buildings  # noqa: E402
from aed.data.york_tables import YORK_ORIGIN as YORK_MODEL_ORIGIN, load_buildings, load_footprints  # noqa: E402
from aed.instance import metres_to_latlon  # noqa: E402
from aed.params import CITATIONS, RANGES, Params  # noqa: E402

# Display anchor only: the web app maps the 2 km square onto York University's Keele campus.
# Positions stay in the generator's local metres, so every result is unchanged.
YORK_ORIGIN = (43.7645, -79.5143)


def num(v: str):
    try:
        f = float(v)
    except ValueError:
        return v
    return None if math.isnan(f) else (int(f) if f.is_integer() and "." not in v else f)


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return [{k: num(v) for k, v in row.items()} for row in csv.DictReader(f)]


def main(seed: int, results: Path, out: Path, campus: str = "york") -> None:
    p = Params()
    inst = load_york(p) if campus == "york" else generate_instance(seed=seed, params=p)
    inst.validate()
    york = campus == "york"
    step = 50.0 if york else float(inst.cell_xy[1, 0] - inst.cell_xy[0, 0])
    origin = inst.origin_latlon if york else YORK_ORIGIN

    data = {
        "source": {"generator": "aed.data.york.load_york" if york else "aed.data.synthetic.generate_instance",
                   "campus": campus, "seed": seed,
                   "results_dir": str(results.relative_to(ROOT)).replace("\\", "/"),
                   "python_origin_latlon": list(inst.origin_latlon)},
        "params": {f: getattr(p, f) for f in p.__dataclass_fields__},
        "ranges": RANGES,
        "citations": CITATIONS,
        "instance": {
            "cellXY": inst.cell_xy.ravel().tolist(),
            "cellRate": inst.cell_rate.ravel().tolist(),
            "siteXY": inst.site_xy.ravel().tolist(),
            "siteCost": inst.site_cost.tolist(),
            "siteFloorDelay": inst.site_floor_delay.tolist(),
            "siteOpen": inst.site_open.astype(int).ravel().tolist(),
            "siteExisting": inst.site_existing.astype(int).tolist(),
            "siteKind": list(inst.site_kind),
            "periods": list(inst.periods),
            "periodHours": [float(h) for h in inst.period_hours],
            "originLatLon": list(origin),
            "nCells": inst.n_cells,
            "nSites": inst.n_sites,
            "cellSizeM": step,
        },
        "footprints": [],
        "campus": [],
        "results": {
            "kCurve": read_csv(results / "k_curve.csv"),
            "mcKCurve": read_csv(results / "mc_kcurve.csv"),
            "siteFreq": [{"site_id": r["site_id"], "freq": r["freq"]} for r in read_csv(results / "site_freq.csv")],
            "oat": read_csv(results / "oat.csv"),
            "placements": {int(k): v for k, v in json.loads((results / "placements.json").read_text()).items()},
        },
    }
    if york:
        # Walking-path distances (metres, 0.1 m) replace straight line x detour in the app too.
        data["instance"]["walkDistM"] = [round(float(v), 1) for v in inst.walk_dist_m.ravel()]
        data["instance"]["siteName"] = site_buildings()
        feet = load_footprints()
        for b in load_buildings():
            if b["kind"] == "ignore":
                continue
            ring = metres_to_latlon(feet[b["osm_id"]], YORK_MODEL_ORIGIN)
            data["footprints"].append({"id": str(b["osm_id"]), "name": b["name"],
                                       "ring": [[round(a, 6), round(c, 6)] for a, c in ring]})
        validation = results / "york_validation.json"
        if validation.exists():
            data["results"]["yorkValidation"] = json.loads(validation.read_text())
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB): {inst.n_cells} cells, {inst.n_sites} sites, "
          f"K = 0..{max(data['results']['placements'])}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--campus", choices=["york", "synthetic"], default="york")
    ap.add_argument("--results", type=Path, default=None, help="default: results/york for York, results otherwise")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "data" / "lead.json")
    a = ap.parse_args()
    results = a.results or (ROOT / "results" / "york" if a.campus == "york" else ROOT / "results")
    main(a.seed, results.resolve(), a.out.resolve(), a.campus)
