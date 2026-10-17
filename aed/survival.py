"""Survival as a function of time to defibrillation, and per-band benefit."""
import numpy as np

from aed.params import Params


def survival(t_s: float | np.ndarray, params: Params) -> np.ndarray:
    """Survival probability if shocked t_s seconds after collapse."""
    t_min = np.asarray(t_s, dtype=float) / 60.0
    if params.survival_form == "exp":
        return params.survival_S0 * np.exp(-params.survival_k_per_min * t_min)
    if params.survival_form == "linear":
        return np.maximum(0.0, params.survival_S0 * (1.0 - params.survival_k_per_min * t_min))
    raise ValueError(f"unknown survival_form {params.survival_form!r}")


def band_benefits(params: Params) -> tuple[np.ndarray, np.ndarray]:
    """(edges_s, b): b_k = f * max(0, S(T_k) - S(ems_response)), bands with b_k = 0 dropped.

    f = shockable_fraction: an AED only helps arrests with a shockable rhythm (VF/pVT).
    b is non-increasing in k because S is non-increasing in t.
    """
    edges = np.asarray(params.band_edges_s, dtype=float)
    gain = survival(edges, params) - survival(params.ems_response_s, params)
    b = params.shockable_fraction * np.maximum(0.0, gain)
    keep = b > 0
    return edges[keep], b[keep]
