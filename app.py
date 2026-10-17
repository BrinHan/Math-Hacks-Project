"""Streamlit + folium demo of the AED placement optimizer (Teammate 3 / Plan 3).

Run from the repo root:  streamlit run app.py

One placement serves every period (spec section 5); the period selector only changes
which sites are unlocked and which cells are reached in time, it never re-optimizes.
"""
import dataclasses

import folium
import numpy as np
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

from aed.instance import metres_to_latlon
from aed.params import CITATIONS, Params
from aed.pipeline import build
from aed.solvers.common import evaluate, evaluate_by_period
from aed.solvers.greedy import solve_greedy
from aed.solvers.ilp import solve_ilp
from aed.travel import travel_time_matrix

SOLVERS = {"ILP (optimal)": solve_ilp, "Greedy": solve_greedy}
try:  # Task 8; shown only once it is merged
    from aed.solvers.swap import solve_swap
    SOLVERS["Swap (Teitz-Bart)"] = solve_swap
except ImportError:
    pass

# Fastest-AED time bands for the map, in seconds; the last band ends at ems_response_s.
BAND_COLOURS = [(120, "#1a9850", "≤ 2 min"), (240, "#91cf60", "2–4 min"),
                (360, "#fee08b", "4–6 min"), (np.inf, "#fc8d59", "6 min – EMS")]
UNREACHED = "#d73027"
SITE_COLOURS = {"existing": "#2b6cb0", "new": "#111111", "locked": "#a0aec0"}


@st.cache_resource(show_spinner="Building campus and coverage…")
def load(seed: int, params: Params):
    inst, cov = build(seed=seed, params=params)
    return inst, cov, travel_time_matrix(inst, params)


@st.cache_resource(show_spinner="Solving…")
def solve(seed: int, params: Params, method: str, budget: int):
    _, cov, _ = load(seed, params)
    return SOLVERS[method](cov, budget)


def fastest_time(tau: np.ndarray, usable: np.ndarray) -> np.ndarray:
    """Per-cell seconds to the fastest usable AED (inf if none)."""
    if not usable.any():
        return np.full(tau.shape[0], np.inf)
    return tau[:, usable].min(axis=1)


def band_colour(t: float, ems_s: float) -> str:
    if t >= ems_s:
        return UNREACHED
    return next(c for edge, c, _ in BAND_COLOURS if t <= edge)


def make_map(inst, tau, x, q, ems_s, show_candidates):
    cell_ll = metres_to_latlon(inst.cell_xy, inst.origin_latlon)
    site_ll = metres_to_latlon(inst.site_xy, inst.origin_latlon)
    centre = cell_ll.mean(axis=0)
    m = folium.Map(location=centre.tolist(), zoom_start=15, tiles="CartoDB positron")

    # Cells: colour = fastest AED band this period, opacity = arrest rate this period.
    xs = np.unique(inst.cell_xy[:, 0])
    half = (xs[1] - xs[0]) / 2 if xs.size > 1 else 50.0
    t = fastest_time(tau, x & inst.site_open[:, q])
    rate = inst.cell_rate[:, q]
    alpha = 0.15 + 0.55 * rate / rate.max() if rate.max() > 0 else np.full(rate.shape, 0.15)
    cells = folium.FeatureGroup(name="Cells (fastest AED)")
    for i in range(inst.n_cells):
        lo = metres_to_latlon(inst.cell_xy[i:i + 1] - half, inst.origin_latlon)[0]
        hi = metres_to_latlon(inst.cell_xy[i:i + 1] + half, inst.origin_latlon)[0]
        tip = (f"{'unreached' if not np.isfinite(t[i]) else f'{t[i] / 60:.1f} min'}"
               f" · {rate[i]:.4f} arrests/yr")
        folium.Rectangle([lo.tolist(), hi.tolist()], weight=0, fill=True,
                         fill_color=band_colour(t[i], ems_s), fill_opacity=float(alpha[i]),
                         tooltip=tip).add_to(cells)
    cells.add_to(m)

    sites = folium.FeatureGroup(name="AED sites")
    for j in range(inst.n_sites):
        open_now = bool(inst.site_open[j, q])
        if x[j]:
            role = "existing" if inst.site_existing[j] else "new"
            colour = SITE_COLOURS[role] if open_now else SITE_COLOURS["locked"]
            label = f"{role} AED · {inst.site_kind[j]}" + ("" if open_now else " · LOCKED")
            folium.CircleMarker(site_ll[j].tolist(), radius=7, color="white", weight=2,
                                fill=True, fill_color=colour, fill_opacity=1.0,
                                tooltip=f"#{j} {label}").add_to(sites)
        elif show_candidates:
            folium.CircleMarker(site_ll[j].tolist(), radius=2, color="#718096", weight=0,
                                fill=True, fill_opacity=0.6 if open_now else 0.2,
                                tooltip=f"#{j} candidate · {inst.site_kind[j]}").add_to(sites)
    sites.add_to(m)
    folium.LayerControl(collapsed=True).add_to(m)
    return m


