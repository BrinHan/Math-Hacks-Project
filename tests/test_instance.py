import dataclasses

import numpy as np
import pytest

from aed.data.synthetic import generate_instance
from aed.instance import metres_to_latlon

SMALL = dict(grid_n=6, n_sites=10, n_existing=1)


def test_validate_rejects_bad_shape():
    inst = generate_instance(seed=0, **SMALL)
    bad = dataclasses.replace(inst, site_cost=inst.site_cost[:-1])
    with pytest.raises(ValueError, match="site_cost"):
        bad.validate()


def test_validate_rejects_negative_cost():
    inst = generate_instance(seed=0, **SMALL)
    inst.site_cost[0] = -1.0
    with pytest.raises(ValueError, match="negative"):
        inst.validate()
