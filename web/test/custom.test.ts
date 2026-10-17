// Custom location data: parsing, header detection, conversion to an Instance, must-include sites.
import highsLoader from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import { CustomDataset, datasetFromInstance, datasetToInstance, normalizeKind, uniformDemand } from "../src/custom/dataset";
import { convertRows, detectMapping, parseCsv, parseJson } from "../src/custom/parse";
import { buildCoverage, evaluate, travelTimeMatrix } from "../src/model/coverage";
import { generateInstance } from "../src/model/instance";
import { DEFAULT_PARAMS } from "../src/model/params";
import { solveIlp } from "../src/model/solvers";

type Highs = Awaited<ReturnType<typeof highsLoader>>;
let highs: Highs;
beforeAll(async () => { highs = await highsLoader(); });

const covOf = (inst: ReturnType<typeof datasetToInstance>) =>
  buildCoverage(inst, travelTimeMatrix(inst, DEFAULT_PARAMS), DEFAULT_PARAMS);

describe("parsing and header detection", () => {
  it("detects named latitude / longitude and site columns in a CSV", () => {
    const f = parseCsv("Site ID,Name,Latitude,Longitude,Building Type,Has AED\n1,Scott Library,43.7735,-79.5032,Library,yes\n2,Vari Hall,43.7731,-79.5019,lecture hall,\n");
    const d = detectMapping(f.columns, f.rows);
    expect(d.mapping).toMatchObject({ lat: "Latitude", lon: "Longitude", id: "Site ID", name: "Name", kind: "Building Type", existing: "Has AED" });
    expect(d.role).toBe("sites");
    expect(d.ambiguous).toBe(false);
    const c = convertRows(f.rows, d.mapping, d.role);
    expect(c.sites.map((s) => [s.kind, s.existing])).toEqual([["library", true], ["academic", false]]);
  });

  it("flags x / y headers as ambiguous and demand files as demand", () => {
    const f = parseCsv("x,y,people\n-79.50,43.77,120\n-79.49,43.78,40\n");
    const d = detectMapping(f.columns, f.rows);
    expect(d.mapping.lon).toBe("x");
    expect(d.mapping.lat).toBe("y");
    expect(d.ambiguous).toBe(true);
    expect(d.role).toBe("demand");
    expect(convertRows(f.rows, d.mapping, "demand").demand.map((p) => p.weight)).toEqual([120, 40]);
  });

  it("is ambiguous when no coordinate column is recognised", () => {
    const f = parseCsv("a,b\n1,2\n");
    expect(detectMapping(f.columns, f.rows).ambiguous).toBe(true);
  });

  it("skips rows with bad coordinates or weights", () => {
    const f = parseCsv("lat,lon,weight\n43.7,-79.5,1\n,,1\n120,-79.5,1\n43.7,-79.5,-3\n");
    const c = convertRows(f.rows, detectMapping(f.columns, f.rows).mapping, "demand");
    expect(c.demand).toHaveLength(1);
    expect(c.skipped.map((s) => s.reason)).toEqual(["missing coordinates", "coordinates out of range", "invalid demand weight"]);
  });

  it("reads GeoJSON points and polygon centroids", () => {
    const f = parseJson(JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "A", kind: "dining" }, geometry: { type: "Point", coordinates: [-79.5, 43.77] } },
        { type: "Feature", properties: { name: "B" }, geometry: { type: "Polygon", coordinates: [[[-79.51, 43.76], [-79.49, 43.76], [-79.49, 43.78], [-79.51, 43.78]]] } },
      ],
    }));
    const d = detectMapping(f.columns, f.rows);
    expect(d.mapping.lat).toBe("latitude");
    const c = convertRows(f.rows, d.mapping, "sites");
    expect(c.sites[1].lat).toBeCloseTo(43.77, 6);
    expect(c.sites[1].lon).toBeCloseTo(-79.5, 6);
    expect(c.sites[0].kind).toBe("dining");
  });

  it("normalises building type names", () => {
    expect(["Residence Hall", "Gymnasium", "Cafeteria", "Outdoor cabinet", "South Lab", "warehouse"].map(normalizeKind))
      .toEqual(["residential", "athletic", "dining", "outdoor", "academic", "other"]);
  });
});

