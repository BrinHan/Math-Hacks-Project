import dataclasses

from aed.params import CITATIONS, RANGES, Params


def test_params_have_ranges_and_citations():
    p = Params()
    for f in dataclasses.fields(p):
        assert f.name in CITATIONS
    for name, (lo, hi) in RANGES.items():
        assert lo <= getattr(p, name) <= hi


def test_band_edges_default():
    assert Params().band_edges_s == tuple(float(s) for s in range(60, 601, 60))
