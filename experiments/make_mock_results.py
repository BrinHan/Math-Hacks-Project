"""Write fake results in the exact CSV formats the real experiments will produce.

Teammates 3 and 4 build against these until the model's real output exists.
Run: python experiments/make_mock_results.py
"""
import csv
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed.data.synthetic import generate_instance  # noqa: E402
from aed.instance import metres_to_latlon  # noqa: E402
from aed.params import RANGES, Params  # noqa: E402

EXISTING_LIVES = 0.05


def _write(path: Path, header: list[str], rows: list[list]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def _ilp_lives(K):
    return EXISTING_LIVES + 0.4 * (1 - np.exp(-np.asarray(K, dtype=float) / 8))


def main(out_dir="results/mock") -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)

    rows = []
    for K in range(31):
        ilp = float(_ilp_lives(K))
        added = ilp - EXISTING_LIVES
        greedy = EXISTING_LIVES + added * 0.97
        swap = EXISTING_LIVES + added * 0.99
        pop = EXISTING_LIVES + added * 0.80
        gap = 0.0 if ilp == 0 else 100 * (ilp - greedy) / ilp
        rows.append([K, round(ilp, 5), round(greedy, 5), round(swap, 5), round(pop, 5),
                     EXISTING_LIVES, round(gap, 3), round(0.2 + 0.05 * K, 3)])
    _write(out / "k_curve.csv", ["K", "ilp_lives", "greedy_lives", "swap_lives", "pop_lives",
                                 "existing_lives", "gap_pct", "ilp_time_s"], rows)

    rows = []
    for K in range(0, 31, 5):
        mean = float(_ilp_lives(K))
        rows.append([K, round(mean, 5), round(mean * 0.6, 5), round(mean * 1.45, 5)])
    _write(out / "mc_kcurve.csv", ["K", "mean", "p5", "p95"], rows)

    inst = generate_instance(seed=0)
    latlon = metres_to_latlon(inst.site_xy, inst.origin_latlon)
    freq = np.where(inst.site_existing, 1.0, rng.beta(0.3, 3.0, size=inst.n_sites))
    rows = [[j, round(x, 1), round(y, 1), round(lat, 6), round(lon, 6), kind, int(ex), round(fr, 3)]
            for j, ((x, y), (lat, lon), kind, ex, fr)
            in enumerate(zip(inst.site_xy, latlon, inst.site_kind, inst.site_existing, freq))]
    _write(out / "site_freq.csv", ["site_id", "x_m", "y_m", "lat", "lon", "kind", "existing", "freq"], rows)

    base = Params()
    base_lives = float(_ilp_lives(10))
    rows = []
    for name, (lo, hi) in RANGES.items():
        swing = base_lives * rng.uniform(0.05, 0.4)
        rows.append([name, lo, hi, round(base_lives - swing, 5), round(base_lives + swing * 0.8, 5),
                     round(base_lives, 5)])
    _write(out / "oat.csv", ["param", "low_value", "high_value", "lives_at_low", "lives_at_high",
                             "base_lives"], rows)
    print(f"wrote mock results to {out} (base Params: {base})")


if __name__ == "__main__":
    main()
