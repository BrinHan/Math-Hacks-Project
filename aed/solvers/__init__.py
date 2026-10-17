from aed.solvers.common import Solution, evaluate, evaluate_by_period
from aed.solvers.greedy import solve_greedy
from aed.solvers.ilp import solve_ilp
from aed.solvers.swap import solve_swap

SOLVERS = {"ilp": solve_ilp, "greedy": solve_greedy, "swap": solve_swap}

__all__ = ["SOLVERS", "Solution", "evaluate", "evaluate_by_period", "solve_greedy", "solve_ilp", "solve_swap"]
