import pytest

from aed.params import Params


def test_unknown_survival_form_rejected():
    with pytest.raises(ValueError):
        Params(survival_form="cubic")