describe("custom dataset -> instance", () => {
  const ds: CustomDataset = {
    name: "test", arrestsPerYear: 2,
    sites: [
      { id: "a", name: "A", lat: 43.7700, lon: -79.5000, kind: "academic", existing: false, mustInclude: false },
      { id: "b", name: "B", lat: 43.7710, lon: -79.4990, kind: "residential", existing: true, mustInclude: false },
      { id: "c", name: "C", lat: 43.7690, lon: -79.5010, kind: "outdoor", existing: false, mustInclude: true },
    ],
    demand: [
      { id: "d1", name: "d1", lat: 43.7701, lon: -79.5001, weight: 3 },
      { id: "d2", name: "d2", lat: 43.7712, lon: -79.4992, weight: 1 },
    ],
  };

  it("scales demand to the stated arrests per year and applies opening hours, costs and flags", () => {
    const inst = datasetToInstance(ds);
    expect(inst.cellRate.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 12);
    expect(Array.from(inst.siteOpen)).toEqual([1, 1, 0, 1, 1, 1, 1, 1, 1]); // academic locked at night
    expect(Array.from(inst.siteCost)).toEqual([1, 1, 1.5]);
    expect(Array.from(inst.siteExisting)).toEqual([0, 1, 0]);
    expect(Array.from(inst.siteForced!)).toEqual([0, 0, 1]);
  });

  it("projects positions to metres consistently (about 111 m per 0.001 degree of latitude)", () => {
    const inst = datasetToInstance(ds);
    expect(inst.siteXY[3] - inst.siteXY[1]).toBeCloseTo(111.32, 1); // B is 0.001 deg north of A
  });

  it("fills in uniform demand when only sites are given", () => {
    const pts = uniformDemand({ ...ds, demand: [] }, 100);
    expect(pts.length).toBeGreaterThan(50);
    expect(datasetToInstance({ ...ds, demand: [] }).nCells).toBe(uniformDemand({ ...ds, demand: [] }).length);
  });

  it("round-trips a model campus through an editable copy", () => {
    const inst = generateInstance(2, { gridN: 10, nSites: 30, nExisting: 3 });
    const copy = datasetToInstance(datasetFromInstance(inst, "copy"));
    const a = covOf(inst), b = covOf(copy);
    const x = new Uint8Array(30).fill(1);
    expect(evaluate(b, x)).toBeCloseTo(evaluate(a, x), 3);
    expect(Array.from(copy.siteExisting)).toEqual(Array.from(inst.siteExisting));
  });
});

describe("must-include sites", () => {
  it("are always placed and paid for from the budget", () => {
    const base = generateInstance(1, { gridN: 12, nSites: 40, nExisting: 2, outdoorCost: 1 });
    const cov = covOf(base);
    const free = solveIlp(highs, cov, 3);
    // Force a site the unconstrained optimum does not use.
    const j = Array.from(free.x).findIndex((v, k) => !v && !base.siteExisting[k]);
    const forced = new Uint8Array(40); forced[j] = 1;
    const sol = solveIlp(highs, { ...cov, siteForced: forced }, 3);
    expect(sol.x[j]).toBe(1);
    const newCount = Array.from(sol.x).filter((v, k) => v && !base.siteExisting[k]).length;
    expect(newCount).toBeLessThanOrEqual(3);
    expect(sol.lives).toBeLessThanOrEqual(free.lives + 1e-12);
  });

  it("raise an error when they cost more than the budget", () => {
    const cov = covOf(generateInstance(1, { gridN: 8, nSites: 10, nExisting: 0, outdoorCost: 1 }));
    expect(() => solveIlp(highs, { ...cov, siteForced: Uint8Array.from([1, 1, 1, 0, 0, 0, 0, 0, 0, 0]) }, 2))
      .toThrow(/must-include/);
  });
});
