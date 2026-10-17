"""Solution record and the single objective evaluation every solver reports through."""
from dataclasses import dataclass

import numpy as np

from aed.coverage import Coverage


@dataclass
class Solution:
    x: np.ndarray          # (J,) bool, AED at site j (existing included)
    lives: float           # expected lives saved per year vs ambulance-only
    method: str
    runtime_s: float
    mip_gap: float | None = None


def _covered(cov: Coverage, x: np.ndarray) -> np.ndarray:
    return (cov.A @ np.asarray(x, dtype=float)) >= 1


def evaluate(cov: Coverage, x: np.ndarray) -> float:
    return float(cov.weights[_covered(cov, x)].sum())


def evaluate_by_period(cov: Coverage, x: np.ndarray) -> np.ndarray:
    covered = _covered(cov, x)
    return np.bincount(cov.row_period[covered], weights=cov.weights[covered],
                       minlength=cov.n_periods)
