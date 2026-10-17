"""Model parameters: one base value, a (low, high) range and a citation each.

Times are in seconds except survival_k_per_min, which is a per-minute rate.
Citations prefixed "ASSUMPTION:" have no source yet (Teammate 2 replaces them).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Params:
    incidence_per_100k_yr: float = 55.0
    public_fraction: float = 0.18
    walk_speed_mps: float = 1.4
    detour_factor: float = 1.3
    dispatch_delay_s: float = 60.0
    ems_response_s: float = 540.0
    survival_S0: float = 0.7
    survival_k_per_min: float = 0.10
    survival_form: str = "exp"
    band_edges_s: tuple[float, ...] = tuple(float(s) for s in range(60, 601, 60))
    max_tau_s: float = 600.0


RANGES: dict[str, tuple[float, float]] = {
    "incidence_per_100k_yr": (40.0, 70.0),
    "public_fraction": (0.12, 0.25),
    "walk_speed_mps": (1.2, 2.0),
    "detour_factor": (1.2, 1.5),
    "dispatch_delay_s": (30.0, 120.0),
    "ems_response_s": (420.0, 720.0),
    "survival_S0": (0.5, 0.8),
    "survival_k_per_min": (0.03, 0.10),
}

CITATIONS: dict[str, str] = {
    "incidence_per_100k_yr": "ASSUMPTION: ~50-60 OHCA per 100k per year (brief); needs an epidemiology source.",
    "public_fraction": "ASSUMPTION: ~15-20% of OHCA occur in public locations; needs a registry source.",
    "walk_speed_mps": "ASSUMPTION: brisk walk / jog while fetching an AED, 1.2-2.0 m/s.",
    "detour_factor": "ASSUMPTION: network distance ~1.3x Euclidean on a campus.",
    "dispatch_delay_s": "ASSUMPTION: time from collapse until a bystander sets off for the AED.",
    "ems_response_s": "ASSUMPTION: ambulance arrival-to-shock ~9 min (range 7-12).",
    "survival_S0": "ASSUMPTION: survival if shocked immediately after collapse.",
    "survival_k_per_min": "ASSUMPTION: ~7-10%/min decline without CPR, 3-4%/min with bystander CPR (brief).",
    "survival_form": "ASSUMPTION: exponential decay; linear offered as a sensitivity check.",
    "band_edges_s": "ASSUMPTION: 1-minute time bands up to 10 minutes.",
    "max_tau_s": "ASSUMPTION: an AED more than 10 minutes away is treated as unreachable.",
}
