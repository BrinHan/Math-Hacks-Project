import csv

import numpy as np
import pytest

from aed.instance import metres_to_latlon
from aed.params import RANGES
from experiments import make_mock_results

HEADERS = {
    "k_curve.csv": "K,ilp_lives,greedy_lives,swap_lives,pop_lives,existing_lives,gap_pct,ilp_time_s",
    "mc_kcurve.csv": "K,mean,p5,p95",
    "site_freq.csv": "site_id,x_m,y_m,lat,lon,kind,existing,freq",
    "oat.csv": "param,low_value,high_value,lives_at_low,lives_at_high,base_lives",
}


def read_rows(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def test_mock_files_have_contract_headers(tmp_path):
    make_mock_results.main(out_dir=tmp_path)
    for name, header in HEADERS.items():
        with open(tmp_path / name, newline="") as f:
            assert f.readline().strip() == header
    k = read_rows(tmp_path / "k_curve.csv")
    assert len(k) == 31
    ilp = [float(r["ilp_lives"]) for r in k]
    assert all(b >= a for a, b in zip(ilp, ilp[1:]))
    for r in read_rows(tmp_path / "mc_kcurve.csv"):
        assert float(r["p5"]) <= float(r["mean"]) <= float(r["p95"])


def test_metres_to_latlon_origin():
    assert np.allclose(metres_to_latlon(np.zeros((1, 2)), (43.0, -80.0)), [[43.0, -80.0]])
    north = metres_to_latlon(np.array([[0.0, 111_320.0]]), (43.0, -80.0))
    assert north[0, 0] == pytest.approx(44.0)


def test_mock_oat_matches_ranges():
    rows = read_rows("results/mock/oat.csv")
    assert {r["param"] for r in rows} == set(RANGES)
    for r in rows:
        assert (float(r["low_value"]), float(r["high_value"])) == RANGES[r["param"]]
