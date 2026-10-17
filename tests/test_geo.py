import numpy as np

from aed.geo import latlon_to_xy
from aed.instance import metres_to_latlon


def test_latlon_round_trip():
    origin = (43.767, -79.517)
    xy = np.array([[0.0, 0.0], [1500.0, 800.0], [2200.0, 1400.0]])
    ll = metres_to_latlon(xy, origin)
    assert np.allclose(latlon_to_xy(ll[:, 0], ll[:, 1], origin), xy, atol=1e-6)
