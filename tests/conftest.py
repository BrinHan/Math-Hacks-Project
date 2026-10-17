import pytest

from aed.data.synthetic import generate_instance


@pytest.fixture
def tiny_instance():
    # Unit costs so brute force over size-K subsets matches the budget constraint.
    return generate_instance(seed=1, extent_m=600, grid_n=5, n_buildings=4, n_sites=8,
                             n_existing=0, outdoor_cost=1.0)
