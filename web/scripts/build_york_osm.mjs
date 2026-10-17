// Build web/public/data/york-osm.json: York University's Keele campus from OpenStreetMap.
//
//   node web/scripts/build_york_osm.mjs          (uses web/scripts/cache/york_osm_raw.json if present)
//   node web/scripts/build_york_osm.mjs --fetch  (re-downloads from the Overpass API first)
//
// Buildings become candidate AED sites; mapped defibrillators mark their building as an existing AED.
// OpenStreetMap has no occupancy, so demand uses the team's per-type occupancy (aed/data/synthetic.py,
// PEOPLE, scaled by footprint area) plus the team's background density on open ground. Arrest rates use
// the team's parameters: incidence 55 / 100k / yr, public share 0.18, away-from-home share 0.313.
// Data (c) OpenStreetMap contributors, ODbL 1.0.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "cache", "york_osm_raw.json");
const OUT = join(HERE, "..", "public", "data", "york-osm.json");
const CAMPUS_WAY = 15396822; // "York University, Keele Campus"

const QUERY = `[out:json][timeout:120];
way(${CAMPUS_WAY});map_to_area->.campus;
(way["building"](area.campus);relation["building"](area.campus););out tags geom;
node["emergency"="defibrillator"](area.campus);out;
(node["amenity"~"^(library|restaurant|cafe|fast_food|food_court)$"](area.campus);node["leisure"~"^(sports_centre|fitness_centre|stadium)$"](area.campus);way["leisure"~"^(sports_centre|stadium)$"](area.campus););out tags center;
way(${CAMPUS_WAY});out geom;`;

// ---- team parameters (aed/params.py, aed/data/synthetic.py) ----
const INCIDENCE = 55, PUBLIC = 0.18, AWAY = 0.313;
const HOURS = [10, 6, 8];
const PEOPLE = { // people present in a building of relative size 1.0: day, evening, night
  academic: [800, 100, 0], library: [400, 300, 50], residential: [150, 500, 600],
  athletic: [200, 300, 0], dining: [300, 250, 0],
  // ASSUMPTION (not in the team table): transit stations and service buildings.
  other: [60, 25, 5],
};
const STATION_PEOPLE = [600, 300, 30]; // ASSUMPTION: subway entrances on campus
const BACKGROUND_PER_HA = [12.8, 7.7, 2.6];
const SIZE_REF_M2 = 4000; // ASSUMPTION: footprint of a "size 1.0" campus building
const MIN_AREA_M2 = 150;  // smaller unnamed structures (sheds, kiosks) are skipped
const SKIP_TYPES = new Set(["roof", "parking", "garage", "greenhouse", "industrial", "barn", "shed", "carport"]);

async function load() {
  if (process.argv.includes("--fetch") || !existsSync(CACHE)) {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "User-Agent": "MathHacks-AED-student-project" },
      body: new URLSearchParams({ data: QUERY }),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, await res.text());
  }
  return JSON.parse(readFileSync(CACHE, "utf8"));
}

// Local equirectangular metres around the campus centre: accurate to well under 1% at this scale.
const LAT0 = 43.7742, LON0 = -79.5049, M = 111_320, MLON = M * Math.cos((LAT0 * Math.PI) / 180);
const toXY = ([lat, lon]) => [(lon - LON0) * MLON, (lat - LAT0) * M];
const toLL = ([x, y]) => [LAT0 + y / M, LON0 + x / MLON];

function ringOf(el) {
  if (el.geometry) return el.geometry.map((p) => [p.lat, p.lon]);
  if (el.members) { // multipolygon: take the largest outer ring
    const outers = el.members.filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry.map((p) => [p.lat, p.lon]));
    return outers.sort((a, b) => Math.abs(areaCentroid(b).area) - Math.abs(areaCentroid(a).area))[0] ?? null;
  }
  return null;
}

function areaCentroid(ring) {
  const pts = ring.map(toXY);
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += f; cx += (pts[j][0] + pts[i][0]) * f; cy += (pts[j][1] + pts[i][1]) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { area: 0, xy: [mx, my] };
  }
  return { area: Math.abs(a), xy: [cx / (6 * a), cy / (6 * a)] };
}

