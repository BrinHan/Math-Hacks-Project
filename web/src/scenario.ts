// One cached (instance, travel times, coverage) per (seed, ambulance response), shared by UI and worker.
import { buildCoverage, Coverage, travelTimeMatrix } from "./model/coverage";
import { generateInstance, Instance } from "./model/instance";
import { DEFAULT_PARAMS, Params } from "./model/params";

export interface Scenario { params: Params; inst: Instance; tau: Float64Array; cov: Coverage }

let cached: { key: string; value: Scenario } | null = null;

export function scenario(seed: number, emsResponseS: number): Scenario {
  const key = `${seed}:${emsResponseS}`;
  if (cached?.key !== key) {
    const params: Params = { ...DEFAULT_PARAMS, emsResponseS };
    const inst = generateInstance(seed, {}, params);
    const tau = travelTimeMatrix(inst, params);
    cached = { key, value: { params, inst, tau, cov: buildCoverage(inst, tau, params) } };
  }
  return cached.value;
}
