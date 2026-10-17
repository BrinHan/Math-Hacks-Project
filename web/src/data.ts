// The lead's campus and results, exported by web/scripts/export_data.py into public/data/lead.json.
import type { Instance } from "./model/instance";
import type { CustomDataset } from "./custom/dataset";

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
  source: { generator: string; campus?: string; seed: number; results_dir: string; python_origin_latlon: [number, number] };
  params: Record<string, unknown>;
  ranges: Record<string, [number, number]>;
  citations: Record<string, string>;
  instance: {
    cellXY: number[]; cellRate: number[]; siteXY: number[]; siteCost: number[]; siteFloorDelay: number[];
    siteOpen: number[]; siteExisting: number[]; siteKind: string[]; periods: string[]; periodHours: number[];
    originLatLon: [number, number]; nCells: number; nSites: number; cellSizeM: number;
    walkDistM?: number[]; siteName?: string[];
  };
  footprints?: { id: string; name?: string; ring: [number, number][]; holes?: [number, number][][]; levels?: number; levelsKnown?: boolean }[];
  campus?: [number, number][]; // campus boundary (lat, lon), for the map outline
  results: {
    kCurve: KCurveRow[];
    mcKCurve: MCRow[];
    siteFreq: { site_id: number; freq: number }[];
    oat: OATRow[];
    placements: Record<string, number[]>;
  };
}

/** York University's Keele campus from OpenStreetMap (web/scripts/build_york_osm.mjs). */
export interface YorkData extends CustomDataset {
  attribution: string;
  fetched: string;
  campus: [number, number][];
  footprints: { id: string; ring: [number, number][] }[];
  stats: { buildings: number; named: number; mappedAeds: number };
}

let yorkPending: Promise<YorkData | null> | null = null;
export function loadYork(): Promise<YorkData | null> {
  yorkPending ??= fetch(`${import.meta.env.BASE_URL}data/york-osm.json`)
    .then((r) => (r.ok ? (r.json() as Promise<YorkData>) : null))
    .catch(() => null);
  return yorkPending;
}

/** A landmark photo for a building, from Wikimedia Commons (web/scripts/build_photos.mjs). */
export interface Photo { src: string; page: string; title: string; artist: string; license: string; how: "name" }

let photosPending: Promise<Record<string, Photo>> | null = null;
/** Building name -> photo; empty when the index has not been built. */
export function loadPhotos(): Promise<Record<string, Photo>> {
  photosPending ??= fetch(`${import.meta.env.BASE_URL}data/photos.json`)
    .then((r) => (r.ok ? r.json() : { photos: {} }))
    .then((d: { photos?: Record<string, Photo> }) => d.photos ?? {})
    .catch(() => ({}));
  return photosPending;
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
    ...(s.walkDistM ? { walkDistM: Float64Array.from(s.walkDistM) } : {}),
    ...(s.siteName ? { siteName: [...s.siteName] } : {}),
  };
}
