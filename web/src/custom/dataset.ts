// User-supplied locations (uploaded or drawn on the map) and their conversion to a model Instance.
import type { Instance } from "../model/instance";
import { metresToLatLon } from "../model/instance";

export interface CustomSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;          // one of KINDS
  existing: boolean;     // already has an AED: on, and free
  mustInclude: boolean;  // planner wants an AED here: on, and paid from the budget
  floorDelayS?: number;  // time to reach the AED inside the building; defaults by kind
  cost?: number;         // cost units; defaults by kind (outdoor cabinets 1.5)
}

export interface DemandPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  weight: number;               // relative share of arrests (people, footfall, ...)
  periodWeights?: [number, number, number]; // optional day/evening/night split (copied campuses)
}

export interface CustomDataset {
  name: string;
  sites: CustomSite[];
  demand: DemandPoint[];
  arrestsPerYear: number;   // total expected public arrests per year across all demand points
}

export const KINDS = ["academic", "library", "residential", "athletic", "dining", "outdoor", "other"] as const;
export const PERIODS = ["day", "evening", "night"];
const PERIOD_HOURS = [10, 6, 8];

// Same opening rule as aed/data/synthetic.py: a building is open while it has people in it.
// Academic, dining and athletic buildings are empty at night; the rest are open 24/7.
const OPEN: Record<string, [number, number, number]> = {
  academic: [1, 1, 0], dining: [1, 1, 0], athletic: [1, 1, 0],
  library: [1, 1, 1], residential: [1, 1, 1], outdoor: [1, 1, 1], other: [1, 1, 1],
};
// ASSUMPTION: share of a site's arrests in each period when the upload has no time split; this is
// the split of the team's seed-0 campus (2.81 / 1.15 / 0.87 arrests per year).
export const DEFAULT_PERIOD_SHARE: [number, number, number] = [0.582, 0.238, 0.18];
// ASSUMPTION: time to reach an AED inside a building (the team's range is 30-120 s; midpoint).
const INDOOR_DELAY_S = 75;
const OUTDOOR_COST = 1.5;

const SYNONYMS: [RegExp, string][] = [
  [/acad|class|lecture|school|college|faculty|office|\blab|teach/, "academic"],
  [/libr/, "library"],
  [/resid|dorm|\bhous(e|ing)\b|apart|\bhome|hostel|living/, "residential"],
  [/gym|sport|athlet|arena|stadium|rec(reation)?\b|fitness|pool|field/, "athletic"],
  [/din|cafe|food|restaur|kitchen|canteen|eat/, "dining"],
  [/\bout|cabinet|street|\bpark\b|plaza|kiosk|public|transit|station/, "outdoor"],
];

export function normalizeKind(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if ((KINDS as readonly string[]).includes(s)) return s;
  for (const [re, kind] of SYNONYMS) if (re.test(s)) return kind;
  return "other";
}

export function openHours(kind: string): [number, number, number] {
  return OPEN[kind] ?? OPEN.other;
}

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export interface LatLonBounds { minLat: number; maxLat: number; minLon: number; maxLon: number }

export function datasetBounds(ds: CustomDataset): LatLonBounds | null {
  const pts = [...ds.sites, ...ds.demand];
  if (!pts.length) return null;
  const b = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity };
  for (const p of pts) {
    b.minLat = Math.min(b.minLat, p.lat); b.maxLat = Math.max(b.maxLat, p.lat);
    b.minLon = Math.min(b.minLon, p.lon); b.maxLon = Math.max(b.maxLon, p.lon);
  }
  return b;
}

const M_PER_DEG = 111_320;

/**
 * Uniform demand over the sites' bounding box (plus a margin) for uploads that only list sites.
 * About `target` points; each gets equal weight.
 */
export function uniformDemand(ds: CustomDataset, target = 900): DemandPoint[] {
  const b = datasetBounds({ ...ds, demand: [] });
  if (!b) return [];
  const lat0 = (b.minLat + b.maxLat) / 2;
  const mPerLon = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const margin = 150; // metres around the outermost sites
  const w = (b.maxLon - b.minLon) * mPerLon + 2 * margin;
  const h = (b.maxLat - b.minLat) * M_PER_DEG + 2 * margin;
  const step = Math.max(25, Math.sqrt((w * h) / target));
  const nx = Math.max(1, Math.round(w / step)), ny = Math.max(1, Math.round(h / step));
  const out: DemandPoint[] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      out.push({
        id: `u${iy}_${ix}`, name: "uniform",
        lat: b.minLat - margin / M_PER_DEG + ((iy + 0.5) * h) / ny / M_PER_DEG,
        lon: b.minLon - margin / mPerLon + ((ix + 0.5) * w) / nx / mPerLon,
        weight: 1,
      });
    }
  }
  return out;
}

/**
 * Model instance for a custom dataset. Positions are projected to local metres from the south-west
 * corner of the data; each demand point is one "cell".
 */
