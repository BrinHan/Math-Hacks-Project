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


def test_validate_rejects_bad_period_hours():
    inst = generate_instance(seed=0, **SMALL)
    inst.period_hours = np.array([10.0, 6.0, 7.0])
    with pytest.raises(ValueError, match="24"):
        inst.validate()


def test_validate_rejects_non_bool_open():
    inst = generate_instance(seed=0, **SMALL)
    inst.site_open = inst.site_open.astype(int)
    with pytest.raises(ValueError, match="bool"):
        inst.validate()


def test_summary_mentions_counts():
    text = generate_instance(seed=0, **SMALL).summary()
    assert "36 cells" in text and "10 sites (1 existing)" in text and "arrests/yr" in text
