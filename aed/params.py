"""Model parameters: one base value, a (low, high) range and a citation each.

Times are in seconds except survival_k_per_min, which is a per-minute rate.
Citations prefixed "ASSUMPTION:" have no verified source; see docs/sources.md.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Params:
    incidence_per_100k_yr: float = 55.0
    public_fraction: float = 0.18
    away_time_share: float = 0.313
    walk_speed_mps: float = 1.4
    detour_factor: float = 1.3
    dispatch_delay_s: float = 60.0
    ems_response_s: float = 540.0
    survival_S0: float = 0.7
    survival_k_per_min: float = 0.10
    shockable_fraction: float = 0.265
    survival_form: str = "exp"
    band_edges_s: tuple[float, ...] = tuple(float(s) for s in range(60, 601, 60))
    max_tau_s: float = 600.0

    def __post_init__(self):
        if self.survival_form not in ("exp", "linear"):
            raise ValueError(f"survival_form must be 'exp' or 'linear', got {self.survival_form!r}")
        edges = self.band_edges_s
        if not edges or any(b <= a for a, b in zip(edges, edges[1:])):
            raise ValueError("band_edges_s must be non-empty and strictly increasing")
        if not 0.0 < self.away_time_share <= 1.0:
            raise ValueError("away_time_share must be in (0, 1]")
        if not 0.0 <= self.shockable_fraction <= 1.0:
            raise ValueError("shockable_fraction must be in [0, 1]")
        if self.max_tau_s <= 0:
            raise ValueError("max_tau_s must be positive")


RANGES: dict[str, tuple[float, float]] = {
    "incidence_per_100k_yr": (40.0, 70.0),
    "public_fraction": (0.12, 0.25),
    "walk_speed_mps": (1.2, 2.0),
    "detour_factor": (1.2, 1.5),
    "dispatch_delay_s": (30.0, 120.0),
    "ems_response_s": (420.0, 720.0),
    "survival_S0": (0.5, 0.8),
    "survival_k_per_min": (0.03, 0.12),
    "shockable_fraction": (0.20, 0.38),
}

_E = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query="
_CARES = "https://mycares.net/sitepages/uploads/2026/"

CITATIONS: dict[str, str] = {
    "incidence_per_100k_yr": (
        f"Berdowski et al. (2010), Global incidences of OHCA and survival rates: systematic review of 67 prospective studies, Resuscitation 81(11):1479-1487. "
        f"{_E}%22Global%20incidences%20of%20out-of-hospital%20cardiac%20arrest%20and%20survival%20rates%22&resultType=core&format=json: "
        f"treated-OHCA incidence per 100k person-years 54.6 North America, 44.0 Australia, 35.0 Europe, 28.3 Asia; 62.3 adult-only studies. | "
        f"Nichol et al. (2008), Regional variation in OHCA incidence and outcome, JAMA 300(12):1423-1431. "
        f"{_E}TITLE%3A%22Regional%20variation%20in%20out-of-hospital%20cardiac%20arrest%20incidence%20and%20outcome%22&resultType=core&format=json: "
        f"EMS-treated incidence median 52.1 per 100k (IQR 48.0-70.1) across 10 North American sites."
    ),
    "public_fraction": (
        f"CARES (2026), CARES Summary Report 2013-2025, non-traumatic OHCA, N=1,269,409, Cardiac Arrest Registry to Enhance Survival. "
        f"{_CARES}CARES%202013-2025%20Non-Traumatic%20National%20Summary%20Report.pdf: "
        f"public setting 17.8% (225,927), home/residence 71.6%, nursing home 10.6%. | "
        f"Chan et al. (2014), Recent trends in survival from OHCA in the United States, Circulation 130(21):1876-1882. "
        f"https://pmc.ncbi.nlm.nih.gov/articles/PMC4276415/: 2005-2012 CARES, about 12% other public areas plus under 2% public areas with likely AED access."
    ),
    "walk_speed_mps": (
        f"Bohannon (1997), Comfortable and maximum walking speed of adults aged 20-79 years, Age and Ageing 26(1):15-19. "
        f"{_E}%22Comfortable%20and%20maximum%20walking%20speed%20of%20adults%20aged%2020-79%20years%22&resultType=core&format=json: "
        f"mean comfortable 1.27-1.46 m/s, mean maximum 1.75-2.53 m/s (n=230). | "
        f"Deakin et al. (2018), Underutilisation of public access defibrillation is related to retrieval distance, Heart 104(16):1339-1343. "
        f"{_E}TITLE%3A%22Underutilisation%20of%20public%20access%20defibrillation%20is%20related%20to%20retrieval%20distance%22&resultType=core&format=json: "
        f"bystander retrieval modelled at brisk walking speed of 4 mph (about 1.79 m/s)."
    ),
    "detour_factor": (
        f"Boeing (2019), The morphology and circuity of walkable and drivable street networks, in The Mathematics of Urban Morphology (Birkhauser). "
        f"https://arxiv.org/pdf/1708.00836: Table 1, mean walking-route circuity (network/great-circle distance) over 40 US cities "
        f"averages 1.27 (range 1.14 Manhattan to 1.49 Salem MA; mean computed from the table)."
    ),
    "dispatch_delay_s": (
        "ASSUMPTION: 30-120 s from collapse until a bystander sets off for the AED (recognition and decision delay); "
        "no published measurement of this interval was verified. See docs/sources.md."
    ),
    "ems_response_s": (
        f"CARES (2026), CARES 2025 annual report, Cardiac Arrest Registry to Enhance Survival. "
        f"{_CARES}2025_flipbook/inc/html/page49.html: median EMS response time 7.6 min (IQR 5.6-10.4), 911 call to arrival. | "
        f"Mell et al. (2017), EMS response times in rural, suburban, and urban areas, JAMA Surgery 152(10):983-984. "
        f"https://pmc.ncbi.nlm.nih.gov/articles/PMC5831456: median 911-to-arrival 7 min overall, 6 urban (IQR 4-9), 13 rural (IQR 8-19). | "
        f"Valenzuela et al. (2000), Outcomes of rapid defibrillation by security officers after cardiac arrest in casinos, N Engl J Med 343(17):1206-1209. "
        f"{_E}EXT_ID:11071670%20AND%20SRC:MED&resultType=core&format=json: "
        f"paramedics arrived a mean of about 9.8 min after witnessed collapse."
    ),
    "survival_S0": (
        f"Valenzuela et al. (2000), Outcomes of rapid defibrillation by security officers after cardiac arrest in casinos, N Engl J Med 343(17):1206-1209. "
        f"{_E}EXT_ID:11071670%20AND%20SRC:MED&resultType=core&format=json: "
        f"survival to discharge 74% when first shock within 3 min of witnessed collapse, 49% when later. | "
        f"Larsen et al. (1993), Predicting survival from OHCA: a graphic model, Ann Emerg Med 22(11):1652-1658. "
        f"{_E}EXT_ID:8214853%20AND%20SRC:MED&resultType=core&format=json: baseline survival 67% if CPR, defibrillation and ACLS all immediate."
    ),
    "survival_k_per_min": (
        f"Larsen et al. (1993), Predicting survival from OHCA: a graphic model, Ann Emerg Med 22(11):1652-1658. "
        f"{_E}EXT_ID:8214853%20AND%20SRC:MED&resultType=core&format=json: "
        f"from a 67% baseline, survival falls 2.3 points/min of delay to CPR, 1.1 to defibrillation, 2.1 to ACLS (sum 5.5 points/min, about 8% of baseline per min). | "
        f"Waalewijn et al. (2001), Survival models for OHCA from the perspectives of the bystander, first responder and paramedic, Resuscitation 51(2):113-122. "
        f"{_E}TITLE%3A%22Survival%20models%20for%20out-of-hospital%20cardiopulmonary%20resuscitation%20from%20the%20perspectives%22&resultType=core&format=json: "
        f"odds ratio of survival per minute of delay to defibrillation 0.89 (first-responder model) and 0.85 (paramedic model). | "
        f"CARES (2026), CARES 2025 annual report. {_CARES}2025_flipbook/inc/html/page49.html: "
        f"states survival falls 7-10% per minute without CPR or defibrillation. The 3-4%/min figure with bystander CPR "
        f"(AHA guidelines) could not be opened and is not verified; the low end 0.03 is a judgement."
    ),
    "shockable_fraction": (
        "Weisfeldt et al. (2011), Ventricular tachyarrhythmias after cardiac arrest in public versus at home, "
        "N Engl J Med 364(4):313-321. "
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE%3A%22Ventricular%20tachyarrhythmias%20after%20cardiac%20arrest%20in%20public%20versus%20at%20home%22&resultType=core&format=json"
        ": initial VF/pVT in public arrests 38% (EMS-witnessed) to 60% (bystander-witnessed); "
        "Fordyce et al. (2017), JAMA Cardiol 2(11):1226-1235. https://pmc.ncbi.nlm.nih.gov/articles/PMC5710360"
        ": 26.5% of all public arrests. Base 0.265 = Fordyce's all-public figure, matching demand that counts every public arrest; range 0.20-0.38 (judgement: 21% home figure to 38% EMS-witnessed public)."
    ),
    "away_time_share": (
        "Klepeis et al. (2001), National Human Activity Pattern Survey (NHAPS), "
        "J Expo Anal Environ Epidemiol 11(3):231-252. "
        "https://eta-publications.lbl.gov/sites/default/files/lbnl-47713.pdf"
        ": 68.7% of time in a residence, so 31.3% away from home; public_fraction / away_time_share "
        "is the arrest hazard for people present in public relative to the population average."
    ),
    "survival_form": "ASSUMPTION: exponential decay; linear offered as a sensitivity check.",
    "band_edges_s": "ASSUMPTION: 1-minute time bands up to 10 minutes.",
    "max_tau_s": "ASSUMPTION: an AED more than 10 minutes away is treated as unreachable.",
}


def param_table(p: Params | None = None) -> list[dict]:
    """One row per parameter: name, base value, (low, high) range if varied, citation."""
    p = p or Params()
    rows = []
    for name, citation in CITATIONS.items():
        lo, hi = RANGES.get(name, (None, None))
        rows.append({"name": name, "base": getattr(p, name), "low": lo, "high": hi,
                     "citation": citation})
    return rows


__all__ = ["Params", "RANGES", "CITATIONS", "param_table"]
