"""Does the Monte Carlo band depend on the uniform prior? -> results/york/prior_check.json.

Re-runs the K = 10 Monte Carlo with every parameter drawn uniformly over its range (as in
mc_kcurve.csv) and with a triangular prior over the same range, peaked at the base value.
Same scenarios otherwise (demand scale, opening-hour flips, seed).
Run: python experiments/prior_check.py --n 200
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed import uncertainty as unc  # noqa: E402
from aed.uncertainty import monte_carlo_curve  # noqa: E402


def main(K: int = 10, n: int = 200, out: str = "results/york") -> dict:
    unc.CAMPUS = "york"
    result = {"K": K, "n": n}
    for prior in ("uniform", "triangular"):
        unc.PRIOR = prior
        v = monte_carlo_curve(0, [K], n=n, rng_seed=0)[K]
        result[prior] = {"mean": round(float(v.mean()), 5),
                         "p5": round(float(np.percentile(v, 5)), 5),
                         "p95": round(float(np.percentile(v, 95)), 5)}
        print(prior, result[prior])
    unc.PRIOR = "uniform"
    path = Path(out) / "prior_check.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1))
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--K", type=int, default=10)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--out", default="results/york")
    a = ap.parse_args()
    main(a.K, a.n, a.out)
