"""Pitch figures from results/york/ -> results/york/figures/.

Four figures: York map (published 19, best 19, coverage gaps), K-curve with the Monte Carlo
band against the population-only baseline, tornado chart, and the re-siting gain by scenario
(also written as scenarios.md). The map re-solves the base-case best 19 with the ILP.
Run: python experiments/pitch_figures.py
"""
import argparse
import csv
import dataclasses
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.patches import Patch, Polygon  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aed.coverage import build_coverage  # noqa: E402
from aed.data import york  # noqa: E402
from aed.data.york_tables import load_boundary, load_buildings, load_footprints  # noqa: E402
from aed.params import Params  # noqa: E402
from aed.solvers.ilp import solve_ilp  # noqa: E402
from aed.travel import travel_time_matrix  # noqa: E402

BLUE, ORANGE, GRAY = "#2a78d6", "#eb6834", "#898781"
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "font.size": 12, "axes.titlesize": 15, "axes.titleweight": "bold", "axes.titlelocation": "left",
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.spines.top": False, "axes.axisbelow": True, "axes.spines.right": False, "legend.frameon": False,
})

LABELS = {
    "public_fraction": "Share of arrests in public",
    "ems_response_s": "Ambulance response time",
    "shockable_fraction": "Shockable-rhythm share",
    "survival_k_per_min": "Survival decay rate",
    "incidence_per_100k_yr": "Arrest incidence",
    "survival_S0": "Survival if shocked at once",
    "dispatch_delay_s": "Bystander dispatch delay",
    "walk_speed_mps": "Walking speed",
    "detour_factor": "Path detour factor",
}


def _read_csv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [{k: (v if k == "param" else float(v)) for k, v in r.items()} for r in csv.DictReader(f)]


def york_map(res: Path, out: Path) -> None:
    p = Params()
    inst = york.load_york(p)
    published = inst.site_existing.copy()
    free = dataclasses.replace(inst, site_existing=np.zeros(inst.n_sites, dtype=bool),
                               site_cost=np.ones(inst.n_sites))
    sol = solve_ilp(build_coverage(free, travel_time_matrix(free, p), p), int(published.sum()))
    print(f"best {sol.x.sum()} sites: {sol.lives:.4f} lives/yr")
    best = sol.x

    gaps = {g["building"] for g in json.loads((res / "york_validation.json").read_text())["coverage_gaps"]}
    feet = load_footprints()
    fig, ax = plt.subplots(figsize=(10, 9))
    bnd = load_boundary()
    ax.add_patch(Polygon(bnd, closed=True, fill=False, ec=GRAY, lw=1, ls="--"))
    for b in load_buildings():
        poly = feet.get(b["osm_id"])
        if poly is None or b["kind"] == "ignore":
            continue
        gap = york._label(b) in gaps
        ax.add_patch(Polygon(poly, closed=True, fc="#f6c9b6" if gap else "#e4e3df",
                             ec=ORANGE if gap else "#c9c8c2", lw=1.2 if gap else 0.5,
                             hatch="///" if gap else None))
    xy = inst.site_xy
    ax.scatter(*xy[published].T, s=90, marker="o", fc=SURFACE, ec=ORANGE, lw=2.2, zorder=3,
               label=f"York's {published.sum()} published AEDs")
    ax.scatter(*xy[best].T, s=90, marker="^", c=BLUE, ec=SURFACE, lw=1.5, zorder=4,
               label=f"Model's best {best.sum()} sites")
    handles, _ = ax.get_legend_handles_labels()
    handles.append(Patch(fc="#f6c9b6", ec=ORANGE, hatch="///",
                         label="Gap: busy building >3 min walk from a published AED"))
    ax.legend(handles=handles, loc="upper left", fontsize=11)
    ax.set_xlim(bnd[:, 0].min() - 50, bnd[:, 0].max() + 50)
    ax.set_ylim(bnd[:, 1].min() - 50, bnd[:, 1].max() + 50)
    ax.set_aspect("equal")
    ax.grid(False)
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_title("York Keele: where the AEDs are vs. where the model puts them")
    fig.tight_layout()
    fig.savefig(out / "york_map.png", dpi=200)
    plt.close(fig)


def k_curve(res: Path, out: Path) -> None:
    kc = _read_csv(res / "k_curve.csv")
    mc = _read_csv(res / "mc_kcurve.csv")
    K = [r["K"] for r in kc]
    fig, ax = plt.subplots(figsize=(10, 6))
    ax.fill_between([r["K"] for r in mc], [r["p5"] for r in mc], [r["p95"] for r in mc],
                    color=BLUE, alpha=0.15, lw=0, label="Monte Carlo 90% band (ILP plan)")
    ax.plot(K, [r["ilp_lives"] for r in kc], color=BLUE, lw=2.5, label="Optimized (ILP)")
    ax.plot(K, [r["pop_lives"] for r in kc], color=ORANGE, lw=2.5, label="Population-only placement")
    ax.axhline(kc[0]["existing_lives"], color=GRAY, lw=1.2, ls="--")
    ax.text(30, kc[0]["existing_lives"], "York's 19 published AEDs today ", color=INK2,
            ha="right", va="bottom", fontsize=11)
    for k in (5, 10, 30):
        v = kc[k]["ilp_lives"]
        ax.plot(k, v, "o", ms=8, color=BLUE, mec=SURFACE, mew=2)
        ax.annotate(f"{v:.3f}", (k, v), xytext=(0, 10), textcoords="offset points", ha="center",
                    fontsize=11, color=INK)
    ax.set_xlim(0, 30)
    ax.set_ylim(0, None)
    ax.set_xlabel("New AEDs added on top of the 19 published (K)")
    ax.set_ylabel("Expected lives saved per year")
    ax.set_title("Adding AEDs: optimized vs. population-only")
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(out / "k_curve.png", dpi=200)
    plt.close(fig)


