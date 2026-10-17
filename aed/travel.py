"""Time from collapse until an AED from site j is at the patient in cell i."""
import numpy as np

from aed.instance import Instance
from aed.params import Params


def travel_time_matrix(inst: Instance, params: Params) -> np.ndarray:
    """(I, J) seconds: dispatch delay + round trip at walking speed + floor delay.

    Distance is Euclidean x detour factor (fallback until OSMnx network distances).
    """
    d = np.linalg.norm(inst.cell_xy[:, None, :] - inst.site_xy[None, :, :], axis=2)
    walk = 2.0 * params.detour_factor * d / params.walk_speed_mps
    return params.dispatch_delay_s + walk + inst.site_floor_delay[None, :]
