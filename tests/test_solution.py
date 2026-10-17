import json

import numpy as np

from aed.pipeline import build
from aed.solvers.greedy import solve_greedy


def test_new_sites_excludes_existing():
    _, cov = build(seed=0, grid_n=8, n_sites=20, n_existing=2)
    sol = solve_greedy(cov, 3)
    new = sol.new_sites(cov.site_existing)
    assert len(new) <= 3 and not cov.site_existing[new].any()


def test_to_dict_json():
    _, cov = build(seed=0, grid_n=8, n_sites=20, n_existing=2)
    d = json.loads(json.dumps(solve_greedy(cov, 3).to_dict()))
    assert d["method"] == "greedy" and len(d["sites"]) <= 5
