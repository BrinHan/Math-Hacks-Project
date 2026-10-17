"""Monte Carlo over parameters, demand and lockout, plus one-at-a-time sensitivity.

Positions never change between scenarios, so per-site selection frequencies are comparable.
"""
import dataclasses
from dataclasses import dataclass

import numpy as np

from aed.coverage import Coverage, build_coverage
from aed.data.synthetic import generate_instance
from aed.instance import Instance
from aed.params import RANGES, Params
from aed.solvers.common import evaluate
from aed.solvers.greedy import solve_greedy
from aed.solvers.ilp import solve_ilp
from aed.travel import travel_time_matrix

GEN_KWARGS: dict = {}       # passed to generate_instance; tests shrink the campus here
DEMAND_SCALE = (0.7, 1.3)   # ASSUMPTION: +-30% uncertainty in campus foot traffic
LOCKOUT_FLIP_FRAC = 0.10    # ASSUMPTION: 10% of opening schedules are wrong


@dataclass
class MCResult:
    lives_fixed: np.ndarray  # (n,) base-case ILP placement evaluated in each scenario
    lives_reopt: np.ndarray  # (n,) greedy re-optimized per scenario
    site_freq: np.ndarray    # (J,) share of scenarios whose re-optimized placement uses site j


@dataclass
class OATRow:
    param: str
    low_value: float
    high_value: float
    lives_at_low: float
    lives_at_high: float
    base_lives: float


def _rescale_demand(inst: Instance, base: Params, p: Params, factor: float = 1.0) -> Instance:
    """cell_rate was generated with base epidemiology; rescale it to p's."""
    epi = (p.incidence_per_100k_yr / base.incidence_per_100k_yr) * (p.public_fraction / base.public_fraction)
    return dataclasses.replace(inst, cell_rate=inst.cell_rate * epi * factor,
                               site_open=inst.site_open.copy())


def _coverage(inst: Instance, p: Params) -> Coverage:
    return build_coverage(inst, travel_time_matrix(inst, p), p)


def sample_scenario(inst: Instance, base: Params, rng: np.random.Generator) -> tuple[Instance, Params]:
    p = dataclasses.replace(base, **{k: float(rng.uniform(lo, hi)) for k, (lo, hi) in RANGES.items()})
    s = _rescale_demand(inst, base, p, float(rng.uniform(*DEMAND_SCALE)))
    candidates = np.flatnonzero(~inst.site_existing)
    n_flip = min(len(candidates), max(1, round(LOCKOUT_FLIP_FRAC * len(candidates))))
    for j in rng.choice(candidates, size=n_flip, replace=False):
        q = rng.integers(inst.n_periods)
        s.site_open[j, q] = ~s.site_open[j, q]
    return s, p


def _base(seed: int, base: Params | None) -> tuple[Instance, Params]:
    base = base or Params()
    return generate_instance(seed=seed, params=base, **GEN_KWARGS), base


def monte_carlo(seed: int, budget: float, n: int = 500, rng_seed: int = 0,
                base: Params | None = None) -> MCResult:
    inst, base = _base(seed, base)
    x_base = solve_ilp(_coverage(inst, base), budget).x
    rng = np.random.default_rng(rng_seed)
    fixed, reopt, picks = np.zeros(n), np.zeros(n), np.zeros(inst.n_sites)
    for s in range(n):
        cov = _coverage(*sample_scenario(inst, base, rng))
        fixed[s] = evaluate(cov, x_base)
        sol = solve_greedy(cov, budget)
        reopt[s] = sol.lives
        picks += sol.x
    return MCResult(lives_fixed=fixed, lives_reopt=reopt, site_freq=picks / n)


def monte_carlo_curve(seed: int, budgets: list[int], n: int = 200, rng_seed: int = 0,
                      base: Params | None = None) -> dict[int, np.ndarray]:
    """lives_fixed for several budgets over the same scenarios (one coverage build each)."""
    inst, base = _base(seed, base)
    base_cov = _coverage(inst, base)
    placements = {K: solve_ilp(base_cov, K).x for K in budgets}
    rng = np.random.default_rng(rng_seed)
    out = {K: np.zeros(n) for K in budgets}
    for s in range(n):
        cov = _coverage(*sample_scenario(inst, base, rng))
        for K, x in placements.items():
            out[K][s] = evaluate(cov, x)
    return out


def oat_sensitivity(seed: int, budget: float, base: Params | None = None) -> list[OATRow]:
    inst, base = _base(seed, base)
    base_lives = solve_ilp(_coverage(inst, base), budget).lives
    rows = []
    for name, (lo, hi) in RANGES.items():
        lives = []
        for v in (lo, hi):
            p = dataclasses.replace(base, **{name: v})
            lives.append(solve_ilp(_coverage(_rescale_demand(inst, base, p), p), budget).lives)
        rows.append(OATRow(name, lo, hi, lives[0], lives[1], base_lives))
    return sorted(rows, key=lambda r: abs(r.lives_at_high - r.lives_at_low), reverse=True)
