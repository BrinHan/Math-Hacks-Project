// Client-side parsing of uploaded location files (CSV, GeoJSON / JSON, KML) into flat rows, header
// auto-detection, and conversion of mapped rows into sites or demand points.
import Papa from "papaparse";
import { CustomSite, DemandPoint, newId, normalizeKind } from "./dataset";

export type Row = Record<string, string>;
export interface ParsedFile { format: "csv" | "geojson" | "json" | "kml"; columns: string[]; rows: Row[] }

export type Field = "lat" | "lon" | "id" | "name" | "kind" | "weight" | "existing" | "mustInclude";
export type Mapping = Record<Field, string | null>;
export type Role = "sites" | "demand";

export const FIELD_LABELS: Record<Field, string> = {
  lat: "Latitude", lon: "Longitude", id: "Site ID", name: "Name", kind: "Site type",
  weight: "Demand weight", existing: "Existing AED", mustInclude: "Must include",
};
export const REQUIRED: Field[] = ["lat", "lon"];

// Normalised header -> field. Order matters: the first pattern that matches a header wins.
const PATTERNS: [Field, RegExp][] = [
  ["lat", /^(lat|latitude|latdd|latdeg|ylat|latwgs84)$/],
  ["lon", /^(lon|lng|long|longitude|londd|londeg|xlon|lonwgs84)$/],
  ["id", /^(id|siteid|fid|objectid|code|ref|number|no)$/],
  ["name", /^(name|sitename|title|label|building|buildingname|location|placename|description)$/],
  ["kind", /^(type|kind|sitetype|category|buildingtype|class|use|usage|landuse)$/],
  ["weight", /^(weight|demand|demandweight|population|pop|people|count|footfall|traffic|arrests|risk|occupancy)$/],
  ["existing", /^(existing|hasaed|aed|installed|existingaed|current)$/],
  ["mustInclude", /^(must|mustinclude|required|forced|pinned|mandatory)$/],
];
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- reading files ----------

export async function parseFile(file: File): Promise<ParsedFile> {
  const text = await file.text();
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "kml") return parseKml(text);
  if (ext === "json" || ext === "geojson") return parseJson(text);
  if (ext === "csv" || ext === "txt" || ext === "tsv") return parseCsv(text);
  // Unknown extension: sniff the content.
  const t = text.trimStart();
  if (t.startsWith("<")) return parseKml(text);
  if (t.startsWith("{") || t.startsWith("[")) return parseJson(text);
  return parseCsv(text);
}

export function parseCsv(text: string): ParsedFile {
  const res = Papa.parse<Row>(text.replace(/^﻿/, ""), {
    header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim(),
  });
  const columns = (res.meta.fields ?? []).filter((c) => c !== "");
  if (!columns.length) throw new Error("No header row found in the CSV.");
  return { format: "csv", columns, rows: res.data };
}

type Geometry = { type: string; coordinates: unknown };

/** [lon, lat] of a point, or the vertex average of a polygon / line (good enough for a building). */
function representativePoint(g: Geometry | null | undefined): [number, number] | null {
  if (!g) return null;
  const flat: number[][] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") flat.push(c as number[]);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  walk(g.coordinates);
  if (!flat.length) return null;
  if (g.type === "Point") return [flat[0][0], flat[0][1]];
  const lon = flat.reduce((s, p) => s + p[0], 0) / flat.length;
  const lat = flat.reduce((s, p) => s + p[1], 0) / flat.length;
  return [lon, lat];
}

const flatProps = (o: Record<string, unknown> | null | undefined): Row =>
  Object.fromEntries(Object.entries(o ?? {})
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));

export function parseJson(text: string): ParsedFile {
  const data = JSON.parse(text);
  const rows: Row[] = [];
  let format: ParsedFile["format"] = "json";
  if (data && (data.type === "FeatureCollection" || data.type === "Feature")) {
    format = "geojson";
    const features = data.type === "Feature" ? [data] : data.features ?? [];
    for (const f of features) {
      const pt = representativePoint(f.geometry);
      if (!pt) continue;
      rows.push({ ...flatProps(f.properties), ...(f.id !== undefined ? { id: String(f.id) } : {}),
        longitude: String(pt[0]), latitude: String(pt[1]) });
    }
  } else if (Array.isArray(data)) {
    for (const o of data) if (o && typeof o === "object") rows.push(flatProps(o));
  } else {
    throw new Error("JSON must be a GeoJSON FeatureCollection or an array of objects.");
  }
  if (!rows.length) throw new Error("No point features found in the file.");
  return { format, columns: unionColumns(rows), rows };
}

export function parseKml(text: string): ParsedFile {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("The KML file is not valid XML.");
  const rows: Row[] = [];
  for (const pm of Array.from(doc.getElementsByTagName("Placemark"))) {
    const coordText = pm.getElementsByTagName("coordinates")[0]?.textContent ?? "";
    const coords = coordText.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((c) => c.length >= 2 && c.every(Number.isFinite));
    if (!coords.length) continue;
    const isPoint = pm.getElementsByTagName("Point").length > 0;
    const lon = isPoint ? coords[0][0] : coords.reduce((s, c) => s + c[0], 0) / coords.length;
    const lat = isPoint ? coords[0][1] : coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const row: Row = {};
    const name = pm.getElementsByTagName("name")[0]?.textContent?.trim();
    if (name) row.name = name;
    const desc = pm.getElementsByTagName("description")[0]?.textContent?.trim();
    if (desc) row.description = desc;
    for (const d of Array.from(pm.getElementsByTagName("Data"))) {
      const key = d.getAttribute("name");
      if (key) row[key] = d.getElementsByTagName("value")[0]?.textContent?.trim() ?? "";
    }
    for (const d of Array.from(pm.getElementsByTagName("SimpleData"))) {
      const key = d.getAttribute("name");
      if (key) row[key] = d.textContent?.trim() ?? "";
    }
    row.longitude = String(lon);
    row.latitude = String(lat);
    rows.push(row);
  }
  if (!rows.length) throw new Error("No placemarks with coordinates found in the KML.");
  return { format: "kml", columns: unionColumns(rows), rows };
}

