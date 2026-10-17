// TypeScript mirror of aed/solvers/greedy.py and aed/solvers/ilp.py.
import type highsLoader from "highs";
import { Coverage, coveredRows, evaluate } from "./coverage";

type Highs = Awaited<ReturnType<typeof highsLoader>>;

export interface Solution {
  x: Uint8Array;       // (J,) AED at site j, existing included
  lives: number;
  method: "ilp" | "greedy";
  runtimeS: number;
  status?: string;
}

/** Lazy greedy on marginal gain per unit cost (>= 1 - 1/e of optimal for unit costs). */
export function solveGreedy(cov: Coverage, budget: number): Solution {
  const t0 = performance.now();
  const { fixed, forcedCost } = fixedSites(cov);
  const x = fixed;
  budget -= forcedCost;
  const covered = coveredRows(cov, x);
  const gain = (j: number) => {
    let g = 0;
    for (let n = cov.sitePtr[j]; n < cov.sitePtr[j + 1]; n++) {
      const r = cov.siteRows[n];
      if (!covered[r]) g += cov.weights[r];
    }
    return g;
  };

  // Max-heap of [stale upper bound on ratio, site].
  const heap: [number, number][] = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    for (let c = heap.length - 1; c > 0;) {
      const p = (c - 1) >> 1;
      if (heap[p][0] >= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]]; c = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let p = 0; ;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < heap.length && heap[l][0] > heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] > heap[m][0]) m = r;
        if (m === p) break;
        [heap[p], heap[m]] = [heap[m], heap[p]]; p = m;
      }
    }
    return top;
  };

  for (let j = 0; j < cov.nSites; j++) if (!x[j]) push([gain(j) / cov.siteCost[j], j]);
  let remaining = budget;
  while (heap.length) {
    const [, j] = pop();
    if (cov.siteCost[j] > remaining + 1e-12) continue; // budget only shrinks
    const ratio = gain(j) / cov.siteCost[j];
    if (heap.length && ratio < heap[0][0]) { push([ratio, j]); continue; } // stale bound
    if (ratio <= 0) break;
    x[j] = 1;
    remaining -= cov.siteCost[j];
    for (let n = cov.sitePtr[j]; n < cov.sitePtr[j + 1]; n++) covered[cov.siteRows[n]] = 1;
  }
  return { x, lives: evaluate(cov, x), method: "greedy", runtimeS: (performance.now() - t0) / 1000 };
}

/** Sites switched on before optimizing: existing AEDs (free) and must-include sites (paid). */
export function fixedSites(cov: Coverage): { fixed: Uint8Array; forcedCost: number } {
  const fixed = Uint8Array.from(cov.siteExisting);
  let forcedCost = 0;
  if (cov.siteForced) {
    for (let j = 0; j < cov.nSites; j++) {
      if (cov.siteForced[j] && !fixed[j]) { fixed[j] = 1; forcedCost += cov.siteCost[j]; }
    }
  }
  return { fixed, forcedCost };
}

/**
 * Gradual-cover MCLP as a MIP for HiGHS (CPLEX LP text). Fixed sites (existing + must-include) are
 * on, so rows they already cover are constant and dropped; z_r <= sum of the remaining sites in row r.
 * `budget` is what is left for free choices after paying for must-include sites.
 */
export function buildIlpLp(cov: Coverage, budget: number, fixed: Uint8Array = cov.siteExisting): { lp: string; sites: number[] } | null {
  const covered = coveredRows(cov, fixed);
  const used = new Uint8Array(cov.nSites);
  const rows: number[] = [];
  for (let r = 0; r < cov.nRows; r++) {
    if (covered[r]) continue;
    rows.push(r);
    for (let n = cov.rowPtr[r]; n < cov.rowPtr[r + 1]; n++) used[cov.rowSites[n]] = 1;
  }
  const sites: number[] = [];
  for (let j = 0; j < cov.nSites; j++) if (used[j] && !fixed[j] && cov.siteCost[j] <= budget + 1e-12) sites.push(j);
  if (!rows.length || !sites.length) return null;
  const keep = new Uint8Array(cov.nSites);
  for (const j of sites) keep[j] = 1;

  const out: string[] = ["Maximize", " obj:"];
  // Scale so the objective is O(1) for the solver; it does not change the argmax.
  const scale = 1 / Math.max(...rows.map((r) => cov.weights[r]));
  rows.forEach((r, n) => out.push(` + ${(cov.weights[r] * scale).toPrecision(12)} z${n}`));
  out.push("Subject To");
  rows.forEach((r, n) => {
    const terms = [];
    for (let m = cov.rowPtr[r]; m < cov.rowPtr[r + 1]; m++) {
      const j = cov.rowSites[m];
      if (keep[j]) terms.push(` - x${j}`);
    }
    out.push(` c${n}: z${n}${terms.join("")} <= 0`);
  });
  out.push(` budget: ${sites.map((j) => `${cov.siteCost[j]} x${j}`).join(" + ")} <= ${budget}`);
  out.push("Bounds");
  rows.forEach((_, n) => out.push(` 0 <= z${n} <= 1`));
  out.push("Binary", sites.map((j) => ` x${j}`).join("\n"), "End");
  return { lp: out.join("\n"), sites };
}

export function solveIlp(highs: Highs, cov: Coverage, budget: number, timeLimitS = 60): Solution {
  const t0 = performance.now();
  const { fixed, forcedCost } = fixedSites(cov);
  if (forcedCost > budget + 1e-9) {
    throw new Error(`must-include sites cost ${forcedCost} but the budget is ${budget}`);
  }
  const x = Uint8Array.from(fixed);
  const model = buildIlpLp(cov, budget - forcedCost, fixed);
  let status = "Optimal";
  if (model) {
    const res = highs.solve(model.lp, { time_limit: timeLimitS, mip_rel_gap: 1e-4, presolve: "on" });
    status = res.Status;
    if (res.Status === "Infeasible") throw new Error("ILP infeasible");
    for (const j of model.sites) if ((res.Columns[`x${j}`]?.Primal ?? 0) > 0.5) x[j] = 1;
  }
  return { x, lives: evaluate(cov, x), method: "ilp", runtimeS: (performance.now() - t0) / 1000, status };
}
