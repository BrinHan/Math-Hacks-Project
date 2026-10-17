"""Local metre coordinates <-> latitude/longitude (equirectangular, fine at campus scale)."""
import numpy as np

from aed.instance import M_PER_DEG_LAT


def latlon_to_xy(lat, lon, origin_latlon: tuple[float, float]) -> np.ndarray:
    """(N,) lat and lon in degrees -> (N, 2) metres east and north of origin_latlon."""
    lat0, lon0 = origin_latlon
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    x = (lon - lon0) * M_PER_DEG_LAT * np.cos(np.radians(lat0))
    y = (lat - lat0) * M_PER_DEG_LAT
    return np.column_stack([x, y])
