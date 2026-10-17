"""Does the survival curve's shape change the answer? -> results/york/survival_form.json.

Solves York under exponential S(t) = S0 e^(-kt) and linear S(t) = S0 (1 - kt) with the same
S0 and k. For each form: K new AEDs on top of the published 19, and the best 19 anywhere.
Reports lives saved, how many chosen sites the two plans share, and the regret of using
the other form's plan (lives lost against the optimum when the true curve is the other one).
Run: python experiments/survival_form.py
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
from aed.params import Params  # noqa: E402
from aed.solvers.common import evaluate  # noqa: E402
from aed.solvers.ilp import solve_ilp  # noqa: E402
from aed.travel import travel_time_matrix  # noqa: E402

FORMS = ("exp", "linear")


def _coverages(free: bool) -> dict:
    out = {}
    for form in FORMS:
        p = Params(survival_form=form)
        inst = york.load_york(p)
        if free:  # nothing pre-installed, unit cost: the "best 19 anywhere" comparison
            inst = dataclasses.replace(inst, site_existing=np.zeros(inst.n_sites, dtype=bool),
                                       site_cost=np.ones(inst.n_sites))
        out[form] = build_coverage(inst, travel_time_matrix(inst, p), p)
    return out


def _compare(covs: dict, budget: int, baseline: np.ndarray | None) -> dict:
    plans = {f: solve_ilp(covs[f], budget).x for f in FORMS}
    res = {}
    for f in FORMS:
        other = FORMS[1 - FORMS.index(f)]
        best = evaluate(covs[f], plans[f])
        cross = evaluate(covs[f], plans[other])
        res[f] = {"lives": round(best, 5),
                  "lives_with_other_form_plan": round(cross, 5),
                  "regret_pct": round(100 * (best - cross) / best, 3)}
        if baseline is not None:
            res[f]["published"] = round(evaluate(covs[f], baseline), 5)
            res[f]["gain_vs_published_pct"] = round(100 * (best / res[f]["published"] - 1), 2)
    fixed = covs["exp"].site_existing
    a, b = plans["exp"] & ~fixed, plans["linear"] & ~fixed
    res["shared_sites"] = int((a & b).sum())
    res["chosen_sites"] = int(a.sum())
    return res


def main(K: int = 10, out: str = "results/york") -> dict:
    published = york.load_york(Params()).site_existing
    result = {
        "params": {"survival_S0": Params().survival_S0, "survival_k_per_min": Params().survival_k_per_min},
        f"add_{K}_to_published": _compare(_coverages(False), K, None),
        "best_19_anywhere": _compare(_coverages(True), int(published.sum()), published),
    }
    path = Path(out) / "survival_form.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--K", type=int, default=10)
    ap.add_argument("--out", default="results/york")
    a = ap.parse_args()
    main(a.K, a.out)