function inside([x, y], poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function classify(tags, area) {
  const b = tags.building, name = (tags.name ?? "").toLowerCase(), amen = tags.amenity ?? "";
  if (amen === "library" || /librar/.test(name)) return "library";
  if (["apartments", "dormitory", "residential", "terrace", "house"].includes(b) || /residence|\bhall residence|apartments|townhouse/.test(name)) return "residential";
  if (["stadium", "grandstand", "sports_hall", "sports_centre"].includes(b) || tags.leisure || /sport|athlet|tait mckenzie|arena|stadium|\bice\b|fitness|aquatic|field ?house|tennis|\btrack\b/.test(name)) return "athletic";
  if (/dining|commons|food|cafeteria|eatery/.test(name)) return "dining";
  if (b === "train_station" || /station/.test(name)) return "station";
  if (["university", "college", "school"].includes(b) || /lecture|hall|building|centre|center|school|faculty|institute|science|engineering|arts|law|business|lab/.test(name)) return "academic";
  if (/utilit|physical resources|maintenance|storage|plant|garage|security/.test(name)) return "other";
  return area > 1500 ? "academic" : "other";
}

const round = (v, d = 6) => Number(v.toFixed(d));

async function main() {
  const raw = await load();
  const els = raw.elements;
  const campus = els.find((e) => e.type === "way" && e.id === CAMPUS_WAY && e.geometry);
  const campusRing = campus.geometry.map((p) => [p.lat, p.lon]);
  const campusXY = campusRing.map(toXY);

  const foodCourts = els.filter((e) => e.tags?.amenity === "food_court" && (e.lat ?? e.center?.lat) !== undefined)
    .map((e) => toXY([e.lat ?? e.center.lat, e.lon ?? e.center.lon]));
  const sites = [], demand = [], footprints = [];
  const bldgPolys = [];
  for (const el of els) {
    const t = el.tags ?? {};
    if (!t.building || SKIP_TYPES.has(t.building)) continue;
    const ring = ringOf(el);
    if (!ring || ring.length < 3) continue;
    const { area, xy } = areaCentroid(ring);
    if (area < MIN_AREA_M2 && !t.name) continue;
    let kind = classify(t, area);
    const station = kind === "station";
    if (station) kind = "other";
    // A mapped food court inside an otherwise academic building makes it a dining building.
    if (kind === "academic" && foodCourts.some((p) => inside(p, ring.map(toXY)))) kind = "dining";
    const size = Math.min(4, Math.max(0.15, area / SIZE_REF_M2));
    // ASSUMPTION (team range 30-120 s): time to reach the AED grows with building size.
    const floorDelayS = round(30 + 90 * Math.min(1, Math.max(0, Math.log(area / 200) / Math.log(20000 / 200))), 1);
    const [lat, lon] = toLL(xy);
    const id = `osm-${el.type[0]}${el.id}`;
    const name = station && t.name && !/station/i.test(t.name) ? `${t.name} station` : t.name ?? `${kind === "other" ? "Building" : kind[0].toUpperCase() + kind.slice(1) + " building"} (OSM ${el.type} ${el.id})`;
    sites.push({ id, name, lat: round(lat), lon: round(lon), kind, existing: false, mustInclude: false, floorDelayS, cost: 1 });
    const people = (station ? STATION_PEOPLE : PEOPLE[kind]).map((p) => p * size);
    demand.push({ id: `${id}-d`, name, lat: round(lat), lon: round(lon), weight: 0, periodWeights: people });
    footprints.push({ id, ring: ring.map(([a, b]) => [round(a), round(b)]) });
    bldgPolys.push({ siteIndex: sites.length - 1, poly: ring.map(toXY) });
  }

  // Background foot traffic on open ground inside the campus boundary (team: people per hectare).
  const xs = campusXY.map((p) => p[0]), ys = campusXY.map((p) => p[1]);
  const STEP = 100; // one point per hectare
  for (let x = Math.min(...xs) + STEP / 2; x < Math.max(...xs); x += STEP) {
    for (let y = Math.min(...ys) + STEP / 2; y < Math.max(...ys); y += STEP) {
      if (!inside([x, y], campusXY) || bldgPolys.some((b) => inside([x, y], b.poly))) continue;
      const [lat, lon] = toLL([x, y]);
      demand.push({ id: `bg-${Math.round(x)}-${Math.round(y)}`, name: "Open ground", lat: round(lat), lon: round(lon), weight: 0, periodWeights: [...BACKGROUND_PER_HA] });
    }
  }

  // People -> expected public arrests per year, per period (team formula).
  let total = 0;
  for (const d of demand) {
    d.periodWeights = d.periodWeights.map((p, k) => p * (INCIDENCE / 1e5) * (PUBLIC / AWAY) * (HOURS[k] / 24));
    d.weight = d.periodWeights.reduce((a, b) => a + b, 0);
    total += d.weight;
    d.periodWeights = d.periodWeights.map((v) => Number(v.toPrecision(6)));
    d.weight = Number(d.weight.toPrecision(6));
  }

  // Mapped defibrillators: the building containing one gets an existing AED; otherwise a new site.
  const aeds = els.filter((e) => e.tags?.emergency === "defibrillator" && e.lat !== undefined);
  for (const a of aeds) {
    const p = toXY([a.lat, a.lon]);
    const hit = bldgPolys.find((b) => inside(p, b.poly));
    if (hit) sites[hit.siteIndex].existing = true;
    else sites.push({ id: `osm-n${a.id}`, name: "Mapped AED (OpenStreetMap)", lat: round(a.lat), lon: round(a.lon), kind: "outdoor", existing: true, mustInclude: false });
  }

  const out = {
    name: "York University · Keele campus (OpenStreetMap)",
    attribution: "Building and AED locations © OpenStreetMap contributors (ODbL). Occupancy is modelled, not measured.",
    fetched: new Date().toISOString().slice(0, 10),
    campus: campusRing.map(([a, b]) => [round(a), round(b)]),
    footprints,
    sites, demand, arrestsPerYear: Number(total.toPrecision(6)),
    stats: { buildings: footprints.length, named: sites.filter((s) => !s.name.includes("(OSM ")).length, mappedAeds: aeds.length },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const kinds = {};
  for (const s of sites) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  console.log(`wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB): ${sites.length} sites ${JSON.stringify(kinds)}, ` +
    `${demand.length} demand points, ${out.arrestsPerYear.toFixed(2)} public arrests/yr, ${aeds.length} mapped AED(s), ` +
    `${sites.filter((s) => s.existing).length} existing site(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
