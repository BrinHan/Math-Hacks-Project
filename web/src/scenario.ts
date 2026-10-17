// One cached (instance, travel times, coverage) per (dataset, ambulance response), shared by UI and worker.
import { buildCoverage, Coverage, travelTimeMatrix } from "./model/coverage";
import { generateInstance, Instance } from "./model/instance";
import { DEFAULT_PARAMS, Params } from "./model/params";

/**
 * "lead" = the team's exported campus (public/data/lead.json); "york" = York University's real buildings
 * (public/data/york-osm.json); "custom" = uploaded or drawn locations, identified by an edit version so
 * stale caches are dropped; "synthetic" = placeholder campus when the team export is missing.
 */
export type Source =
  | { kind: "lead" }
  | { kind: "york" }
  | { kind: "custom"; version: number }
  | { kind: "synthetic"; seed: number };
export interface Scenario { params: Params; inst: Instance; tau: Float64Array; cov: Coverage }

export const sourceKey = (s: Source) =>
  s.kind === "lead" ? "lead" : s.kind === "york" ? "york" : s.kind === "synthetic" ? `seed${s.seed}` : `custom${s.version}`;

// Instances supplied from outside (team export, York buildings, custom data), by source key.
const supplied = new Map<string, Instance>();
export function setInstance(source: Source, inst: Instance) {
  const key = sourceKey(source);
  if (source.kind === "custom") for (const k of supplied.keys()) if (k.startsWith("custom")) supplied.delete(k);
  supplied.set(key, inst);
  if (cached?.key.startsWith(`${key}:`)) cached = null;
}
export const hasInstance = (source: Source) => supplied.has(sourceKey(source));
export const setLeadInstance = (inst: Instance) => setInstance({ kind: "lead" }, inst);

let cached: { key: string; value: Scenario } | null = null;

export function scenario(source: Source, emsResponseS: number): Scenario {
  const key = `${sourceKey(source)}:${emsResponseS}`;
  if (cached?.key !== key) {
    const params: Params = { ...DEFAULT_PARAMS, emsResponseS };
    const inst = source.kind === "synthetic" ? generateInstance(source.seed, {}, params) : supplied.get(sourceKey(source));
    if (!inst) throw new Error(`${source.kind} dataset not loaded`);
    const tau = travelTimeMatrix(inst, params);
    cached = { key, value: { params, inst, tau, cov: buildCoverage(inst, tau, params) } };
  }
  return cached.value;
}
