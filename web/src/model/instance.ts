// TypeScript mirror of aed/instance.py and the stub generator in aed/data/synthetic.py.
// Matrices are flattened row-major: cellRate[i * P + p], siteOpen[j * P + p].
import { DEFAULT_PARAMS, Params } from "./params";

export interface Instance {
  cellXY: Float64Array;       // (I, 2) metres
  cellRate: Float64Array;     // (I, P) public OHCA per year
  siteXY: Float64Array;       // (J, 2) metres
  siteCost: Float64Array;     // (J,)
  siteFloorDelay: Float64Array; // (J,) seconds
  siteOpen: Uint8Array;       // (J, P) 0/1
  siteExisting: Uint8Array;   // (J,) 0/1
  siteForced?: Uint8Array;    // (J,) 0/1 must-include (custom datasets only)
  siteName?: string[];        // (J,) display names (custom datasets only)
  siteKind: string[];
  periods: string[];
  periodHours: number[];
  originLatLon: [number, number];
  nCells: number;
  nSites: number;
  cellSizeM: number;
}

export const PERIODS = ["day", "evening", "night"];
const PERIOD_HOURS = [10, 6, 8];                     // 08-18, 18-24, 00-08
const PERIOD_PEOPLE = [1.0, 0.6, 0.3];
// South-west corner of the 2 km square, so the default campus centres on York University's
// Keele campus (~43.7735, -79.5019). Demand and sites are still synthetic.
const ORIGIN_LATLON: [number, number] = [43.7645, -79.5143];
const INDOOR_KINDS = ["academic", "library", "residential", "athletic", "dining"];
const OPEN_EVENING = new Set(["library", "residential", "athletic", "dining", "outdoor"]);
const OPEN_NIGHT = new Set(["library", "residential", "outdoor"]);

/** Seeded PRNG (mulberry32). Numbers differ from numpy's, so seeds give different campuses than Python. */
export function makeRng(seed: number) {
  let a = (seed >>> 0) + 0x9e3779b9;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    uniform,
    range: (lo: number, hi: number) => lo + (hi - lo) * uniform(),
    int: (n: number) => Math.floor(uniform() * n),
    // Gamma with integer shape = sum of `shape` exponentials.
    gamma: (shape: number, scale: number) => {
      let s = 0;
      for (let k = 0; k < shape; k++) s -= Math.log(1 - uniform());
      return s * scale;
    },
  };
}

export interface GenOptions {
  extentM?: number;
  gridN?: number;
  nSites?: number;
  nExisting?: number;
  outdoorCost?: number;
}

/** Uniform random campus; same rules as the Python stub generator. */
export function generateInstance(seed = 0, opts: GenOptions = {}, params: Params = DEFAULT_PARAMS): Instance {
  const { extentM = 2000, gridN = 32, nSites = 300, nExisting = 5, outdoorCost = 1.5 } = opts;
  const rng = makeRng(seed);
  const P = PERIODS.length;
  const I = gridN * gridN;
  const step = extentM / gridN;

  const cellXY = new Float64Array(I * 2);
  const cellRate = new Float64Array(I * P);
  for (let gy = 0; gy < gridN; gy++) {
    for (let gx = 0; gx < gridN; gx++) {
      const i = gy * gridN + gx;
      cellXY[2 * i] = (gx + 0.5) * step;
      cellXY[2 * i + 1] = (gy + 0.5) * step;
      const people = rng.gamma(2, 50);
      for (let p = 0; p < P; p++) {
        // Same demand rule as aed/data/synthetic.py: hazard for people in public = public / away share.
        cellRate[i * P + p] = people * PERIOD_PEOPLE[p] * params.incidencePer100kYr / 1e5
          * (params.publicFraction / params.awayTimeShare) * PERIOD_HOURS[p] / 24;
      }
    }
  }

  const nOutdoor = Math.max(1, Math.round(0.1 * nSites));
  const nIndoor = nSites - nOutdoor;
  const siteXY = new Float64Array(nSites * 2);
  for (let k = 0; k < siteXY.length; k++) siteXY[k] = rng.range(0, extentM);
  const siteKind = Array.from({ length: nSites }, (_, j) =>
    j < nIndoor ? INDOOR_KINDS[rng.int(INDOOR_KINDS.length)] : "outdoor");

  const siteCost = new Float64Array(nSites);
  const siteFloorDelay = new Float64Array(nSites);
  const siteOpen = new Uint8Array(nSites * P);
  for (let j = 0; j < nSites; j++) {
    const outdoor = siteKind[j] === "outdoor";
    siteCost[j] = outdoor ? outdoorCost : 1;
    siteFloorDelay[j] = outdoor ? 0 : rng.range(30, 120);
    siteOpen[j * P] = 1;
    siteOpen[j * P + 1] = OPEN_EVENING.has(siteKind[j]) ? 1 : 0;
    siteOpen[j * P + 2] = OPEN_NIGHT.has(siteKind[j]) ? 1 : 0;
  }

  const siteExisting = new Uint8Array(nSites);
  const pool = Array.from({ length: nIndoor }, (_, j) => j);
  for (let n = 0; n < Math.min(nExisting, nIndoor); n++) {
    const k = n + rng.int(pool.length - n);
    [pool[n], pool[k]] = [pool[k], pool[n]];
    siteExisting[pool[n]] = 1;
  }

  return {
    cellXY, cellRate, siteXY, siteCost, siteFloorDelay, siteOpen, siteExisting, siteKind,
    periods: [...PERIODS], periodHours: [...PERIOD_HOURS], originLatLon: ORIGIN_LATLON,
    nCells: I, nSites, cellSizeM: step,
  };
}

const M_PER_DEG_LAT = 111_320;

/** Local (x east, y north) metres -> [lat, lon] degrees. */
export function metresToLatLon(x: number, y: number, origin: [number, number]): [number, number] {
  const [lat0, lon0] = origin;
  return [lat0 + y / M_PER_DEG_LAT, lon0 + x / (M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180))];
}
