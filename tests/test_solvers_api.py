from aed.pipeline import build
from aed.solvers import SOLVERS


def test_registry_methods_solve():
    _, cov = build(seed=0, grid_n=8, n_sites=20, n_existing=1)
    assert set(SOLVERS) == {"ilp", "greedy", "swap"}
    for name, solve in SOLVERS.items():
        assert solve(cov, 2).method == name
