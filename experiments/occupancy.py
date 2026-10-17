"""How much does the assumed occupancy schedule drive the answer? -> results/york/occupancy.json.

The schedule (booking rates, attendance, presence by period, outdoor walkers) is assumed,
because the real timetable needs a login. Two checks:

1. Perturbed schedules: every schedule value is scaled by an independent factor drawn
   uniformly in [1 - SPREAD, 1 + SPREAD] (shares capped at 1). For each draw we re-solve,
   then report how much the base-case plan loses against the re-optimised plan (regret),
   and the re-siting gain of the best 19 over York's published 19.
2. Time-blind schedule: every profile is flattened to its hours-weighted weekly mean, so
   demand no longer changes over the week. The plan chosen this way is scored under the
   real schedule, which shows what modelling time of week is worth.

Run: python experiments/occupancy.py --n 40
"""
import argparse
import contextlib
import dataclasses
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed.coverage import build_coverage  # noqa: E402
from aed.data import york  # noqa: E402
from aed.params import Params  # noqa: E402
from aed.solvers.common import evaluate  # noqa: E402
from aed.solvers.ilp import solve_ilp  # noqa: E402
from aed.travel import travel_time_matrix  # noqa: E402

SHARES = ("BOOKING", "STAFF_PRESENCE", "SERVICES_PRESENCE", "RESIDENT_PRESENCE", "ATHLETIC_PRESENCE")
COUNTS = ("OUTDOOR_PEOPLE",)
SPREAD = 0.5
K = 10


@contextlib.contextmanager
def schedule(values: dict):
    """Temporarily replace york's schedule constants and rebuild its cached geometry."""
    saved = {k: getattr(york, k) for k in values}
    try:
        for k, v in values.items():
            setattr(york, k, v)
        york._geometry.cache_clear()
        yield
    finally:
        for k, v in saved.items():
            setattr(york, k, v)
        york._geometry.cache_clear()


def _perturbed(rng: np.random.Generator) -> dict:
    out = {}
    for k in SHARES + COUNTS:
        v = getattr(york, k) * rng.uniform(1 - SPREAD, 1 + SPREAD, size=len(york.PERIODS))
        out[k] = np.minimum(v, 1.0) if k in SHARES else v
    out["ATTENDANCE"] = min(1.0, york.ATTENDANCE * rng.uniform(1 - SPREAD, 1 + SPREAD))
    return out


def _flat() -> dict:
    w = york.PERIOD_HOURS / york.PERIOD_HOURS.sum()
    return {k: np.full(len(york.PERIODS), float(getattr(york, k) @ w)) for k in SHARES + COUNTS}


def _coverages(p: Params) -> tuple:
    inst = york.load_york(p)
    free = dataclasses.replace(inst, site_existing=np.zeros(inst.n_sites, dtype=bool),
                               site_cost=np.ones(inst.n_sites))
    return (build_coverage(inst, travel_time_matrix(inst, p), p),
            build_coverage(free, travel_time_matrix(free, p), p), inst.site_existing)


def main(n: int = 40, out: str = "results/york", seed: int = 0) -> dict:
    p = Params()
    add_cov, free_cov, published = _coverages(p)
    base_plan = solve_ilp(add_cov, K).x
    base_best19 = solve_ilp(free_cov, int(published.sum())).x

    rng = np.random.default_rng(seed)
    regret, regret19, gain = [], [], []
    for _ in range(n):
        with schedule(_perturbed(rng)):
            a, f, _ = _coverages(p)
        best = solve_ilp(a, K).lives
        regret.append(100 * (best - evaluate(a, base_plan)) / best)
        best19 = solve_ilp(f, int(published.sum())).lives
        regret19.append(100 * (best19 - evaluate(f, base_best19)) / best19)
        gain.append(100 * (best19 / evaluate(f, published) - 1))

    with schedule(_flat()):
        a_flat, f_flat, _ = _coverages(p)
    flat_plan = solve_ilp(a_flat, K).x
    flat_best19 = solve_ilp(f_flat, int(published.sum())).x
    lives = evaluate(add_cov, base_plan)
    lives19 = evaluate(free_cov, base_best19)

    def pct(v):
        return {"mean": round(float(np.mean(v)), 2), "p5": round(float(np.percentile(v, 5)), 2),
                "p95": round(float(np.percentile(v, 95)), 2)}

    result = {
        "spread": SPREAD, "n": n, "K": K,
        "perturbed": {
            f"regret_add_{K}_pct": pct(regret),
            "regret_best_19_pct": pct(regret19),
            "gain_best_19_vs_published_pct": pct(gain),
        },
        "time_blind": {
            f"add_{K}_lives": round(evaluate(add_cov, flat_plan), 5),
            f"add_{K}_lives_time_aware": round(lives, 5),
            f"add_{K}_loss_pct": round(100 * (lives - evaluate(add_cov, flat_plan)) / lives, 2),
            "best_19_lives": round(evaluate(free_cov, flat_best19), 5),
            "best_19_lives_time_aware": round(lives19, 5),
            "best_19_loss_pct": round(100 * (lives19 - evaluate(free_cov, flat_best19)) / lives19, 2),
        },
    }
    path = Path(out) / "occupancy.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--n", type=int, default=40)
    ap.add_argument("--out", default="results/york")
    a = ap.parse_args()
    main(a.n, a.out)
