"""One call from seed to solver-ready coverage."""
from aed.coverage import Coverage, build_coverage
from aed.data.synthetic import generate_instance
from aed.instance import Instance
from aed.params import Params
from aed.travel import travel_time_matrix


def build(seed: int = 0, params: Params | None = None, **gen_kwargs) -> tuple[Instance, Coverage]:
    params = params or Params()
    inst = generate_instance(seed=seed, params=params, **gen_kwargs)
    return inst, build_coverage(inst, travel_time_matrix(inst, params), params)
