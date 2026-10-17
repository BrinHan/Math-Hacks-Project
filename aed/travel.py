"""Time from collapse until an AED from site j is at the patient in cell i."""
import numpy as np

from aed.instance import Instance
from aed.params import Params


def travel_time_matrix(inst: Instance, params: Params) -> np.ndarray:
    """(I, J) seconds: tau_ij = dispatch_delay + 2 * detour * d_ij / v + floor_delay_j.

    Distance is inst.walk_dist_m (network metres, no detour factor) when set, else Euclidean x detour factor.
    """
    if inst.walk_dist_m is not None:
        d, detour = inst.walk_dist_m, 1.0
    else:
        d = np.linalg.norm(inst.cell_xy[:, None, :] - inst.site_xy[None, :, :], axis=2)
        detour = params.detour_factor
    walk = 2.0 * detour * d / params.walk_speed_mps
    return params.dispatch_delay_s + walk + inst.site_floor_delay[None, :]
