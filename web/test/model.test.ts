// Mirrors tests/test_coverage.py, test_ilp.py and test_greedy.py for the TypeScript port.
import highsLoader from "highs";
import { beforeAll, describe, expect, it } from "vitest";
import { bandBenefits, buildCoverage, evaluate, evaluateByPeriod, travelTimeMatrix } from "../src/model/coverage";
import { generateInstance, GenOptions, Instance, makeRng } from "../src/model/instance";
import { DEFAULT_PARAMS, Params } from "../src/model/params";
import { solveGreedy, solveIlp } from "../src/model/solvers";

type Highs = Awaited<ReturnType<typeof highsLoader>>;
let highs: Highs;
beforeAll(async () => { highs = await highsLoader(); });

const TINY: GenOptions = { extentM: 600, gridN: 5, nSites: 8, nExisting: 0, outdoorCost: 1 };
const SMALL: GenOptions = { gridN: 12, nSites: 40, nExisting: 2 };
const tiny = () => generateInstance(1, TINY);
const covOf = (inst: Instance, p: Params = DEFAULT_PARAMS) => buildCoverage(inst, travelTimeMatrix(inst, p), p);
const ones = (n: number) => new Uint8Array(n).fill(1);
const sumX = (x: Uint8Array) => x.reduce((a, b) => a + b, 0);

/** Direct spec formula: sum over (i, p) of rate * b(fastest open selected site). */
function bruteLives(inst: Instance, p: Params, x: Uint8Array): number {
  const tau = travelTimeMatrix(inst, p);
  const { edges, b } = bandBenefits(p);
  const P = inst.periods.length, J = inst.nSites;
  let total = 0;
  for (let i = 0; i < inst.nCells; i++) {
    for (let q = 0; q < P; q++) {
      let t = Infinity;
      for (let j = 0; j < J; j++) {
        const tij = tau[i * J + j];
        if (x[j] && inst.siteOpen[j * P + q] && tij <= p.maxTauS) t = Math.min(t, tij);
      }
      const k = edges.findIndex((e) => e >= t);
      if (k >= 0) total += inst.cellRate[i * P + q] * b[k];
    }
  }
  return total;
}

function bruteBest(cov: ReturnType<typeof covOf>, K: number): number {
  let best = 0;
  const J = cov.nSites;
  for (let mask = 0; mask < 1 << J; mask++) {
    let bits = 0;
    const x = new Uint8Array(J);
    for (let j = 0; j < J; j++) if (mask & (1 << j)) { x[j] = 1; bits++; }
    if (bits === K) best = Math.max(best, evaluate(cov, x));
  }
  return best;
}

describe("coverage", () => {
  it("evaluate matches the direct formula", () => {
    const inst = tiny(), cov = covOf(inst), rng = makeRng(0);
    for (let n = 0; n < 10; n++) {
      const x = Uint8Array.from({ length: 8 }, () => (rng.uniform() < 0.4 ? 1 : 0));
      expect(evaluate(cov, x)).toBeCloseTo(bruteLives(inst, DEFAULT_PARAMS, x), 12);
    }
  });

  it("a period with every site locked contributes 0", () => {
    const inst = tiny();
    for (let j = 0; j < inst.nSites; j++) inst.siteOpen[j * 3 + 2] = 0;
    expect(evaluateByPeriod(covOf(inst), ones(8))[2]).toBe(0);
  });

  it("an unreachable cell has no rows", () => {
    const inst = tiny();
    inst.cellXY[0] = 1e6; inst.cellXY[1] = 1e6;
    expect(covOf(inst).rowCell.includes(0)).toBe(false);
  });

  it("EMS faster than every band gives empty coverage", () => {
    const cov = covOf(tiny(), { ...DEFAULT_PARAMS, emsResponseS: 30 });
    expect(cov.nRows).toBe(0);
    expect(evaluate(cov, ones(8))).toBe(0);
  });
});

describe("ILP", () => {
  it("matches brute force on the tiny instance", () => {
    const cov = covOf(tiny());
    for (const K of [1, 2, 3]) {
      const sol = solveIlp(highs, cov, K);
      expect(sumX(sol.x)).toBeLessThanOrEqual(K);
      expect(sol.lives).toBeCloseTo(bruteBest(cov, K), 9);
    }
  });

  it("is monotone in budget, keeps existing AEDs, handles K = 0", () => {
    const cov = covOf(generateInstance(0, SMALL));
    const lives = [0, 1, 2, 3, 4, 5].map((K) => solveIlp(highs, cov, K).lives);
    lives.slice(1).forEach((v, k) => expect(v).toBeGreaterThanOrEqual(lives[k] - 1e-9));
    const sol = solveIlp(highs, cov, 3);
    cov.siteExisting.forEach((e, j) => e && expect(sol.x[j]).toBe(1));
    const zero = solveIlp(highs, cov, 0);
    expect(Array.from(zero.x)).toEqual(Array.from(cov.siteExisting));
    expect(zero.lives).toBeCloseTo(evaluate(cov, cov.siteExisting), 12);
  });

  it("returns 0 on empty coverage", () => {
    expect(solveIlp(highs, covOf(tiny(), { ...DEFAULT_PARAMS, emsResponseS: 30 }), 3).lives).toBe(0);
  });
});

describe("greedy", () => {
  it.each([0, 1, 2])("is within (1 - 1/e) of the ILP (seed %i)", (seed) => {
    const cov = covOf(generateInstance(seed, { ...SMALL, nExisting: 0, outdoorCost: 1 }));
    for (const K of [2, 5]) {
      const g = solveGreedy(cov, K), opt = solveIlp(highs, cov, K);
      expect(sumX(g.x)).toBeLessThanOrEqual(K);
      expect(g.lives).toBeGreaterThanOrEqual((1 - 1 / Math.E) * opt.lives - 1e-9);
      expect(g.lives).toBeLessThanOrEqual(opt.lives + 1e-9);
    }
  });

  it("K = 0 keeps only existing AEDs; huge K covers everything", () => {
    const cov = covOf(generateInstance(0, SMALL));
    expect(Array.from(solveGreedy(cov, 0).x)).toEqual(Array.from(cov.siteExisting));
    const t = covOf(tiny());
    expect(solveGreedy(t, 1e6).lives).toBeCloseTo(evaluate(t, ones(8)), 12);
  });
});

describe("full-size campus", () => {
  it("ILP at K = 15 solves in reasonable time", () => {
    const cov = covOf(generateInstance(0));
    const sol = solveIlp(highs, cov, 15);
    const g = solveGreedy(cov, 15);
    console.log(`rows=${cov.nRows} ilp=${sol.lives.toFixed(4)} (${sol.runtimeS.toFixed(2)}s, ${sol.status}) greedy=${g.lives.toFixed(4)}`);
    expect(sol.lives).toBeGreaterThanOrEqual(g.lives - 1e-9);
  }, 120_000);
});

describe("walking distances", () => {
  it("travelTimeMatrix uses walkDistM instead of straight line x detour", () => {
    const inst = generateInstance(1, { extentM: 600, gridN: 3, nSites: 4, nExisting: 0 });
    const walk = new Float64Array(inst.nCells * inst.nSites).fill(140);
    const tau = travelTimeMatrix({ ...inst, walkDistM: walk }, DEFAULT_PARAMS);
    const j = 2;
    expect(tau[j]).toBeCloseTo(DEFAULT_PARAMS.dispatchDelayS + (2 * 140) / DEFAULT_PARAMS.walkSpeedMps + inst.siteFloorDelay[j], 9);
  });
});
