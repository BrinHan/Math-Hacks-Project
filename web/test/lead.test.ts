// Cross-checks the TypeScript model against the lead's Python results (public/data/lead.json).
// Skipped until web/scripts/export_data.py has been run.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leadInstance, LeadData } from "../src/data";
import { buildCoverage, evaluate, travelTimeMatrix } from "../src/model/coverage";
import { DEFAULT_PARAMS } from "../src/model/params";
import { solveGreedy } from "../src/model/solvers";

const path = fileURLToPath(new URL("../public/data/lead.json", import.meta.url));
const lead: LeadData | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

describe.skipIf(!lead)("TypeScript port vs the lead's Python results", () => {
  const inst = leadInstance(lead!);
  const cov = buildCoverage(inst, travelTimeMatrix(inst, DEFAULT_PARAMS), DEFAULT_PARAMS);

  it("uses the same parameters", () => {
    expect(lead!.params.ems_response_s).toBe(DEFAULT_PARAMS.emsResponseS);
    expect(lead!.params.walk_speed_mps).toBe(DEFAULT_PARAMS.walkSpeedMps);
    expect(lead!.params.survival_k_per_min).toBe(DEFAULT_PARAMS.survivalKPerMin);
    expect(lead!.params.shockable_fraction).toBe(DEFAULT_PARAMS.shockableFraction);
    expect(lead!.params.away_time_share).toBe(DEFAULT_PARAMS.awayTimeShare);
    expect(lead!.params.public_fraction).toBe(DEFAULT_PARAMS.publicFraction);
  });

  it("evaluate() reproduces the lead's ILP lives for every placement", () => {
    for (const row of lead!.results.kCurve) {
      const x = Uint8Array.from(inst.siteExisting);
      for (const j of lead!.results.placements[String(row.K)]) x[j] = 1;
      expect(evaluate(cov, x)).toBeCloseTo(row.ilp_lives, 5);
    }
  });

  it("existing-only lives match", () => {
    expect(evaluate(cov, inst.siteExisting)).toBeCloseTo(lead!.results.kCurve[0].existing_lives, 5);
  });

  it("greedy matches the lead's greedy", () => {
    for (const row of lead!.results.kCurve) {
      expect(solveGreedy(cov, row.K).lives).toBeCloseTo(row.greedy_lives, 5);
    }
  });
});
