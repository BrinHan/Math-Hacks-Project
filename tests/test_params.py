import pytest

from aed.params import Params


def test_unknown_survival_form_rejected():
    with pytest.raises(ValueError):
        Params(survival_form="cubic")


def test_band_edges_must_increase():
    with pytest.raises(ValueError):
        Params(band_edges_s=(120.0, 60.0))
