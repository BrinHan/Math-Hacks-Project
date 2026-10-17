"""Expected lives saved per year vs budget K for every method -> results/k_curve.csv.

Run: python experiments/k_curve.py --seed 0 --kmax 30 --out results
"""
import argparse
import csv
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed.pipeline import build  # noqa: E402
from aed.solvers.common import evaluate  # noqa: E402
from aed.solvers.greedy import solve_greedy  # noqa: E402
from aed.solvers.ilp import solve_ilp  # noqa: E402
from aed.solvers.swap import solve_swap  # noqa: E402

try:  # Teammate 2's population-only baseline, once merged
    from aed.solvers.population import solve_population
except ImportError:
    solve_population = None

HEADER = ["K", "ilp_lives", "greedy_lives", "swap_lives", "pop_lives", "existing_lives",
          "gap_pct", "ilp_time_s"]


def main(seed: int = 0, kmax: int = 30, out="results", verbose: bool = True, campus: str = "synthetic",
         **gen_kwargs) -> Path:
    inst, cov = build(seed=seed, campus=campus, **gen_kwargs)
    existing = evaluate(cov, cov.site_existing)
    rows, placements = [], {}
    for K in range(kmax + 1):
        ilp = solve_ilp(cov, K)
        greedy = solve_greedy(cov, K)
        swap = solve_swap(cov, K, init=greedy)
        pop = solve_population(inst, cov, K).lives if solve_population else math.nan
        placements[K] = [int(j) for j in ilp.new_sites(cov.site_existing)]
        gap = 0.0 if ilp.lives == 0 else 100 * (ilp.lives - greedy.lives) / ilp.lives
        rows.append([K, ilp.lives, greedy.lives, swap.lives, pop, existing, gap, ilp.runtime_s])
        if verbose:
            print(f"K={K:2d}  ilp={ilp.lives:.4f}  greedy={greedy.lives:.4f}  swap={swap.lives:.4f}  "
                  f"pop={pop:.4f}  gap={gap:5.2f}%  ilp_t={ilp.runtime_s:.1f}s")

    path = Path(out) / "k_curve.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows([[r[0]] + [round(v, 6) for v in r[1:]] for r in rows])
    (path.parent / "placements.json").write_text(json.dumps(placements, indent=1))
    print(f"wrote {path} and placements.json")
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--kmax", type=int, default=30)
    ap.add_argument("--out", default="results")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--campus", choices=["york", "synthetic"], default="york")
    a = ap.parse_args()
    main(seed=a.seed, kmax=a.kmax, out=a.out, verbose=not a.quiet, campus=a.campus)
