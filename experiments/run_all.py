"""Regenerate every results CSV: python experiments/run_all.py --seed 0 --n 200"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from experiments import k_curve, uncertainty  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--out", default="results")
    a = ap.parse_args()
    k_curve.main(seed=a.seed, kmax=30, out=a.out, verbose=False)
    uncertainty.main(seed=a.seed, n=a.n, out=a.out)
