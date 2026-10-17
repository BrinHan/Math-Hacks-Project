"""One call from seed (or campus name) to solver-ready coverage."""
from aed.coverage import Coverage, build_coverage
from aed.data.synthetic import generate_instance
from aed.instance import Instance
from aed.params import Params
from aed.travel import travel_time_matrix

CAMPUSES = ("synthetic", "york")


def make_instance(seed: int = 0, params: Params | None = None, campus: str = "synthetic",
                  **gen_kwargs) -> Instance:
    """campus="york" loads the real Keele campus (seed and gen_kwargs are ignored)."""
    if campus == "york":
        from aed.data.york import load_york
        return load_york(params)
    if campus != "synthetic":
        raise ValueError(f"campus must be one of {CAMPUSES}, got {campus!r}")
    return generate_instance(seed=seed, params=params, **gen_kwargs)


def build(seed: int = 0, params: Params | None = None, campus: str = "synthetic",
          **gen_kwargs) -> tuple[Instance, Coverage]:
    params = params or Params()
    inst = make_instance(seed, params, campus, **gen_kwargs)
    return inst, build_coverage(inst, travel_time_matrix(inst, params), params)
