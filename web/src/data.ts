// The lead's campus and results, exported by web/scripts/export_data.py into public/data/lead.json.
import type { Instance } from "./model/instance";

export interface KCurveRow {
  K: number; ilp_lives: number; greedy_lives: number; swap_lives: number;
  pop_lives: number | null; existing_lives: number; gap_pct: number; ilp_time_s: number;
}
export interface MCRow { K: number; mean: number; p5: number; p95: number }
export interface OATRow {
  param: string; low_value: number; high_value: number;
  lives_at_low: number; lives_at_high: number; base_lives: number;
}

export interface LeadData {
  source: { generator: string; seed: number; results_dir: string; python_origin_latlon: [number, number] };
  params: Record<string, unknown>;
  ranges: Record<string, [number, number]>;
  citations: Record<string, string>;
  instance: {
    cellXY: number[]; cellRate: number[]; siteXY: number[]; siteCost: number[]; siteFloorDelay: number[];
    siteOpen: number[]; siteExisting: number[]; siteKind: string[]; periods: string[]; periodHours: number[];
    originLatLon: [number, number]; nCells: number; nSites: number; cellSizeM: number;
  };
  results: {
    kCurve: KCurveRow[];
    mcKCurve: MCRow[];
    siteFreq: { site_id: number; freq: number }[];
    oat: OATRow[];
    placements: Record<string, number[]>;
  };
}

let pending: Promise<LeadData | null> | null = null;

/** Fetch once; resolves null when the export has not been generated yet. */
export function loadLead(): Promise<LeadData | null> {
  pending ??= fetch(`${import.meta.env.BASE_URL}data/lead.json`)
    .then((r) => (r.ok ? (r.json() as Promise<LeadData>) : null))
    .catch(() => null);
  return pending;
}

export function leadInstance(d: LeadData): Instance {
  const s = d.instance;
  return {
    cellXY: Float64Array.from(s.cellXY), cellRate: Float64Array.from(s.cellRate),
    siteXY: Float64Array.from(s.siteXY), siteCost: Float64Array.from(s.siteCost),
    siteFloorDelay: Float64Array.from(s.siteFloorDelay), siteOpen: Uint8Array.from(s.siteOpen),
    siteExisting: Uint8Array.from(s.siteExisting), siteKind: [...s.siteKind], periods: [...s.periods],
    periodHours: [...s.periodHours], originLatLon: s.originLatLon,
    nCells: s.nCells, nSites: s.nSites, cellSizeM: s.cellSizeM,
  };
}
