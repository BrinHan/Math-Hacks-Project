// One cached (instance, travel times, coverage) per (dataset, ambulance response), shared by UI and worker.
import { buildCoverage, Coverage, travelTimeMatrix } from "./model/coverage";
import { generateInstance, Instance } from "./model/instance";
import { DEFAULT_PARAMS, Params } from "./model/params";

/** "lead" = the lead's exported campus (public/data/lead.json); otherwise a synthetic seed. */
export type Source = { kind: "lead" } | { kind: "synthetic"; seed: number };
export interface Scenario { params: Params; inst: Instance; tau: Float64Array; cov: Coverage }

let leadInst: Instance | null = null;
export function setLeadInstance(inst: Instance) { leadInst = inst; cached = null; }

const sourceKey = (s: Source) => (s.kind === "lead" ? "lead" : `seed${s.seed}`);
let cached: { key: string; value: Scenario } | null = null;

export function scenario(source: Source, emsResponseS: number): Scenario {
  const key = `${sourceKey(source)}:${emsResponseS}`;
  if (cached?.key !== key) {
    const params: Params = { ...DEFAULT_PARAMS, emsResponseS };
    let inst: Instance;
    if (source.kind === "lead") {
      if (!leadInst) throw new Error("lead dataset not loaded");
      inst = leadInst;
    } else {
      inst = generateInstance(source.seed, {}, params);
    }
    const tau = travelTimeMatrix(inst, params);
    cached = { key, value: { params, inst, tau, cov: buildCoverage(inst, tau, params) } };
  }
  return cached.value;
}
