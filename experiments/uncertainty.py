"""Monte Carlo + one-at-a-time sensitivity -> mc_kcurve.csv, site_freq.csv, oat.csv.

Run: python experiments/uncertainty.py --seed 0 --n 200 --out results
"""
import argparse
import csv
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed.instance import metres_to_latlon  # noqa: E402
from aed.uncertainty import _base, monte_carlo, monte_carlo_curve, oat_sensitivity  # noqa: E402

BUDGETS = list(range(0, 31, 5))
SITE_BUDGET = 10


def _write(path: Path, header: list[str], rows: list[list]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f"wrote {path}")


def main(seed: int = 0, n: int = 200, out="results", rng_seed: int = 0) -> None:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()

    curve = monte_carlo_curve(seed, BUDGETS, n=n, rng_seed=rng_seed)
    _write(out / "mc_kcurve.csv", ["K", "mean", "p5", "p95"],
           [[K, round(v.mean(), 6), round(np.percentile(v, 5), 6), round(np.percentile(v, 95), 6)]
            for K, v in curve.items()])
    print(f"  curve done in {time.perf_counter() - t0:.0f}s")

    inst, _ = _base(seed, None)
    res = monte_carlo(seed, SITE_BUDGET, n=n, rng_seed=rng_seed)
    latlon = metres_to_latlon(inst.site_xy, inst.origin_latlon)
    _write(out / "site_freq.csv", ["site_id", "x_m", "y_m", "lat", "lon", "kind", "existing", "freq"],
           [[j, round(x, 1), round(y, 1), round(lat, 6), round(lon, 6), kind, int(ex), round(fr, 4)]
            for j, ((x, y), (lat, lon), kind, ex, fr)
            in enumerate(zip(inst.site_xy, latlon, inst.site_kind, inst.site_existing, res.site_freq))])
    print(f"  K={SITE_BUDGET}: fixed plan {res.lives_fixed.mean():.4f} "
          f"[{np.percentile(res.lives_fixed, 5):.4f}, {np.percentile(res.lives_fixed, 95):.4f}], "
          f"re-optimized {res.lives_reopt.mean():.4f}")

    rows = oat_sensitivity(seed, SITE_BUDGET)
    _write(out / "oat.csv", ["param", "low_value", "high_value", "lives_at_low", "lives_at_high", "base_lives"],
           [[r.param, r.low_value, r.high_value, round(r.lives_at_low, 6), round(r.lives_at_high, 6),
             round(r.base_lives, 6)] for r in rows])
    print(f"done in {time.perf_counter() - t0:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--out", default="results")
    a = ap.parse_args()
    main(seed=a.seed, n=a.n, out=a.out)