def tornado(res: Path, out: Path) -> None:
    rows = sorted(_read_csv(res / "oat.csv"), key=lambda r: abs(r["lives_at_high"] - r["lives_at_low"]))
    base = rows[0]["base_lives"]
    fig, ax = plt.subplots(figsize=(10, 6))
    y = np.arange(len(rows))
    for i, r in enumerate(rows):
        for val, side, color in ((r["lives_at_low"], "low_value", BLUE), (r["lives_at_high"], "high_value", ORANGE)):
            ax.barh(i, val - base, left=base, height=0.7, color=color, ec=SURFACE, lw=2)
            ax.text(val + (0.002 if val >= base else -0.002), i, _fmt(r["param"], r[side]),
                    ha="left" if val >= base else "right", va="center", fontsize=10, color=INK2)
    ax.axvline(base, color=INK, lw=1)
    ax.set_yticks(y, [LABELS.get(r["param"], r["param"]) for r in rows])
    ax.grid(axis="y", visible=False)
    lo = min(min(r["lives_at_low"], r["lives_at_high"]) for r in rows)
    hi = max(max(r["lives_at_low"], r["lives_at_high"]) for r in rows)
    ax.set_xlim(lo - 0.03, hi + 0.03)
    ax.set_xlabel(f"Expected lives saved per year at K = 10 (base {base:.3f})")
    ax.set_title("What moves the answer: one assumption at a time")
    ax.legend(handles=[Patch(color=BLUE, label="Assumption at low end"),
                       Patch(color=ORANGE, label="Assumption at high end")], loc="lower left")
    fig.tight_layout()
    fig.savefig(out / "tornado.png", dpi=200)
    plt.close(fig)


def _fmt(param: str, v: float) -> str:
    if param.endswith("_s"):
        return f"{v / 60:g} min" if v >= 120 else f"{v:g} s"
    if param.endswith("fraction"):
        return f"{v:.0%}"
    unit = {"walk_speed_mps": " m/s", "survival_k_per_min": "/min", "incidence_per_100k_yr": "/100k"}
    return f"{v:g}{unit.get(param, '')}"


def scenarios(res: Path, out: Path) -> None:
    table = json.loads((res / "york_validation.json").read_text())["scenarios"]
    rows = table[::-1]
    fig, ax = plt.subplots(figsize=(10, 5.5))
    for i, r in enumerate(rows):
        caveat = r["scenario"].startswith("footpaths only")
        color = GRAY if caveat else BLUE
        ax.barh(i, r["gain_vs_published_pct"], height=0.7, color=color, ec=SURFACE, lw=2,
                hatch="///" if caveat else None)
        ax.text(r["gain_vs_published_pct"] + 2, i, f"+{r['gain_vs_published_pct']:.0f}%",
                va="center", fontsize=11, fontweight="bold" if r["scenario"] == "base case" else None)
    ax.set_yticks(range(len(rows)), [r["scenario"].replace(", no shortcut", "\n(upper bound: tunnels unmapped)")
                                     for r in rows])
    ax.grid(axis="y", visible=False)
    ax.set_xlim(0, max(r["gain_vs_published_pct"] for r in rows) * 1.15)
    ax.set_xlabel("Best 19 sites: gain in expected lives saved over York's published 19 (%)")
    ax.set_title("Re-siting gain holds across scenarios")
    fig.tight_layout()
    fig.savefig(out / "scenarios.png", dpi=200)
    plt.close(fig)

    lines = ["| Scenario | Published 19 | At nearest door | Best 19 | Gain vs published | Gain vs door |",
             "|---|---|---|---|---|---|"]
    for r in table:
        lines.append(f"| {r['scenario']} | {r['published']:.3f} | {r['published_at_door']:.3f} | "
                     f"{r['best']:.3f} | +{r['gain_vs_published_pct']:.0f}% | +{r['gain_vs_door_pct']:.0f}% |")
    (out / "scenarios.md").write_text("Expected lives saved per year, York Keele.\n\n" + "\n".join(lines) + "\n")


def main(results: str = "results/york") -> None:
    res = Path(results)
    out = res / "figures"
    out.mkdir(parents=True, exist_ok=True)
    k_curve(res, out)
    tornado(res, out)
    scenarios(res, out)
    york_map(res, out)
    print("wrote", sorted(p.name for p in out.iterdir()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--results", default="results/york")
    main(ap.parse_args().results)
