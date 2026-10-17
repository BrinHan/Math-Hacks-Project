import pytest

from aed.params import RANGES, Params, param_table


def test_unknown_survival_form_rejected():
    with pytest.raises(ValueError):
        Params(survival_form="cubic")


def test_band_edges_must_increase():
    with pytest.raises(ValueError):
        Params(band_edges_s=(120.0, 60.0))


def test_param_table_complete():
    rows = {r["name"]: r for r in param_table()}
    assert set(rows) == set(Params.__dataclass_fields__)
    for name, (lo, hi) in RANGES.items():
        assert (rows[name]["low"], rows[name]["high"]) == (lo, hi)


@pytest.mark.parametrize("f", [1.5, -0.1, float("nan")])
def test_shockable_fraction_validated(f):
    with pytest.raises(ValueError):
        Params(shockable_fraction=f)
