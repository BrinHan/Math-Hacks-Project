// TypeScript mirror of aed/travel.py, aed/survival.py, aed/coverage.py and aed/solvers/common.py.
import { Instance } from "./instance";
import { Params } from "./params";

/** (I, J) seconds, flattened: dispatch delay + round trip at walking speed + floor delay. */
export function travelTimeMatrix(inst: Instance, params: Params): Float64Array {
  const { nCells: I, nSites: J } = inst;
  const tau = new Float64Array(I * J);
  const f = (2 * params.detourFactor) / params.walkSpeedMps;
  for (let i = 0; i < I; i++) {
    const cx = inst.cellXY[2 * i], cy = inst.cellXY[2 * i + 1];
    for (let j = 0; j < J; j++) {
      const d = Math.hypot(cx - inst.siteXY[2 * j], cy - inst.siteXY[2 * j + 1]);
      tau[i * J + j] = params.dispatchDelayS + f * d + inst.siteFloorDelay[j];
    }
  }
  return tau;
}

export function survival(tS: number, params: Params): number {
  const tMin = tS / 60;
  return params.survivalForm === "exp"
    ? params.survivalS0 * Math.exp(-params.survivalKPerMin * tMin)
    : Math.max(0, params.survivalS0 * (1 - params.survivalKPerMin * tMin));
}

/**
 * Band upper edges and benefit vs EMS, b_k = f * max(0, S(T_k) - S(ems)); zero bands dropped.
 * f = shockableFraction: an AED only helps arrests with a shockable rhythm (VF/pVT).
 */
export function bandBenefits(params: Params): { edges: number[]; b: number[] } {
  const sEms = survival(params.emsResponseS, params);
  const edges: number[] = [], b: number[] = [];
  for (const e of params.bandEdgesS) {
    const v = params.shockableFraction * Math.max(0, survival(e, params) - sEms);
    if (v > 0) { edges.push(e); b.push(v); }
  }
  return { edges, b };
}

/** Sparse 0/1 rows (cell, period, band) x sites, stored both by row (CSR) and by site (CSC). */
export interface Coverage {
  nRows: number;
  nSites: number;
  nPeriods: number;
  rowPtr: Int32Array;    // CSR
  rowSites: Int32Array;
  sitePtr: Int32Array;   // CSC
  siteRows: Int32Array;
  weights: Float64Array; // expected lives per year if the row is covered
  rowCell: Int32Array;
  rowPeriod: Int32Array;
  rowBand: Int32Array;
  siteCost: Float64Array;
  siteExisting: Uint8Array;
  siteForced?: Uint8Array; // must-include sites: on, and their cost counts against the budget
}

/**
 * Incremental gradual-cover form (spec section 5): one row per (i, p, k) with weight
 * rate_ip * (b_k - b_{k+1}); sets are nested in k, so covered weights telescope.
 */
export function buildCoverage(inst: Instance, tau: Float64Array, params: Params): Coverage {
  const { edges, b } = bandBenefits(params);
  const { nCells: I, nSites: J } = inst;
  const P = inst.periods.length;
  const rowPtr = [0], rowSites: number[] = [], weights: number[] = [];
  const rowCell: number[] = [], rowPeriod: number[] = [], rowBand: number[] = [];

  for (let k = 0; k < edges.length; k++) {
    const db = b[k] - (k + 1 < b.length ? b[k + 1] : 0);
    if (db <= 0) continue;
    const limit = Math.min(edges[k], params.maxTauS);
    for (let q = 0; q < P; q++) {
      for (let i = 0; i < I; i++) {
        const w = inst.cellRate[i * P + q] * db;
        if (w <= 0) continue;
        const start = rowSites.length;
        for (let j = 0; j < J; j++) {
          if (inst.siteOpen[j * P + q] && tau[i * J + j] <= limit) rowSites.push(j);
        }
        if (rowSites.length === start) continue;
        rowPtr.push(rowSites.length);
        weights.push(w); rowCell.push(i); rowPeriod.push(q); rowBand.push(k);
      }
    }
  }

  const R = weights.length;
  const sitePtr = new Int32Array(J + 1);
  for (const j of rowSites) sitePtr[j + 1]++;
  for (let j = 0; j < J; j++) sitePtr[j + 1] += sitePtr[j];
  const fill = sitePtr.slice(0, J);
  const siteRows = new Int32Array(rowSites.length);
  for (let r = 0; r < R; r++) {
    for (let n = rowPtr[r]; n < rowPtr[r + 1]; n++) siteRows[fill[rowSites[n]]++] = r;
  }

  return {
    nRows: R, nSites: J, nPeriods: P,
    rowPtr: Int32Array.from(rowPtr), rowSites: Int32Array.from(rowSites), sitePtr, siteRows,
    weights: Float64Array.from(weights), rowCell: Int32Array.from(rowCell),
    rowPeriod: Int32Array.from(rowPeriod), rowBand: Int32Array.from(rowBand),
    siteCost: Float64Array.from(inst.siteCost), siteExisting: Uint8Array.from(inst.siteExisting),
    siteForced: inst.siteForced ? Uint8Array.from(inst.siteForced) : undefined,
  };
}

export function coveredRows(cov: Coverage, x: Uint8Array): Uint8Array {
  const covered = new Uint8Array(cov.nRows);
  for (let j = 0; j < cov.nSites; j++) {
    if (!x[j]) continue;
    for (let n = cov.sitePtr[j]; n < cov.sitePtr[j + 1]; n++) covered[cov.siteRows[n]] = 1;
  }
  return covered;
}

/** Expected lives saved per year vs ambulance-only; every solver reports through this. */
export function evaluate(cov: Coverage, x: Uint8Array): number {
  const covered = coveredRows(cov, x);
  let s = 0;
  for (let r = 0; r < cov.nRows; r++) if (covered[r]) s += cov.weights[r];
  return s;
}

export function evaluateByPeriod(cov: Coverage, x: Uint8Array): number[] {
  const covered = coveredRows(cov, x);
  const out = new Array(cov.nPeriods).fill(0);
  for (let r = 0; r < cov.nRows; r++) if (covered[r]) out[cov.rowPeriod[r]] += cov.weights[r];
  return out;
}
