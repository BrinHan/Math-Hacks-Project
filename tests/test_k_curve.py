import csv

from experiments import k_curve

HEADER = "K,ilp_lives,greedy_lives,swap_lives,pop_lives,existing_lives,gap_pct,ilp_time_s"


def test_k_curve_small(tmp_path):
    k_curve.main(seed=0, kmax=4, out=tmp_path, grid_n=12, n_sites=40, n_existing=2)
    path = tmp_path / "k_curve.csv"
    assert path.read_text().splitlines()[0] == HEADER
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    assert [int(r["K"]) for r in rows] == [0, 1, 2, 3, 4]
    for r in rows:
        assert float(r["greedy_lives"]) <= float(r["swap_lives"]) + 1e-9 <= float(r["ilp_lives"]) + 2e-9
        assert float(r["existing_lives"]) <= float(r["ilp_lives"]) + 1e-9


def test_k_curve_placements(tmp_path):
    import json
    k_curve.main(seed=0, kmax=2, out=tmp_path, verbose=False, grid_n=8, n_sites=20, n_existing=1)
    placements = json.loads((tmp_path / "placements.json").read_text())
    assert set(placements) == {"0", "1", "2"} and placements["0"] == []
