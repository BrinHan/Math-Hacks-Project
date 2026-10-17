// TypeScript mirror of aed/params.py. Times in seconds except survivalKPerMin (per minute).

export interface Params {
  incidencePer100kYr: number;
  publicFraction: number;
  walkSpeedMps: number;
  detourFactor: number;
  dispatchDelayS: number;
  emsResponseS: number;
  survivalS0: number;
  survivalKPerMin: number;
  survivalForm: "exp" | "linear";
  bandEdgesS: number[];
  maxTauS: number;
}

export const DEFAULT_PARAMS: Readonly<Params> = Object.freeze({
  incidencePer100kYr: 55,
  publicFraction: 0.18,
  walkSpeedMps: 1.4,
  detourFactor: 1.3,
  dispatchDelayS: 60,
  emsResponseS: 540,
  survivalS0: 0.7,
  survivalKPerMin: 0.1,
  survivalForm: "exp",
  bandEdgesS: Array.from({ length: 10 }, (_, k) => 60 * (k + 1)),
  maxTauS: 600,
});

export const CITATIONS: Record<keyof Params, string> = {
  incidencePer100kYr: "ASSUMPTION: ~50-60 OHCA per 100k per year (brief); needs an epidemiology source.",
  publicFraction: "ASSUMPTION: ~15-20% of OHCA occur in public locations; needs a registry source.",
  walkSpeedMps: "ASSUMPTION: brisk walk / jog while fetching an AED, 1.2-2.0 m/s.",
  detourFactor: "ASSUMPTION: network distance ~1.3x Euclidean on a campus.",
  dispatchDelayS: "ASSUMPTION: time from collapse until a bystander sets off for the AED.",
  emsResponseS: "ASSUMPTION: ambulance arrival-to-shock ~9 min (range 7-12).",
  survivalS0: "ASSUMPTION: survival if shocked immediately after collapse.",
  survivalKPerMin: "ASSUMPTION: ~7-10%/min decline without CPR, 3-4%/min with bystander CPR (brief).",
  survivalForm: "ASSUMPTION: exponential decay; linear offered as a sensitivity check.",
  bandEdgesS: "ASSUMPTION: 1-minute time bands up to 10 minutes.",
  maxTauS: "ASSUMPTION: an AED more than 10 minutes away is treated as unreachable.",
};