export function datasetToInstance(ds: CustomDataset): Instance {
  const demand = ds.demand.length ? ds.demand : uniformDemand(ds);
  // Loop rather than Math.min(...array): city-sized uploads would overflow the call stack.
  let lat0 = Infinity, lon0 = Infinity;
  for (const p of ds.sites) { lat0 = Math.min(lat0, p.lat); lon0 = Math.min(lon0, p.lon); }
  for (const p of demand) { lat0 = Math.min(lat0, p.lat); lon0 = Math.min(lon0, p.lon); }
  const mPerLon = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const toX = (lon: number) => (lon - lon0) * mPerLon;
  const toY = (lat: number) => (lat - lat0) * M_PER_DEG;
  const P = 3, I = demand.length, J = ds.sites.length;

  // Per-period weights, then scale so the whole dataset sums to arrestsPerYear.
  const raw = new Float64Array(I * P);
  for (let i = 0; i < I; i++) {
    const d = demand[i];
    const pw = d.periodWeights ?? DEFAULT_PERIOD_SHARE.map((s) => s * Math.max(0, d.weight));
    for (let p = 0; p < P; p++) raw[i * P + p] = Math.max(0, pw[p]);
  }
  const total = raw.reduce((a, b) => a + b, 0);
  const cellRate = raw.map((v) => (total > 0 ? (v / total) * ds.arrestsPerYear : 0));

  const cellXY = new Float64Array(I * 2), siteXY = new Float64Array(J * 2);
  demand.forEach((d, i) => { cellXY[2 * i] = toX(d.lon); cellXY[2 * i + 1] = toY(d.lat); });
  ds.sites.forEach((s, j) => { siteXY[2 * j] = toX(s.lon); siteXY[2 * j + 1] = toY(s.lat); });

  const siteOpen = new Uint8Array(J * P);
  ds.sites.forEach((s, j) => openHours(s.kind).forEach((o, p) => (siteOpen[j * P + p] = o)));

  return {
    cellXY, cellRate, siteXY,
    siteCost: Float64Array.from(ds.sites, (s) => s.cost ?? (s.kind === "outdoor" ? OUTDOOR_COST : 1)),
    siteFloorDelay: Float64Array.from(ds.sites, (s) => s.floorDelayS ?? (s.kind === "outdoor" ? 0 : INDOOR_DELAY_S)),
    siteOpen,
    siteExisting: Uint8Array.from(ds.sites, (s) => (s.existing ? 1 : 0)),
    siteForced: Uint8Array.from(ds.sites, (s) => (s.mustInclude && !s.existing ? 1 : 0)),
    siteName: ds.sites.map((s) => s.name),
    siteKind: ds.sites.map((s) => s.kind),
    periods: [...PERIODS], periodHours: [...PERIOD_HOURS],
    originLatLon: [lat0, lon0], nCells: I, nSites: J, cellSizeM: 0,
  };
}

/** Editable copy of a model instance (e.g. the team campus), keeping its exact demand split. */
export function datasetFromInstance(inst: Instance, name: string): CustomDataset {
  const P = inst.periods.length;
  const sites: CustomSite[] = [];
  for (let j = 0; j < inst.nSites; j++) {
    const [lat, lon] = metresToLatLon(inst.siteXY[2 * j], inst.siteXY[2 * j + 1], inst.originLatLon);
    sites.push({
      id: `s${j}`, name: inst.siteName?.[j] ?? `Site ${j}`, lat, lon, kind: normalizeKind(inst.siteKind[j]),
      existing: inst.siteExisting[j] === 1, mustInclude: inst.siteForced?.[j] === 1,
      floorDelayS: inst.siteFloorDelay[j], cost: inst.siteCost[j],
    });
  }
  const demand: DemandPoint[] = [];
  let total = 0;
  for (let i = 0; i < inst.nCells; i++) {
    const pw = [0, 1, 2].map((p) => inst.cellRate[i * P + p]) as [number, number, number];
    const w = pw[0] + pw[1] + pw[2];
    if (w <= 0) continue;
    total += w;
    const [lat, lon] = metresToLatLon(inst.cellXY[2 * i], inst.cellXY[2 * i + 1], inst.originLatLon);
    demand.push({ id: `d${i}`, name: `Cell ${i}`, lat, lon, weight: w, periodWeights: pw });
  }
  return { name, sites, demand, arrestsPerYear: total };
}

// ---------- per-viewer persistence (a convenience only: the app works without it) ----------
const KEY = "aed.custom.v1";

export function loadDataset(): CustomDataset | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const ds = JSON.parse(raw) as CustomDataset;
    return Array.isArray(ds.sites) && Array.isArray(ds.demand) ? ds : null;
  } catch {
    return null;
  }
}

export function saveDataset(ds: CustomDataset | null) {
  try {
    if (ds) localStorage.setItem(KEY, JSON.stringify(ds));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}