def main():
    st.set_page_config(page_title="AED Placement Optimizer", layout="wide")
    st.title("Spatio-temporal AED placement")
    st.caption("Expected out-of-hospital cardiac arrest survivors per year, "
               "compared with waiting for the ambulance. Synthetic campus.")

    with st.sidebar:
        st.header("Scenario")
        seed = st.number_input("Campus seed", 0, 999, 0, step=1)
        budget = st.slider("Budget K (new AEDs)", 0, 30, 10)
        method = st.radio("Solver", list(SOLVERS))
        ems_min = st.slider("Ambulance response (min)", 7.0, 12.0,
                            Params().ems_response_s / 60, step=0.5)
        st.header("View")
        show_candidates = st.checkbox("Show candidate sites", value=False)

    params = dataclasses.replace(Params(), ems_response_s=ems_min * 60)
    inst, cov, tau = load(int(seed), params)
    sol = solve(int(seed), params, method, budget)

    with st.sidebar:
        period = st.radio("Time of day", inst.periods, horizontal=True,
                          format_func=lambda p: p.capitalize())
    q = inst.periods.index(period)

    existing_lives = evaluate(cov, cov.site_existing)
    by_period = evaluate_by_period(cov, sol.x)
    n_new = int((sol.x & ~cov.site_existing).sum())
    locked = int((sol.x & ~inst.site_open[:, q]).sum())

    c = st.columns(4)
    c[0].metric("Lives saved / yr", f"{sol.lives:.3f}",
                f"{sol.lives - existing_lives:+.3f} vs existing AEDs only")
    c[1].metric("AEDs placed", f"{n_new} new", f"{int(cov.site_existing.sum())} existing",
                delta_color="off")
    c[2].metric(f"{period.capitalize()} share", f"{by_period[q]:.3f}",
                f"{locked} AEDs locked now", delta_color="inverse" if locked else "off")
    c[3].metric("Solve time", f"{sol.runtime_s:.2f} s",
                f"MIP gap {sol.mip_gap:.2%}" if sol.mip_gap is not None else method,
                delta_color="off")

    left, right = st.columns([3, 1])
    with left:
        st_folium(make_map(inst, tau, sol.x, q, params.ems_response_s, show_candidates),
                  height=620, use_container_width=True, returned_objects=[])
        legend = " &nbsp; ".join(
            f"<span style='color:{col}'>■</span> {lab}" for _, col, lab in BAND_COLOURS)
        st.markdown(
            f"Fastest AED this period: {legend} &nbsp; <span style='color:{UNREACHED}'>■</span> "
            "not before EMS · darker cell = more arrests &nbsp;|&nbsp; "
            f"<span style='color:{SITE_COLOURS['existing']}'>●</span> existing "
            f"<span style='color:{SITE_COLOURS['new']}'>●</span> new "
            f"<span style='color:{SITE_COLOURS['locked']}'>●</span> locked this period",
            unsafe_allow_html=True)

    with right:
        st.subheader("Lives by period")
        st.bar_chart(pd.DataFrame({"lives/yr": by_period},
                                  index=[p.capitalize() for p in inst.periods]))
        st.subheader("New AED sites")
        new = np.flatnonzero(sol.x & ~cov.site_existing)
        ll = metres_to_latlon(inst.site_xy[new], inst.origin_latlon)
        st.dataframe(pd.DataFrame({
            "site": new,
            "kind": [inst.site_kind[j] for j in new],
            "open": ["/".join(p[0].upper() for p, o in zip(inst.periods, inst.site_open[j]) if o)
                     for j in new],
            "lat": ll[:, 0].round(5), "lon": ll[:, 1].round(5),
        }), hide_index=True, use_container_width=True)

    with st.expander("Assumptions and parameters"):
        st.dataframe(pd.DataFrame(
            [(f.name, getattr(params, f.name), CITATIONS.get(f.name, ""))
             for f in dataclasses.fields(params) if f.name != "band_edges_s"],
            columns=["parameter", "value", "source"]), hide_index=True,
            use_container_width=True)


if __name__ == "__main__":
    main()
