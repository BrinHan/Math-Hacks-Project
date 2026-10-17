// York University's real buildings (public/data/york-osm.json, built by scripts/build_york_osm.mjs).
import highsLoader from "highs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { datasetToInstance } from "../src/custom/dataset";
import type { YorkData } from "../src/data";
import { buildCoverage, evaluate, travelTimeMatrix } from "../src/model/coverage";
import { DEFAULT_PARAMS } from "../src/model/params";
import { solveIlp } from "../src/model/solvers";

const path = fileURLToPath(new URL("../public/data/york-osm.json", import.meta.url));
const york: YorkData | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

describe.skipIf(!york)("York University (OpenStreetMap) dataset", () => {
  it("has one site per building footprint, all inside the campus area", () => {
    const d = york!;
    expect(d.footprints.length).toBe(d.stats.buildings);
    expect(d.sites.length).toBeGreaterThanOrEqual(d.footprints.length);
    for (const s of d.sites) {
      expect(s.lat).toBeGreaterThan(43.76); expect(s.lat).toBeLessThan(43.79);
      expect(s.lon).toBeGreaterThan(-79.53); expect(s.lon).toBeLessThan(-79.48);
    }
    expect(d.sites.filter((s) => s.existing).length).toBeGreaterThanOrEqual(Math.min(1, d.stats.mappedAeds));
  });

  it("converts to an instance whose demand sums to the stated arrests per year", () => {
    const inst = datasetToInstance(york!);
    expect(inst.cellRate.reduce((a, b) => a + b, 0)).toBeCloseTo(york!.arrestsPerYear, 6);
    expect(inst.nSites).toBe(york!.sites.length);
  });

  it("solves: more AEDs never save fewer lives", async () => {
    const highs = await highsLoader();
    const inst = datasetToInstance(york!);
    const cov = buildCoverage(inst, travelTimeMatrix(inst, DEFAULT_PARAMS), DEFAULT_PARAMS);
    const base = evaluate(cov, inst.siteExisting);
    const l5 = solveIlp(highs, cov, 5).lives, l10 = solveIlp(highs, cov, 10).lives;
    expect(l5).toBeGreaterThan(base);
    expect(l10).toBeGreaterThanOrEqual(l5 - 1e-12);
  }, 60_000);
});
