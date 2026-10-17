// TypeScript mirror of aed/params.py. Times in seconds except survivalKPerMin (per minute).

export interface Params {
  incidencePer100kYr: number;
  publicFraction: number;
  awayTimeShare: number;
  walkSpeedMps: number;
  detourFactor: number;
  dispatchDelayS: number;
  emsResponseS: number;
  survivalS0: number;
  survivalKPerMin: number;
  shockableFraction: number;
  survivalForm: "exp" | "linear";
  bandEdgesS: number[];
  maxTauS: number;
}

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  incidencePer100kYr: 55,
  publicFraction: 0.18,
  awayTimeShare: 0.313,
  walkSpeedMps: 1.4,
  detourFactor: 1.3,
  dispatchDelayS: 60,
  emsResponseS: 540,
  survivalS0: 0.7,
  survivalKPerMin: 0.1,
  shockableFraction: 0.265,
  survivalForm: "exp",
  bandEdgesS: Array.from({ length: 10 }, (_, k) => 60 * (k + 1)),
  maxTauS: 600,
});

// Short forms of aed/params.py CITATIONS (full references and links are in docs/sources.md).
export const CITATIONS: Record<keyof Params, string> = {
  incidencePer100kYr: "Berdowski et al. 2010 (Resuscitation): 54.6 per 100k in North America; Nichol et al. 2008 (JAMA): median 52.1.",
  publicFraction: "CARES 2013-2025 summary: 17.8% of non-traumatic OHCA in a public setting.",
  awayTimeShare: "Klepeis et al. 2001 (NHAPS): 31.3% of time away from home; public_fraction / away_time_share is the hazard for people in public.",
  walkSpeedMps: "Bohannon 1997: comfortable 1.27-1.46 m/s; Deakin et al. 2018 modelled retrieval at about 1.79 m/s.",
  detourFactor: "Boeing 2019: mean walking-route circuity 1.27 over 40 US cities.",
  dispatchDelayS: "ASSUMPTION: 30-120 s from collapse until a bystander sets off; no published measurement verified.",
  emsResponseS: "CARES 2025: median EMS response 7.6 min; Mell et al. 2017 (JAMA Surg): 7 min; Valenzuela et al. 2000: about 9.8 min.",
  survivalS0: "Valenzuela et al. 2000 (NEJM): 74% survival with a shock within 3 min; Larsen et al. 1993: 67% baseline.",
  survivalKPerMin: "Larsen et al. 1993: about 8% of baseline per minute; CARES 2025: 7-10% per minute without CPR or defibrillation.",
  shockableFraction: "Fordyce et al. 2017 (JAMA Cardiol): 26.5% of public arrests have a shockable rhythm; Weisfeldt et al. 2011 (NEJM): 38-60%.",
  survivalForm: "ASSUMPTION: exponential decay; linear offered as a sensitivity check.",
  bandEdgesS: "ASSUMPTION: 1-minute time bands up to 10 minutes.",
  maxTauS: "ASSUMPTION: an AED more than 10 minutes away is treated as unreachable.",
};
