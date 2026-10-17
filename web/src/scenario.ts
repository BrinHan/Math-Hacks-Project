// One cached (instance, travel times, coverage) per (dataset, ambulance response), shared by UI and worker.
import { buildCoverage, Coverage, travelTimeMatrix } from "./model/coverage";
import { generateInstance, Instance } from "./model/instance";
import { DEFAULT_PARAMS, Params } from "./model/params";

/**
 * "lead" = the team's exported campus (public/data/lead.json); "synthetic" = the app's random grid;
 * "custom" = uploaded or drawn locations, identified by an edit version so stale caches are dropped.
 */
export type Source = { kind: "lead" } | { kind: "synthetic"; seed: number } | { kind: "custom"; version: number };
export interface Scenario { params: Params; inst: Instance; tau: Float64Array; cov: Coverage }

let leadInst: Instance | null = null;
export function setLeadInstance(inst: Instance) { leadInst = inst; cached = null; }

let customInst: { version: number; inst: Instance } | null = null;
export function setCustomInstance(inst: Instance, version: number) { customInst = { version, inst }; }
export function customVersion() { return customInst?.version ?? -1; }

export const sourceKey = (s: Source) =>
  s.kind === "lead" ? "lead" : s.kind === "synthetic" ? `seed${s.seed}` : `custom${s.version}`;
let cached: { key: string; value: Scenario } | null = null;

export function scenario(source: Source, emsResponseS: number): Scenario {
  const key = `${sourceKey(source)}:${emsResponseS}`;
  if (cached?.key !== key) {
    const params: Params = { ...DEFAULT_PARAMS, emsResponseS };
    let inst: Instance;
    if (source.kind === "lead") {
      if (!leadInst) throw new Error("lead dataset not loaded");
      inst = leadInst;
    } else if (source.kind === "custom") {
      if (!customInst || customInst.version !== source.version) throw new Error("custom dataset not loaded");
      inst = customInst.inst;
    } else {
      inst = generateInstance(source.seed, {}, params);
    }
    const tau = travelTimeMatrix(inst, params);
    cached = { key, value: { params, inst, tau, cov: buildCoverage(inst, tau, params) } };
  }
  return cached.value;
}
