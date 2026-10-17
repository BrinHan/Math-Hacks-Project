import numpy as np

from experiments import york_validation


def test_door_step_uses_distinct_doors(monkeypatch):
    seen = {}
    real = york_validation.evaluate

    def spy(cov, x):
        seen.setdefault("sizes", []).append(int(np.asarray(x).sum()))
        return real(cov, x)

    monkeypatch.setattr(york_validation, "evaluate", spy)
    r = york_validation._steps(york_validation.Params(), {}, None)
    assert seen["sizes"][:2] == [19, 19]        # published, then the same 19 at their doors
    assert r["best"] >= r["published_at_door"] - 1e-9