function unionColumns(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

// ---------- header detection ----------

export interface Detection { mapping: Mapping; role: Role; ambiguous: boolean; notes: string[] }

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : NaN;
};
const share = (rows: Row[], col: string, ok: (n: number) => boolean) => {
  const vals = rows.slice(0, 200).map((r) => num(r[col])).filter(Number.isFinite);
  return vals.length ? vals.filter(ok).length / vals.length : 0;
};
const isLat = (n: number) => n >= -90 && n <= 90;
const isLon = (n: number) => n >= -180 && n <= 180;

export function detectMapping(columns: string[], rows: Row[]): Detection {
  const mapping: Mapping = { lat: null, lon: null, id: null, name: null, kind: null, weight: null, existing: null, mustInclude: null };
  const notes: string[] = [];
  const candidates: Record<Field, string[]> = { lat: [], lon: [], id: [], name: [], kind: [], weight: [], existing: [], mustInclude: [] };
  for (const c of columns) {
    const n = norm(c);
    const hit = PATTERNS.find(([, re]) => re.test(n));
    if (hit) candidates[hit[0]].push(c);
  }
  for (const f of Object.keys(candidates) as Field[]) mapping[f] = candidates[f][0] ?? null;
  let ambiguous = false;

  // Plain x / y headers are only coordinates if their values look like degrees.
  if (!mapping.lat || !mapping.lon) {
    const xs = columns.filter((c) => /^x(coord)?$/.test(norm(c))), ys = columns.filter((c) => /^y(coord)?$/.test(norm(c)));
    if (!mapping.lon && xs[0]) { mapping.lon = xs[0]; ambiguous = true; notes.push(`Using "${xs[0]}" as longitude: check it holds degrees, not projected metres.`); }
    if (!mapping.lat && ys[0]) { mapping.lat = ys[0]; ambiguous = true; notes.push(`Using "${ys[0]}" as latitude: check it holds degrees, not projected metres.`); }
  }
  for (const f of ["lat", "lon"] as Field[]) {
    if (!mapping[f]) { ambiguous = true; notes.push(`No ${FIELD_LABELS[f].toLowerCase()} column recognised: choose one.`); }
    if (candidates[f].length > 1) { ambiguous = true; notes.push(`Several possible ${FIELD_LABELS[f].toLowerCase()} columns: ${candidates[f].join(", ")}.`); }
  }
  if (mapping.lat && mapping.lon) {
    const latOk = share(rows, mapping.lat, isLat), lonOk = share(rows, mapping.lon, isLon);
    if (latOk < 0.95 || lonOk < 0.95) {
      ambiguous = true;
      notes.push("Some coordinates are outside valid degree ranges: check the latitude and longitude columns.");
    } else if (share(rows, mapping.lat, (n) => Math.abs(n) > 60) > 0.9 && share(rows, mapping.lon, (n) => Math.abs(n) < 60) > 0.9) {
      notes.push("Latitude and longitude may be swapped (latitudes look like longitudes). Swap them if the map lands in the wrong place.");
    }
  }
  const role: Role = mapping.kind || mapping.existing || mapping.mustInclude ? "sites" : mapping.weight ? "demand" : "sites";
  return { mapping, role, ambiguous, notes };
}

// ---------- mapped rows -> sites / demand ----------

const truthy = (v: string | undefined) => /^(1|y|yes|true|t|x|✓|existing|installed|required)$/i.test(String(v ?? "").trim());

export interface Converted { sites: CustomSite[]; demand: DemandPoint[]; skipped: { row: number; reason: string }[] }

export function convertRows(rows: Row[], mapping: Mapping, role: Role): Converted {
  const out: Converted = { sites: [], demand: [], skipped: [] };
  const get = (r: Row, f: Field) => (mapping[f] ? r[mapping[f]!] : undefined);
  rows.forEach((r, i) => {
    const lat = num(get(r, "lat")), lon = num(get(r, "lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { out.skipped.push({ row: i + 1, reason: "missing coordinates" }); return; }
    if (!isLat(lat) || !isLon(lon)) { out.skipped.push({ row: i + 1, reason: "coordinates out of range" }); return; }
    const id = String(get(r, "id") ?? "").trim() || newId(role === "sites" ? "s" : "d");
    const name = String(get(r, "name") ?? "").trim() || (role === "sites" ? `Site ${out.sites.length + 1}` : `Point ${out.demand.length + 1}`);
    if (role === "sites") {
      out.sites.push({
        id, name, lat, lon, kind: normalizeKind(get(r, "kind")),
        existing: truthy(get(r, "existing")), mustInclude: truthy(get(r, "mustInclude")),
      });
    } else {
      const w = mapping.weight ? num(get(r, "weight")) : 1;
      if (!Number.isFinite(w) || w < 0) { out.skipped.push({ row: i + 1, reason: "invalid demand weight" }); return; }
      out.demand.push({ id, name, lat, lon, weight: w });
    }
  });
  return out;
}
