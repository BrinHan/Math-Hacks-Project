// AED placement demo (Plan 3): budget slider, ambulance time, time-of-day selector, Leaflet map.
// One placement serves every period (spec section 5); switching period never re-optimizes.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { evaluate } from "./model/coverage";
import { metresToLatLon } from "./model/instance";
import { CITATIONS } from "./model/params";
import type { Solution } from "./model/solvers";
import { LeadData, leadInstance, loadLead, loadPhotos, loadYork, Photo, YorkData } from "./data";
import { drawKCurve, drawTornado } from "./charts";
import { scenario, setInstance, setLeadInstance, Source, sourceKey } from "./scenario";
import type { IlpReply, IlpRequest } from "./ilpWorker";
import {
  CustomDataset, datasetFromInstance, datasetToInstance, KINDS, loadDataset, newId, saveDataset,
} from "./custom/dataset";
import { initUpload, ImportResult } from "./custom/upload";

// Fastest-AED bands on the map (seconds); anything at or past EMS arrival is "unreached".
const BANDS = [
  { edge: 120, colour: "#1a9850", label: "≤ 2 min" },
  { edge: 240, colour: "#91cf60", label: "2–4 min" },
  { edge: 360, colour: "#fee08b", label: "4–6 min" },
  { edge: Infinity, colour: "#fc8d59", label: "6 min – EMS" },
];
const UNREACHED = "#d73027";
const ACCENT = "#ededed"; // selection ring on the map
// Recommended AEDs carry the accent red; installed ones are light; both read apart from the time bands.
const SITE = { existing: "#ededed", new: "#da0037", locked: "#6a6a6a" };
const OUTLINE = "#171717"; // marker outline against the dark map
const MUST = "#f9ab00"; // dashed outline on must-include sites
// Muted, low-chroma tags so building type reads as metadata, not as another status colour.
const KIND_COLOURS: Record<string, string> = {
  academic: "#9a8fbf", library: "#7f9fbf", residential: "#86a88f",
  athletic: "#b8a37a", dining: "#b8917a", outdoor: "#a3a3a3",
};
const PERIOD_NAMES: Record<string, string> = {
  day: "Day", evening: "Evening", night: "Night",
  // York team model: five weekly periods
  weekday_morning: "Weekday morning", weekday_afternoon: "Weekday afternoon",
  weekday_evening: "Weekday evening", weekend: "Weekend",
};
const PERIOD_HOURS_TEXT: Record<string, string> = {
  day: "8am–6pm", evening: "6pm–midnight", night: "midnight–8am",
  weekday_morning: "Mon–Fri 8am–1pm", weekday_afternoon: "Mon–Fri 1pm–6pm",
  weekday_evening: "Mon–Fri 6pm–midnight", weekend: "Sat–Sun 8am–midnight",
};
const svg = (d: string, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// Sun, sun on the horizon (dusk), crescent moon.
const PERIOD_ICON_PATHS: Record<string, string> = {
  day: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  evening: '<path d="M7 18a5 5 0 0 1 10 0"/><path d="M2 18h20M12 6v3M4.6 10.6l1.6 1.6M19.4 10.6l-1.6 1.6M6 22h12"/>',
  night: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
};
PERIOD_ICON_PATHS.weekday_morning = PERIOD_ICON_PATHS.day;
PERIOD_ICON_PATHS.weekday_afternoon = PERIOD_ICON_PATHS.day;
PERIOD_ICON_PATHS.weekday_evening = PERIOD_ICON_PATHS.evening;
// Calendar page for the weekend.
PERIOD_ICON_PATHS.weekend = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>';
const periodIcon = (p: string, size?: number) => svg(PERIOD_ICON_PATHS[p] ?? PERIOD_ICON_PATHS.day, size);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  budget: $<HTMLInputElement>("budget"),
  budgetOut: $("budgetOut"),
  budgetVal: $<HTMLOutputElement>("budgetVal"),
  ems: $<HTMLInputElement>("ems"),
  emsOut: $("emsOut"),
  emsVal: $<HTMLOutputElement>("emsVal"),
  periods: $("periods"),
  uploadBtn: $<HTMLButtonElement>("uploadBtn"),
  copyBtn: $<HTMLButtonElement>("copyBtn"),
  clearBtn: $<HTMLButtonElement>("clearBtn"),
  arrestsField: $("arrestsField"),
  arrests: $<HTMLInputElement>("arrests"),
  sites: $<HTMLUListElement>("sites"),
  sortSel: $<HTMLSelectElement>("sortSel"),
  search: $<HTMLInputElement>("search"),
  summary: $<HTMLButtonElement>("summary"),
  summaryTitle: $("summaryTitle"),
  summaryBody: $("summaryBody"),
  params: $<HTMLTableElement>("params"),
  busy: $("busy"),
  busyText: $("busyText"),
  siteCount: $("siteCount"),
  datasetSeg: $("datasetSeg"),
  customOpt: $("customOpt"),
  yorkOpt: $("yorkOpt"),
  datasetNote: $("datasetNote"),
  charts: $("charts"),
  kcurve: $("kcurve"),
  tornado: $("tornado"),
};

type SortKey = "rec" | "name" | "open" | "freq";
type Show = "all" | "new" | "existing";
const state = {
  period: 0,
  solution: null as Solution | null,
  selected: null as number | null, // the expanded site in the list (and ringed on the map)
  sort: "rec" as SortKey,
  show: "all" as Show,
  query: "",
};
let photos: Record<string, Photo> = {};
const solveCache = new Map<string, Solution>();

let lead: LeadData | null = null; // the lead's exported campus + results, if present

// Uploaded or drawn locations. Every edit bumps `customVer`, which keys the scenario and solve caches.
let custom: CustomDataset | null = loadDataset();
// York University's real buildings from OpenStreetMap, if the export is present.
let york: YorkData | null = null;
let customVer = 0;

const datasetChoice = () => document.querySelector<HTMLInputElement>("input[name=dataset]:checked")?.value;
const settings = () => {
  const c = datasetChoice();
  const source: Source = c === "lead" && lead ? { kind: "lead" }
    : c === "york" && york ? { kind: "york" }
    : c === "custom" && custom ? { kind: "custom", version: customVer }
    : lead ? { kind: "lead" }
    // No team export: the app's placeholder campus keeps the page usable.
    : { kind: "synthetic", seed: 0 };
  return { source, budget: Number(ui.budget.value), emsResponseS: Number(ui.ems.value) * 60 };
};
const isCustom = () => settings().source.kind === "custom";
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// ---------- map ----------
const map = L.map("map", { preferCanvas: true, zoomControl: false, maxBoundsViscosity: 1.0, zoomSnap: 0.5 });
// Esri Dark Gray Canvas (no API key): a quiet dark base, with its street labels in a pane above the
// reach rings so names stay readable.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
  maxZoom: 19, maxNativeZoom: 16,
  attribution: '&copy; Esri &middot; &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.createPane("labels");
map.getPane("labels")!.style.zIndex = "390";
map.getPane("labels")!.style.pointerEvents = "none";
L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, maxNativeZoom: 16, pane: "labels" }).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
L.control.zoom({ position: "bottomright" }).addTo(map);
// Layers, toggled from the control at the top right. Each is cleared and refilled on redraw, so the
// control's on/off state persists.
const heatLayer = L.layerGroup().addTo(map);       // reach zones around open AEDs
// One pane per band, outermost lowest; pane opacity gives a clean union of overlapping rings.
const ZONE_COLOURS = ["#1a9850", "#91cf60", "#fee08b", "#fc8d59"]; // ≤2, 2–4, 4–6 min, 6 min – ambulance
const ZONE_OPACITY = [0.42, 0.34, 0.3, 0.24];
const zoneRenderers = ZONE_COLOURS.map((_, b) => {
  const name = `zone${b}`;
  map.createPane(name);
  const pane = map.getPane(name)!;
  pane.style.zIndex = String(380 - b);
  pane.style.opacity = String(ZONE_OPACITY[b]);
  pane.style.pointerEvents = "none";
  return L.canvas({ pane: name, padding: 0.5 });
});
const demandLayer = L.layerGroup();                // raw demand points
const candidateLayer = L.layerGroup();             // candidate sites without an AED
const existingLayer = L.layerGroup().addTo(map);   // existing AEDs
const newLayer = L.layerGroup().addTo(map);        // AEDs the optimizer recommends (and must-include)
const buildingLayer = L.layerGroup().addTo(map);   // real building footprints (York dataset)
// "Map details": layer toggles shown in a popover from the pill bar, like the other settings.
const LAYERS: [string, L.LayerGroup][] = [
  ["AED reach zones", heatLayer],
  ["Recommended AEDs", newLayer],
  ["Existing AEDs", existingLayer],
  ["Candidate AED sites", candidateLayer],
  ["Demand points", demandLayer],
  ["Building outlines", buildingLayer],
];
{
  const field = document.createElement("div");
  field.className = "field";
  field.id = "layersField";
  field.innerHTML = '<span class="flabel">Map details</span><p class="note">Choose what to draw on the map.</p>';
  const list = document.createElement("div");
  list.className = "layer-toggles";
  for (const [label, layer] of LAYERS) {
    const row = document.createElement("label");
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: map.hasLayer(layer) });
    box.addEventListener("change", () => (box.checked ? layer.addTo(map) : layer.remove()));
    row.append(box, document.createTextNode(label));
    list.append(row);
  }
  field.append(list);
  document.getElementById("fieldStore")!.append(field);
}

let fittedFor = "";
let viewBounds: L.LatLngBounds | null = null;
let viewLoose = false; // custom data: allow a little zoom-out and panning so points can be added nearby

/** Fit the dataset and limit the view to it: zoom-out stops at the data, panning stays near it. */
function lockToData(animate = false) {
  if (!viewBounds) return;
  map.invalidateSize();
  map.setMinZoom(0); // let fitBounds pick the zoom before clamping to it
  map.setMaxBounds(undefined as unknown as L.LatLngBounds);
  const { tl, br } = viewPadding();
  // The lock is taken from the fitted view (which leaves room for the panel), not the raw data,
  // so panning never pushes the data back under the panel.
  const lock = () => {
    map.setMinZoom(Math.max(0, map.getZoom() - (viewLoose ? 2 : 0)));
    map.setMaxBounds(map.getBounds().pad(viewLoose ? 0.75 : 0.15));
  };
  if (animate && !document.hidden && !reducedMotion.matches) {
    map.once("moveend", lock);
    map.flyToBounds(viewBounds, { paddingTopLeft: tl, paddingBottomRight: br, duration: 0.8 });
  } else {
    map.fitBounds(viewBounds, { paddingTopLeft: tl, paddingBottomRight: br, animate: false });
    lock();
  }
}

/** Screen space taken by floating UI, so fitted data lands in the visible part of the map. */
function viewPadding(): { tl: L.Point; br: L.Point } {
  const open = document.body.classList.contains("panel-open");
  const mapTop = map.getContainer().getBoundingClientRect().top;
  const filtersBottom = document.getElementById("filters")!.getBoundingClientRect().bottom - mapTop;
  if (window.innerWidth <= 700) {
    // The bottom sheet's final height, not its mid-slide position.
    const sheet = open ? window.innerHeight * 0.58 : 76;
    return { tl: L.point(16, filtersBottom + 12), br: L.point(16, sheet + 24) };
  }
  const panelRight = document.getElementById("panel")!.getBoundingClientRect().right;
  return { tl: L.point(open ? panelRight + 36 : 96, filtersBottom + 24), br: L.point(140, 48) };
}
// The container can change size after first paint (fonts, layout breakpoints); refit then.
let lastSize = "";
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  const size = `${Math.round(width)}x${Math.round(height)}`;
  if (size === lastSize) return; // ignore no-op notifications so a fly-to is never cancelled
  lastSize = size;
  lockToData();
}).observe(document.getElementById("map")!);

/** Geographic bounds of everything in the instance (grid cells padded by half a cell). */
function instanceBounds(inst: ReturnType<typeof scenario>["inst"]): L.LatLngBounds {
  const half = inst.cellSizeM / 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const take = (x: number, y: number, pad: number) => {
    minX = Math.min(minX, x - pad); maxX = Math.max(maxX, x + pad);
    minY = Math.min(minY, y - pad); maxY = Math.max(maxY, y + pad);
  };
  for (let i = 0; i < inst.nCells; i++) take(inst.cellXY[2 * i], inst.cellXY[2 * i + 1], half);
  for (let j = 0; j < inst.nSites; j++) take(inst.siteXY[2 * j], inst.siteXY[2 * j + 1], 0);
  if (!Number.isFinite(minX)) { minX = minY = -250; maxX = maxY = 250; }
  // Keep a minimum span so a single point does not zoom to street level.
  const span = 300;
  if (maxX - minX < span) { const c = (minX + maxX) / 2; minX = c - span / 2; maxX = c + span / 2; }
  if (maxY - minY < span) { const c = (minY + maxY) / 2; minY = c - span / 2; maxY = c + span / 2; }
  const sw = metresToLatLon(minX, minY, inst.originLatLon), ne = metresToLatLon(maxX, maxY, inst.originLatLon);
  return L.latLngBounds([sw, ne]);
}

const legend = new L.Control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  const item = (colour: string, label: string, dot = false) =>
    `<li><i class="${dot ? "dot" : ""}" style="background:${colour}${dot ? `;box-shadow:0 0 0 2px #171717,0 0 0 3px ${colour}` : ""}"></i>${label}</li>`;
  div.innerHTML =
    `<button type="button" class="legend-toggle" aria-expanded="true"><h3>Legend</h3></button>` +
    `<div class="legend-body"><h3>AED reached and back within</h3><ul>` +
    BANDS.map((b, k) => item(b.colour, k === BANDS.length - 1 ? "6 min – before ambulance" : b.label)).join("") +
    `</ul><p class="note">Outside the rings the ambulance gets there first.</p><hr />` +
    `<h3>AEDs</h3><ul>` +
    item(SITE.existing, "Existing", true) + item(SITE.new, "New", true) + item(SITE.locked, "Locked this period", true) +
    `</ul></div>`;
  const toggle = div.querySelector<HTMLButtonElement>(".legend-toggle")!;
  const setCollapsed = (c: boolean) => {
    div.classList.toggle("collapsed", c);
    toggle.setAttribute("aria-expanded", String(!c));
  };
  toggle.addEventListener("click", () => setCollapsed(!div.classList.contains("collapsed")));
  setCollapsed(true); // starts folded; one tap opens it
  L.DomEvent.disableClickPropagation(div);
  L.DomEvent.disableScrollPropagation(div);
  return div;
};
legend.addTo(map);

function bandColour(t: number, emsS: number) {
  if (t >= emsS) return UNREACHED;
  return BANDS.find((b) => t <= b.edge)!.colour;
}

let refitPending = false; // set by imports and copies: fly to the new data on the next draw

function drawMap() {
  const { source, emsResponseS } = settings();
  const { inst, tau } = scenario(source, emsResponseS);
  const x = state.solution?.x ?? inst.siteExisting;
  const q = state.period, P = inst.periods.length, J = inst.nSites;
  const ll = (mx: number, my: number) => metresToLatLon(mx, my, inst.originLatLon);
  const editable = source.kind === "custom";
  const name = (j: number) => esc(inst.siteName?.[j] ?? `Site ${j}`);

  for (const g of [heatLayer, demandLayer, candidateLayer, existingLayer, newLayer, buildingLayer]) g.clearLayers();
  if (source.kind === "lead" && lead?.footprints?.length) {
    // The York team model's building footprints (OpenStreetMap), under the heatmap.
    for (const fp of lead.footprints) {
      L.polygon(fp.ring, { color: "#8a8a8a", weight: 1, opacity: 0.7, fillColor: "#ededed", fillOpacity: 0.05, interactive: false })
        .bindTooltip(esc(fp.name ?? ""), { sticky: true }).addTo(buildingLayer);
    }
  } else if (source.kind === "york" && york) {
    // Campus boundary and real footprints, drawn under the heatmap so colours stay readable.
    L.polygon(york.campus, { color: "#8a8a8a", weight: 1.5, dashArray: "6 5", fill: false, interactive: false }).addTo(buildingLayer);
    for (const fp of york.footprints) {
      L.polygon(fp.ring, { color: "#8a8a8a", weight: 1, opacity: 0.7, fillColor: "#ededed", fillOpacity: 0.05, interactive: false }).addTo(buildingLayer);
    }
  }
  markers.clear();

  // Reach zones: for every AED that is open now, rings in real metres showing how far a bystander can
  // fetch it and get back within 2 / 4 / 6 minutes and before the ambulance. Geographic circles grow
  // with the map as you zoom in. Each band has its own semi-transparent pane, so overlapping rings of
  // the same band merge into one shape instead of stacking darker.
  const { params } = scenario(source, emsResponseS);
  const perMetre = (2 * params.detourFactor) / params.walkSpeedMps; // seconds per metre of distance
  const edges = [...BANDS.map((b) => Math.min(b.edge, emsResponseS)), emsResponseS];
  for (let j = 0; j < J; j++) {
    if (!x[j] || !inst.siteOpen[j * P + q]) continue;
    const pos = ll(inst.siteXY[2 * j], inst.siteXY[2 * j + 1]);
    const slack = params.dispatchDelayS + inst.siteFloorDelay[j];
    for (let b = ZONE_COLOURS.length - 1; b >= 0; b--) {
      const radius = Math.min(params.maxTauS, edges[b]) > slack ? (Math.min(params.maxTauS, edges[b]) - slack) / perMetre : 0;
      if (radius <= 0) continue;
      L.circle(pos, { radius, renderer: zoneRenderers[b], stroke: false, fillColor: ZONE_COLOURS[b], fillOpacity: 1, interactive: false })
        .addTo(heatLayer);
    }
  }
  for (let i = 0; i < inst.nCells; i++) {
    const dot = L.circleMarker(ll(inst.cellXY[2 * i], inst.cellXY[2 * i + 1]), { radius: editable ? 3.5 : 2.5, color: OUTLINE, weight: editable ? 1 : 0, fillColor: "#9e9e9e", fillOpacity: 0.85 })
      .bindTooltip("Demand point").addTo(demandLayer);
    if (editable) dot.on("click", (e) => { L.DomEvent.stop(e); openDemandEditor(i); });
  }

  for (let j = 0; j < J; j++) {
    const open = inst.siteOpen[j * P + q] === 1;
    const pos = ll(inst.siteXY[2 * j], inst.siteXY[2 * j + 1]);
    const forced = inst.siteForced?.[j] === 1;
    if (x[j]) {
      const role = inst.siteExisting[j] ? "existing" : "new";
      const m = L.circleMarker(pos, {
        radius: MARKER_R, fillOpacity: 1, fillColor: open ? SITE[role] : SITE.locked,
        // Must-include sites get a dashed white outline so they read as a planner's pin.
        color: forced ? MUST : OUTLINE, weight: forced ? 3 : 2, dashArray: forced ? "3 2" : undefined,
      }).bindTooltip(`<b>${name(j)}</b> · ${role === "new" ? (forced ? "Must-include" : "Recommended") : "Existing"} AED<br>${cap(inst.siteKind[j])}${open ? "" : " · locked this period"}`)
        .addTo(role === "existing" ? existingLayer : newLayer);
      markers.set(j, m);
      wireSite(m, j, true);
    } else {
      const m = L.circleMarker(pos, {
        radius: editable ? 4.5 : 3, color: OUTLINE, weight: 1, fillColor: "#9e9e9e", fillOpacity: open ? 0.9 : 0.35,
      }).bindTooltip(`${name(j)} · candidate<br>${cap(inst.siteKind[j])}`).addTo(candidateLayer);
      wireSite(m, j, false);
    }
  }

  const key = sourceKey(source).replace(/^custom\d+$/, "custom");
  if (fittedFor !== key || refitPending) {
    viewBounds = instanceBounds(inst);
    viewLoose = editable;
    lockToData(refitPending);
    fittedFor = key;
    refitPending = false;
  }
  drawSelection();
}

// ---------- selection (table row <-> map marker) ----------
const MARKER_R = 7;
const markers = new Map<number, L.CircleMarker>();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
// The ring lives in its own SVG pane above the canvas overlay so it can carry a CSS class
// and is never painted over by cells or markers.
map.createPane("selection");
map.getPane("selection")!.style.zIndex = "460";
map.getPane("selection")!.style.pointerEvents = "none";
const ringRenderer = L.svg({ padding: 0.5, pane: "selection" });
let ring: L.CircleMarker | null = null;

function drawSelection() {
  ring?.remove();
  ring = null;
  const m = state.selected === null ? undefined : markers.get(state.selected);
  if (!m) return;
  ring = L.circleMarker(m.getLatLng(), {
    renderer: ringRenderer, pane: "selection", radius: 13, color: ACCENT, weight: 2.5,
    fill: true, fillColor: ACCENT, fillOpacity: 0.12, interactive: false, className: "sel-ring",
  }).addTo(map);
  m.bringToFront();
}

/** Expand a site in the list (or fold it if it is already open) and ring it on the map. */
function selectSite(j: number | null, opts: { pan?: boolean; scrollRow?: boolean } = {}) {
  state.selected = state.selected === j ? null : j;
  drawSelection();
  if (state.selected !== null && !document.body.classList.contains("panel-open")) setPanel(true, false);
  let opened: HTMLElement | null = null;
  ui.sites.querySelectorAll<HTMLLIElement>("li[data-site]").forEach((li) => {
    const on = Number(li.dataset.site) === state.selected;
    if (on && !li.querySelector(".detail")) li.querySelector(".inner")!.replaceChildren(buildDetail(Number(li.dataset.site)));
    li.classList.toggle("open", on);
    li.querySelector(".site-row")!.setAttribute("aria-expanded", String(on));
    if (on) opened = li;
  });
  // Selecting from the map can pick a site the list filter hides: redraw so it shows.
  if (state.selected !== null && !opened) { drawList(); opened = ui.sites.querySelector<HTMLElement>("li.open"); }
  if (opened && opts.scrollRow) {
    const li = opened as HTMLElement;
    // Wait for the expansion to settle so the scroll lands on the final layout.
    setTimeout(() => li.scrollIntoView({ block: "start", behavior: reducedMotion.matches ? "auto" : "smooth" }), reducedMotion.matches ? 0 : 360);
  }
  const m = state.selected === null ? undefined : markers.get(state.selected);
  if (m && opts.pan) flyToSite(m.getLatLng());
}

function flyToSite(at: L.LatLng) {
  const zoom = Math.max(map.getZoom(), map.getMinZoom() + 1);
  // Centre the site in the part of the map the panel does not cover.
  const { tl, br } = viewPadding();
  const centre = map.unproject(map.project(at, zoom).subtract(L.point((tl.x - br.x) / 2, (tl.y - br.y) / 2)), zoom);
  // Jump instead of flying when motion is unwanted or cannot play (hidden page: no animation frames).
  if (document.hidden || reducedMotion.matches) map.setView(centre, zoom, { animate: false });
  else map.flyTo(centre, zoom, { duration: 0.6 });
}

function hoverSite(j: number | null) {
  markers.forEach((m, k) => m.setRadius(k === j ? MARKER_R + 3 : MARKER_R));
  if (j !== null) markers.get(j)?.bringToFront();
}

// ---------- custom data: commit, tools, editors ----------

/**
 * Apply an edit to the custom dataset: save it, rebuild the model instance under a new version and
 * re-solve. Until the new answer arrives, the previous plan is carried over by site id.
 */
function commitCustom(opts: { refit?: boolean } = {}) {
  if (!custom) return;
  const prevChosen = new Set<string>();
  if (isCustom() && state.solution) {
    const prev = scenario(settings().source, settings().emsResponseS).inst;
    state.solution.x.forEach((v, j) => { if (v && !prev.siteExisting[j] && prevIds[j]) prevChosen.add(prevIds[j]); });
  }
  saveDataset(custom);
  customVer++;
  const inst = datasetToInstance(custom);
  setInstance({ kind: "custom", version: customVer }, inst);
  prevIds = custom.sites.map((s) => s.id);
  updateCustomUi();
  if (opts.refit) refitPending = true;
  if (isCustom()) {
    const x = Uint8Array.from(custom.sites, (s) => (s.existing || s.mustInclude || prevChosen.has(s.id) ? 1 : 0));
    state.solution = state.solution ? { ...state.solution, x, status: "updating" } : null;
    if (state.selected !== null && state.selected >= custom.sites.length) state.selected = null;
    render();
    resolveSoon(400);
  }
}
let prevIds: string[] = custom?.sites.map((s) => s.id) ?? [];

function updateCustomUi() {
  const radio = document.querySelector<HTMLInputElement>("input[name=dataset][value=custom]")!;
  radio.disabled = !custom;
  const on = isCustom();
  ui.arrestsField.hidden = !on;
  ui.copyBtn.hidden = on;
  editControl.getContainer()?.classList.toggle("hidden", !on);
  if (!on) setTool("select");
  if (custom && on) {
    ui.arrests.value = String(Number(custom.arrestsPerYear.toFixed(3)));
    const d = custom.demand.length;
    ui.datasetNote.textContent = `${esc(custom.name)} · ${custom.sites.length} sites · ${d ? `${d} demand points` : "uniform demand"}`;
    // Budget can reach every candidate on bigger uploads.
    ui.budget.max = String(Math.max(30, Math.min(200, custom.sites.length)));
  } else {
    ui.budget.max = "30";
    if (Number(ui.budget.value) > 30) ui.budget.value = "30";
    if (york && settings().source.kind === "york") {
      ui.datasetNote.textContent = `Quick sketch: ${york.stats.buildings} OpenStreetMap buildings · ${york.stats.mappedAeds} AED mapped there · not the team model`;
    } else if (lead && datasetChoice() === "lead") {
      const ks = lead.results.kCurve.map((r) => r.K);
      const existing = lead.instance.siteExisting.reduce((a, b) => a + b, 0);
      ui.datasetNote.textContent = lead.source.campus === "york"
        ? `York Keele team model · ${existing} published AEDs · walking paths · K = ${Math.min(...ks)}–${Math.max(...ks)} solved`
        : `Team campus · seed ${lead.source.seed} · K = ${Math.min(...ks)}–${Math.max(...ks)} solved`;
    } else if (!lead) {
      ui.datasetNote.textContent = "Team export missing (run web/scripts/export_data.py): showing a placeholder campus";
    }
  }
  ui.datasetSeg.hidden = !custom && !york;
  ui.customOpt.hidden = !custom;
  ui.yorkOpt.hidden = !york;
  ui.budget.parentElement!.querySelector(".scale span:last-child")!.textContent = ui.budget.max;
  const kind = settings().source.kind;
  document.getElementById("dataOut")!.textContent = kind === "custom" ? (custom?.name || "My data")
    : kind === "york" ? "OSM sketch" : kind === "lead" ? (lead?.source.campus === "york" ? "York Keele" : "Team campus") : "Placeholder campus";
  syncRangeLabels();
}

function selectDataset(value: "lead" | "york" | "custom") {
  const r = document.querySelector<HTMLInputElement>(`input[name=dataset][value=${value}]`)!;
  r.disabled = false;
  r.checked = true;
  onSourceChange();
}

// Map tool: select (click to edit, drag to move), or click-to-add a site / demand point.
type Tool = "select" | "site" | "demand";
let tool: Tool = "select";
const editControl = new L.Control({ position: "topleft" });
editControl.onAdd = () => {
  const div = L.DomUtil.create("div", "leaflet-bar edit-tools hidden");
  const btn = (t: Tool, title: string, svg: string) =>
    `<a href="#" role="button" data-tool="${t}" title="${title}" aria-label="${title}" aria-pressed="${t === tool}">${svg}</a>`;
  div.innerHTML =
    btn("select", "Select: click a marker to edit it, drag a site to move it", '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 3l14 8-6 2-3 6z"/></svg>') +
    btn("site", "Click to add a candidate AED site", '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><path d="M12 9v6M9 12h6"/></svg>') +
    btn("demand", "Click to add a demand point", '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>');
  L.DomEvent.disableClickPropagation(div);
  div.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-tool]");
    if (!a) return;
    e.preventDefault();
    setTool(a.dataset.tool as Tool);
  });
  return div;
};
editControl.addTo(map);
const toolHint = L.DomUtil.create("div", "tool-hint", map.getContainer());
toolHint.hidden = true;

function setTool(t: Tool) {
  tool = t;
  editControl.getContainer()?.querySelectorAll("a[data-tool]").forEach((a) => {
    const on = (a as HTMLElement).dataset.tool === t;
    a.classList.toggle("on", on);
    a.setAttribute("aria-pressed", String(on));
  });
  map.getContainer().classList.toggle("adding", t !== "select");
  toolHint.hidden = t === "select";
  toolHint.textContent = t === "site" ? "Click the map to add a candidate AED site · Esc to stop"
    : t === "demand" ? "Click the map to add a demand point · Esc to stop" : "";
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && tool !== "select") setTool("select"); });

map.on("click", (e: L.LeafletMouseEvent) => {
  if (!custom || !isCustom() || tool === "select") return;
  const { lat, lng } = e.latlng;
  if (tool === "site") {
    custom.sites.push({ id: newId("s"), name: `Site ${custom.sites.length + 1}`, lat, lon: lng, kind: "other", existing: false, mustInclude: false });
    commitCustom();
    openSiteEditor(custom.sites.length - 1);
  } else {
    custom.demand.push({ id: newId("d"), name: `Point ${custom.demand.length + 1}`, lat, lon: lng, weight: 100 });
    commitCustom();
    openDemandEditor(custom.demand.length - 1);
  }
});

// Drag a site marker to move it (custom data, select tool). A press without movement is a click.
let dragJustEnded = false;
function wireSite(m: L.CircleMarker, j: number, selectable: boolean) {
  m.on("click", (e) => {
    L.DomEvent.stop(e);
    if (dragJustEnded) { dragJustEnded = false; return; }
    if (isCustom()) openSiteEditor(j);
    else if (selectable) selectSite(j, { scrollRow: true });
  });
  if (!isCustom()) return;
  m.on("mousedown", (e: L.LeafletMouseEvent) => {
    if (tool !== "select") return;
    L.DomEvent.stop(e);
    const start = e.containerPoint;
    let moved = false;
    map.dragging.disable();
    const onMove = (ev: L.LeafletMouseEvent) => {
      if (!moved && ev.containerPoint.distanceTo(start) < 4) return;
      moved = true;
      m.setLatLng(ev.latlng);
    };
    const onUp = () => {
      map.off("mousemove", onMove);
      map.off("mouseup", onUp);
      document.removeEventListener("mouseup", onUp);
      map.dragging.enable();
      if (!moved || !custom) return;
      dragJustEnded = true;
      setTimeout(() => { dragJustEnded = false; }, 50);
      const p = m.getLatLng();
      Object.assign(custom.sites[j], { lat: p.lat, lon: p.lng });
      editRing?.setLatLng(p);
      commitCustom();
    };
    map.on("mousemove", onMove);
    map.on("mouseup", onUp);
    document.addEventListener("mouseup", onUp);
  });
}

// Editor popups pan into view (with room for the controls) instead of being clipped at the map edge.
// The editor is a panel docked in the map corner (never clipped by the map edge), with a dashed ring
// on the item being edited.
const inspector = L.DomUtil.create("div", "inspector", map.getContainer());
inspector.hidden = true;
L.DomEvent.disableClickPropagation(inspector);
L.DomEvent.disableScrollPropagation(inspector);
let editRing: L.CircleMarker | null = null;

function showInspector(content: HTMLElement, at: L.LatLngExpression) {
  const close = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn insp-close", ariaLabel: "Close editor" });
  close.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  close.addEventListener("click", hideInspector);
  inspector.replaceChildren(close, content);
  inspector.hidden = false;
  editRing?.remove();
  editRing = L.circleMarker(at, {
    renderer: ringRenderer, pane: "selection", radius: 12, color: "#ededed", weight: 2, dashArray: "4 3",
    fill: false, interactive: false,
  }).addTo(map);
  // Bring the edited item into view if the panel or an edge hides it: shift the map so the item sits
  // left of the panel.
  const animate = !document.hidden && !reducedMotion.matches;
  const pt = map.latLngToContainerPoint(at);
  const box = inspector.getBoundingClientRect(), mapBox = map.getContainer().getBoundingClientRect();
  const left = box.left - mapBox.left, top = box.top - mapBox.top;
  const size = map.getSize();
  if (pt.x > left - 30 && pt.y > top - 30) map.panBy([pt.x - Math.max(60, left - 60), 0], { animate });
  else if (pt.x < 50 || pt.y < 50 || pt.x > size.x - 30 || pt.y > size.y - 30) map.panTo(at, { animate });
  content.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
}

function hideInspector() {
  inspector.hidden = true;
  inspector.replaceChildren();
  editRing?.remove();
  editRing = null;
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !inspector.hidden) hideInspector(); });

/** Build a small form; values are set through the DOM, so user text is never parsed as HTML. */
function formField(label: string, input: HTMLElement) {
  const wrap = document.createElement("label");
  wrap.className = "pop-field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.append(span, input);
  return wrap;
}

function openSiteEditor(j: number) {
  if (!custom) return;
  const s = custom.sites[j];
  if (!s) return;
  const el = document.createElement("form");
  el.className = "pop-form";
  el.addEventListener("submit", (e) => e.preventDefault());
  const title = document.createElement("h4");
  title.textContent = "Candidate site";
  const name = Object.assign(document.createElement("input"), { value: s.name, maxLength: 80 });
  const kind = document.createElement("select");
  for (const k of KINDS) kind.add(new Option(cap(k), k, false, k === s.kind));
  const check = (label: string, on: boolean) => {
    const w = document.createElement("label");
    w.className = "pop-check";
    const c = Object.assign(document.createElement("input"), { type: "checkbox", checked: on });
    w.append(c, document.createTextNode(label));
    return { w, c };
  };
  const ex = check("Existing AED (already installed, free)", s.existing);
  const must = check("Must include (always place, uses budget)", s.mustInclude);
  const hours = document.createElement("p");
  hours.className = "pop-note";
  const del = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete site", className: "btn ghost danger" });
  const setHours = () => {
    const open = ({ academic: "day + evening", dining: "day + evening", athletic: "day + evening" } as Record<string, string>)[kind.value] ?? "24/7";
    hours.textContent = `Open ${open} · ${kind.value === "outdoor" ? "cost 1.5, no indoor delay" : "cost 1"}`;
  };
  setHours();
  el.append(title, formField("Name", name), formField("Type", kind), ex.w, must.w, hours, del);

  let t = 0;
  const save = (immediate = false) => {
    clearTimeout(t);
    const run = () => {
      Object.assign(s, { name: name.value.trim() || s.name, kind: kind.value, existing: ex.c.checked, mustInclude: must.c.checked && !ex.c.checked });
      commitCustom();
    };
    if (immediate) run(); else t = window.setTimeout(run, 500);
  };
  name.addEventListener("input", () => save());
  kind.addEventListener("change", () => { setHours(); save(true); });
  ex.c.addEventListener("change", () => { if (ex.c.checked) must.c.checked = false; save(true); });
  must.c.addEventListener("change", () => { if (must.c.checked) ex.c.checked = false; save(true); });
  del.addEventListener("click", () => {
    custom!.sites.splice(j, 1);
    hideInspector();
    commitCustom();
  });
  showInspector(el, [s.lat, s.lon]);
}

function openDemandEditor(i: number) {
  if (!custom) return;
  const el = document.createElement("form");
  el.className = "pop-form";
  el.addEventListener("submit", (e) => e.preventDefault());
  const title = document.createElement("h4");
  title.textContent = "Demand point";
  const d = custom.demand[i];
  if (!d) {
    // Auto-generated uniform demand: not editable point by point.
    const p = document.createElement("p");
    p.className = "pop-note";
    p.textContent = "This dataset has no demand points, so demand is spread evenly. Upload demand points or add one with the demand tool to replace it.";
    el.append(title, p);
    const inst = scenario(settings().source, settings().emsResponseS).inst;
    const [lat, lon] = metresToLatLon(inst.cellXY[2 * i], inst.cellXY[2 * i + 1], inst.originLatLon);
    showInspector(el, [lat, lon]);
    return;
  }
  const name = Object.assign(document.createElement("input"), { value: d.name, maxLength: 80 });
  const weight = Object.assign(document.createElement("input"), { type: "number", min: "0", step: "any", value: String(d.weight) });
  const note = document.createElement("p");
  note.className = "pop-note";
  note.textContent = "Weight is relative: people present, footfall or risk. The total arrests per year is set in the sidebar.";
  const del = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete point", className: "btn ghost danger" });
  el.append(title, formField("Name", name), formField("Weight", weight), note, del);
  let t = 0;
  const save = () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      const w = Number(weight.value);
      Object.assign(d, { name: name.value.trim() || d.name, weight: Number.isFinite(w) && w >= 0 ? w : d.weight });
      delete d.periodWeights; // an edited weight uses the default day / evening / night split
      commitCustom();
    }, 500);
  };
  name.addEventListener("input", save);
  weight.addEventListener("input", save);
  del.addEventListener("click", () => {
    custom!.demand.splice(i, 1);
    hideInspector();
    commitCustom();
  });
  showInspector(el, [d.lat, d.lon]);
}

// Upload, copy and clear.
const upload = initUpload({
  hasCustom: () => !!custom && (custom.sites.length > 0 || custom.demand.length > 0),
  currentArrests: () => custom?.arrestsPerYear ?? 5,
  onImport: (r: ImportResult) => {
    const base: CustomDataset = custom ?? { name: r.fileName.replace(/\.[^.]+$/, ""), sites: [], demand: [], arrestsPerYear: r.arrestsPerYear };
    if (r.role === "sites") base.sites = r.mode === "add" ? [...base.sites, ...r.sites] : r.sites;
    else { base.demand = r.mode === "add" ? [...base.demand, ...r.demand] : r.demand; base.arrestsPerYear = r.arrestsPerYear; }
    if (!custom) base.name = r.fileName.replace(/\.[^.]+$/, "");
    custom = base;
    commitCustom({ refit: true });
    selectDataset("custom");
  },
});
ui.uploadBtn.addEventListener("click", () => upload.open());
ui.copyBtn.addEventListener("click", () => {
  const s = settings();
  const inst = scenario(s.source, s.emsResponseS).inst;
  // Never replace the viewer's own data without asking.
  if (custom && (custom.sites.length || custom.demand.length) &&
      !confirm(`Replace your dataset "${custom.name}" (${custom.sites.length} sites) with a copy of this campus?`)) return;
  custom = s.source.kind === "york" && york
    ? { name: "Copy of York U (OpenStreetMap)", arrestsPerYear: york.arrestsPerYear,
        sites: york.sites.map((x) => ({ ...x })), demand: york.demand.map((d) => ({ ...d, periodWeights: d.periodWeights && [...d.periodWeights] as [number, number, number] })) }
    : datasetFromInstance(inst, s.source.kind === "lead" ? "Copy of team campus" : "Copy of placeholder campus");
  commitCustom({ refit: false });
  selectDataset("custom");
});
ui.clearBtn.addEventListener("click", () => {
  if (!custom || !confirm("Delete the custom dataset from this browser? This cannot be undone.")) return;
  custom = null;
  saveDataset(null);
  hideInspector();
  selectDataset("lead");
  updateCustomUi();
});
ui.arrests.addEventListener("input", () => {
  const v = Number(ui.arrests.value);
  if (!custom || !Number.isFinite(v) || v < 0) return;
  custom.arrestsPerYear = v;
  clearTimeout(arrestsT);
  arrestsT = window.setTimeout(() => commitCustom(), 400);
});
let arrestsT = 0;

// ---------- AED site list ----------
const fmtLives = (v: number) => (Math.abs(v) < 0.0005 ? "0.000" : v.toFixed(3));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Aerial imagery (Esri World Imagery, no key) as a fallback "photo": tiles laid out around the site.
const AERIAL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
function aerialTiles(lat: number, lon: number, z: number, w: number, h: number): HTMLElement {
  const n = 256 * 2 ** z, rad = (lat * Math.PI) / 180;
  const px = ((lon + 180) / 360) * n;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const box = document.createElement("div");
  // A fixed-size box centred in its frame, so any frame size crops evenly around the site.
  box.style.cssText = `position:absolute;left:50%;top:50%;width:${w}px;height:${h}px;transform:translate(-50%,-50%)`;
  const x0 = px - w / 2, y0 = py - h / 2;
  for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + h) / 256); ty++) {
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + w) / 256); tx++) {
      const img = Object.assign(document.createElement("img"), { src: `${AERIAL}/${z}/${ty}/${tx}`, alt: "", loading: "lazy", decoding: "async" });
      img.style.cssText = `position:absolute;left:${Math.round(tx * 256 - x0)}px;top:${Math.round(ty * 256 - y0)}px;width:256px;height:256px;max-width:none`;
      box.append(img);
    }
  }
  return box;
}
// Commons serves standard thumbnail widths; the list uses a small one.
const thumbSrc = (src: string) => src.replace(/\/\d+px-([^/]+)$/, "/330px-$1");

interface SiteRow { j: number; name: string; label: string; role: "new" | "existing"; open: boolean[]; nOpen: number; openNow: boolean; freq: number | null }

function siteRows(): SiteRow[] {
  const { source, emsResponseS } = settings();
  const { inst } = scenario(source, emsResponseS);
  const x = state.solution?.x ?? inst.siteExisting;
  const P = inst.periods.length;
  const freq = source.kind === "lead" && lead ? new Map(lead.results.siteFreq.map((r) => [r.site_id, r.freq])) : null;
  const rows: SiteRow[] = [];
  for (let j = 0; j < inst.nSites; j++) {
    if (!x[j]) continue;
    const open = inst.periods.map((_, p) => inst.siteOpen[j * P + p] === 1);
    const role = inst.siteExisting[j] ? "existing" : "new";
    rows.push({ j, name: inst.siteName?.[j] ?? `Site ${j}`, label: "", role, open, nOpen: open.filter(Boolean).length,
      openNow: open[state.period], freq: role === "new" && freq ? freq.get(j) ?? 0 : null });
  }
  // Several sites can share a building: number them so each row is distinct.
  const seen = new Map<string, number>(), total = new Map<string, number>();
  for (const r of rows) total.set(r.name, (total.get(r.name) ?? 0) + 1);
  for (const r of [...rows].sort((a, b) => a.j - b.j)) {
    const k = (seen.get(r.name) ?? 0) + 1;
    seen.set(r.name, k);
    r.label = total.get(r.name)! > 1 ? `No. ${k}` : "";
  }
  return rows;
}

function drawList() {
  const { source, emsResponseS } = settings();
  const { inst } = scenario(source, emsResponseS);
  const all = siteRows();
  if (state.selected !== null && !all.some((r) => r.j === state.selected)) state.selected = null;
  const q = state.query.trim().toLowerCase();
  const rows = all.filter((r) => (state.show === "all" || r.role === state.show || r.j === state.selected) &&
    (!q || r.name.toLowerCase().includes(q) || inst.siteKind[r.j].includes(q)));
  const by: Record<SortKey, (a: SiteRow, b: SiteRow) => number> = {
    // Recommended first (most robust first), then installed ones by name.
    rec: (a, b) => (a.role === b.role ? (b.freq ?? 0) - (a.freq ?? 0) || a.name.localeCompare(b.name) : a.role === "new" ? -1 : 1),
    name: (a, b) => a.name.localeCompare(b.name),
    open: (a, b) => b.nOpen - a.nOpen || a.name.localeCompare(b.name),
    freq: (a, b) => (b.freq ?? -1) - (a.freq ?? -1) || a.name.localeCompare(b.name),
  };
  rows.sort((a, b) => by[state.sort](a, b) || a.j - b.j);
  ui.sortSel.querySelector<HTMLOptionElement>('option[value="freq"]')!.hidden = source.kind !== "lead";

  const nNew = all.filter((r) => r.role === "new").length;
  ui.siteCount.textContent = rows.length === all.length
    ? `${plural(all.length, "AED")} · ${nNew} new`
    : `${rows.length} of ${plural(all.length, "AED")}`;

  const chev = '<svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  ui.sites.innerHTML = rows.map((r) => {
    const sel = r.j === state.selected;
    const photo = photos[r.name];
    const pin = r.openNow ? r.role : "locked";
    const tag = r.role === "new" ? '<span class="tag new">Recommended</span>' : '<span class="tag existing">Installed</span>';
    const hours = r.openNow ? `Open ${r.nOpen}/${r.open.length} periods` : "Locked right now";
    const robust = r.freq !== null ? ` · ${Math.round(r.freq * 100)}% robust` : "";
    return `<li class="site${sel ? " open" : ""}" data-site="${r.j}">` +
      `<button type="button" class="site-row" aria-expanded="${sel}" aria-controls="detail-${r.j}">` +
      `<span class="thumb" data-thumb="${photo ? "photo" : "aerial"}">${photo ? `<img class="cover" src="${esc(thumbSrc(photo.src))}" alt="" loading="lazy" decoding="async">` : ""}<i class="pin ${pin}"></i></span>` +
      `<span class="site-main"><span class="site-name">${esc(r.name)}${r.label ? ` <small>${r.label}</small>` : ""}</span>` +
      `<span class="site-meta">${tag}<span>${esc(cap(inst.siteKind[r.j]))}</span></span>` +
      `<span class="site-sub">${hours}${robust}</span></span>${chev}</button>` +
      `<div class="site-detail" id="detail-${r.j}" role="region" aria-label="${esc(r.name)} details"><div class="inner"></div></div></li>`;
  }).join("") || `<li class="empty">${q ? `No AEDs match “${esc(state.query)}”` : "No AEDs to show"}</li>`;

  // Aerial thumbnails for sites without a photo, and the detail of the open site.
  ui.sites.querySelectorAll<HTMLElement>('.thumb[data-thumb="aerial"]').forEach((t) => {
    const j = Number(t.closest<HTMLElement>("li")!.dataset.site);
    const [lat, lon] = metresToLatLon(inst.siteXY[2 * j], inst.siteXY[2 * j + 1], inst.originLatLon);
    t.prepend(aerialTiles(lat, lon, 18, 96, 96));
  });
  const open = ui.sites.querySelector<HTMLElement>("li.open .inner");
  if (open && state.selected !== null) open.append(buildDetail(state.selected));
}

/** The expanded view of one site: photo carousel, key numbers, opening hours and actions. */
function buildDetail(j: number): HTMLElement {
  const { source, emsResponseS } = settings();
  const { inst, cov, params } = scenario(source, emsResponseS);
  const row = siteRows().find((r) => r.j === j)!;
  const x = state.solution?.x ?? inst.siteExisting;
  const [lat, lon] = metresToLatLon(inst.siteXY[2 * j], inst.siteXY[2 * j + 1], inst.originLatLon);
  const photo = photos[row.name];

  // What this AED adds: expected survivors per year with it, minus without it.
  const without = Uint8Array.from(x);
  without[j] = 0;
  const adds = evaluate(cov, x) - evaluate(cov, without);
  // How far a bystander can fetch it and get back within four minutes (same model as the map rings).
  const perMetre = (2 * params.detourFactor) / params.walkSpeedMps;
  const reach = Math.max(0, (Math.min(240, emsResponseS) - params.dispatchDelayS - inst.siteFloorDelay[j]) / perMetre);

  const el = document.createElement("div");
  el.className = "detail";
  const slides: string[] = [];
  if (photo) slides.push(`<div class="slide"><img class="photo" src="${esc(photo.src)}" alt="${esc(photo.title)}" decoding="async"></div>`);
  slides.push('<div class="slide aerial" role="img" aria-label="Aerial view of the site"><span class="target" aria-hidden="true"></span></div>');
  const credits = [
    ...(photo ? [`Photo: <a href="${esc(photo.page)}" target="_blank" rel="noopener">${esc(photo.artist)}</a>${photo.license ? ` · ${esc(photo.license)}` : ""} · Wikimedia Commons`] : []),
    "Aerial imagery © Esri, Maxar, Earthstar Geographics",
  ];
  const arrow = (d: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const robust = row.freq !== null ? ` · chosen in ${Math.round(row.freq * 100)}% of uncertainty runs` : "";
  el.innerHTML =
    `<div class="hero"><span class="badge"><i class="pin ${row.openNow ? row.role : "locked"}"></i>${row.role === "new" ? "Recommended site" : "Installed AED"}</span>` +
    `<div class="slides">${slides.join("")}</div>` +
    (slides.length > 1
      ? `<button type="button" class="nav prev" aria-label="Previous image">${arrow("M19 12H5m6-6-6 6 6 6")}</button>` +
        `<button type="button" class="nav next" aria-label="Next image">${arrow("M5 12h14m-6-6 6 6-6 6")}</button>` +
        `<div class="dots" aria-hidden="true">${slides.map(() => "<i></i>").join("")}</div>`
      : "") +
    `</div><p class="credit"></p>` +
    `<h3>${esc(row.name)}${row.label ? ` <small class="note">${row.label}</small>` : ""}</h3>` +
    `<p class="sub">${esc(cap(inst.siteKind[j]))}${robust}</p>` +
    `<dl class="stats">` +
    `<div><dt>Adds per year</dt><dd>+${fmtLives(adds)} <small>lives</small></dd></div>` +
    `<div><dt>4-min reach</dt><dd>${reach > 0 ? `~${Math.round(reach / 10) * 10} m` : "—"}</dd></div>` +
    `<div><dt>Unlocked</dt><dd>${row.nOpen} <small>of ${row.open.length} periods</small></dd></div></dl>` +
    `<h4 class="hours-h">When it can be reached</h4><ul class="hours">` +
    inst.periods.map((p, k) => `<li class="${k === state.period ? "now" : ""}">${periodIcon(p, 18)}<span class="h-name">${PERIOD_NAMES[p] ?? cap(p)}` +
      `<small>${PERIOD_HOURS_TEXT[p] ?? ""}${k === state.period ? " · now" : ""}</small></span><span class="state${row.open[k] ? "" : " off"}">${row.open[k] ? "Open" : "Locked"}</span></li>`).join("") +
    `</ul><div class="actions"><button type="button" class="btn filled" data-act="fly">Show on map</button>` +
    `<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=walking" target="_blank" rel="noopener">Walking directions</a></div>`;

  el.querySelector(".slide.aerial")!.prepend(aerialTiles(lat, lon, 18, 768, 512));
  el.querySelector<HTMLButtonElement>('[data-act="fly"]')!.addEventListener("click", () => {
    const m = markers.get(j);
    if (m) flyToSite(m.getLatLng());
    if (window.innerWidth <= 700) setPanel(false, false);
  });
  wireCarousel(el.querySelector<HTMLElement>(".hero")!, el.querySelector<HTMLElement>(".credit")!, credits);
  return el;
}

/**
 * Photo carousel: arrows, arrow keys, and a 1:1 drag that keeps the grab offset, rubber-bands at
 * the ends and uses the release velocity to pick the photo it lands on (a flick pages).
 */
function wireCarousel(hero: HTMLElement, credit: HTMLElement, credits: string[]) {
  const strip = hero.querySelector<HTMLElement>(".slides")!;
  const n = strip.children.length;
  const prev = hero.querySelector<HTMLButtonElement>(".prev"), next = hero.querySelector<HTMLButtonElement>(".next");
  const dots = [...hero.querySelectorAll<HTMLElement>(".dots i")];
  let i = 0;
  const go = (k: number, animate = true) => {
    i = Math.max(0, Math.min(n - 1, k));
    strip.style.transition = animate ? "" : "none";
    strip.style.transform = `translateX(${-i * 100}%)`;
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === n - 1;
    dots.forEach((d, k2) => d.classList.toggle("on", k2 === i));
    credit.innerHTML = credits[i];
  };
  go(0, false);
  if (n < 2) return;
  prev!.addEventListener("click", () => go(i - 1));
  next!.addEventListener("click", () => go(i + 1));
  hero.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
  });
  let drag: { id: number; x0: number; w: number; hist: { x: number; t: number }[]; moved: boolean } | null = null;
  strip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, w: hero.clientWidth, hist: [{ x: e.clientX, t: e.timeStamp }], moved: false };
  });
  strip.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (Math.abs(dx) < 8) return; // a little hysteresis before committing to a drag
      drag.moved = true;
      strip.setPointerCapture(e.pointerId);
    }
    drag.hist.push({ x: e.clientX, t: e.timeStamp });
    if (drag.hist.length > 5) drag.hist.shift();
    // Rubber-band past the first and last image instead of a hard stop.
    const band = (o: number) => (o * 0.55 * drag!.w) / (drag!.w + 0.55 * o);
    let off = -i * drag.w + dx;
    const min = -(n - 1) * drag.w;
    if (off > 0) off = band(off);
    else if (off < min) off = min - band(min - off);
    strip.style.transition = "none";
    strip.style.transform = `translateX(${off}px)`;
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    const a = d.hist[0], b = d.hist[d.hist.length - 1];
    const v = b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0; // px/s
    // Project where the flick would come to rest, then snap to the nearest image from there.
    const rate = 0.99, projected = e.clientX - d.x0 + ((v / 1000) * rate) / (1 - rate);
    go(i - Math.round(projected / d.w));
  };
  strip.addEventListener("pointerup", end);
  strip.addEventListener("pointercancel", end);
}

ui.sites.addEventListener("click", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLButtonElement>(".site-row");
  if (!row) return;
  const j = Number(row.closest<HTMLElement>("li")!.dataset.site);
  selectSite(j, { pan: state.selected !== j, scrollRow: true });
});
ui.sites.addEventListener("keydown", (e) => {
  const row = (e.target as HTMLElement).closest<HTMLElement>(".site-row");
  if (!row || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  e.preventDefault();
  const rows = [...ui.sites.querySelectorAll<HTMLElement>(".site-row")];
  rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
});
ui.sites.addEventListener("mouseover", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-site]");
  hoverSite(li ? Number(li.dataset.site) : null);
});
ui.sites.addEventListener("mouseleave", () => hoverSite(null));
ui.sites.addEventListener("focusin", (e) => {
  const li = (e.target as HTMLElement).closest<HTMLElement>("li[data-site]");
  hoverSite(li ? Number(li.dataset.site) : null);
});
ui.sortSel.addEventListener("change", () => { state.sort = ui.sortSel.value as SortKey; drawList(); });
ui.search.addEventListener("input", () => {
  state.query = ui.search.value;
  if (state.query && !document.body.classList.contains("panel-open")) setPanel(true, false);
  drawList();
});
ui.search.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const first = ui.sites.querySelector<HTMLElement>("li[data-site]");
  if (first && Number(first.dataset.site) !== state.selected) selectSite(Number(first.dataset.site), { pan: true, scrollRow: true });
});

/** The warm card at the top of the panel: what this plan buys, in survivors per year. */
const baseCache = new Map<string, number>();
function drawSummary() {
  const s = settings();
  const { inst, cov } = scenario(s.source, s.emsResponseS);
  const key = `${sourceKey(s.source)}:${s.emsResponseS}`;
  if (!baseCache.has(key)) baseCache.set(key, evaluate(cov, inst.siteExisting));
  const base = baseCache.get(key)!;
  const nExisting = inst.siteExisting.reduce((a, b) => a + b, 0);
  const installed = nExisting ? plural(nExisting, "installed AED") : "no installed AEDs";
  const sol = state.solution;
  if (!sol || sol.status === "updating") {
    ui.summaryTitle.textContent = "Finding the best sites…";
    ui.summaryBody.textContent = "Solving for the budget you set.";
    return;
  }
  const nNew = sol.x.reduce((a, b, j) => a + (b && !inst.siteExisting[j] ? 1 : 0), 0);
  if (!nNew) {
    ui.summaryTitle.textContent = `${fmtLives(base)} lives saved a year`;
    ui.summaryBody.textContent = `Expected survivors with the ${installed} alone. Add some with the New AEDs filter.`;
    return;
  }
  const gain = sol.lives - base;
  const every = gain > 0 ? Math.round(1 / gain) : 0;
  ui.summaryTitle.textContent = `+${fmtLives(gain)} lives saved a year`;
  ui.summaryBody.textContent = `${plural(nNew, "new AED")} on top of ${installed}` +
    (every > 1 ? `: about one more survivor every ${every} years.` : ".");
}

function drawPanels() {
  const { source, emsResponseS } = settings();
  const { params } = scenario(source, emsResponseS);

  drawList();
  drawSummary();

  ui.params.innerHTML = "<thead><tr><th>Parameter</th><th>Value</th><th>Source</th></tr></thead><tbody>" +
    (Object.keys(CITATIONS) as (keyof typeof CITATIONS)[]).filter((k) => k !== "bandEdgesS")
      .map((k) => `<tr><td>${k}</td><td>${params[k]}</td><td>${CITATIONS[k]}</td></tr>`).join("") + "</tbody>";
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---------- solving ----------
const newWorker = () => new Worker(new URL("./ilpWorker.ts", import.meta.url), { type: "module" });
let worker = newWorker();
let requestId = 0;
// An ILP the user has already moved past is killed rather than left to block the queue.
let inflight: { id: number; cancel: () => void } | null = null;

function runIlp(id: number, s: ReturnType<typeof settings>): Promise<IlpReply> {
  if (inflight) {
    inflight.cancel();
    worker.terminate();
    worker = newWorker();
  }
  return new Promise<IlpReply>((resolve) => {
    const w = worker;
    const onMsg = (e: MessageEvent<IlpReply>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      inflight = null;
      resolve(e.data);
    };
    inflight = { id, cancel: () => { w.removeEventListener("message", onMsg); resolve({ id, error: "cancelled" }); } };
    w.addEventListener("message", onMsg);
    const inst = s.source.kind === "custom" || s.source.kind === "york" ? scenario(s.source, s.emsResponseS).inst : undefined;
    w.postMessage({ id, source: s.source, emsResponseS: s.emsResponseS, budget: s.budget, inst } satisfies IlpRequest);
  });
}

/** The lead's own ILP answer for this budget, when the scenario is exactly the one they ran. */
function leadPlacement(s: ReturnType<typeof settings>): Uint8Array | null {
  if (!lead || s.source.kind !== "lead") return null;
  if (s.emsResponseS !== Number(lead.params.ems_response_s)) return null;
  const ids = lead.results.placements[String(s.budget)];
  if (!ids) return null;
  const x = Uint8Array.from(lead.instance.siteExisting);
  for (const j of ids) x[j] = 1;
  return x;
}

async function solve() {
  const s = settings();
  const key = `${JSON.stringify(s.source)}:${s.emsResponseS}:${s.budget}`;
  const id = ++requestId;
  let sol = solveCache.get(key);
  if (!sol) {
    const fromLead = leadPlacement(s);
    if (fromLead) {
      const cov = scenario(s.source, s.emsResponseS).cov;
      const row = lead!.results.kCurve.find((r) => r.K === s.budget);
      sol = { x: fromLead, lives: evaluate(cov, fromLead), method: "ilp", runtimeS: row?.ilp_time_s ?? 0, status: "lead" };
    } else {
      ui.busyText.textContent = "Solving ILP…";
      ui.busy.classList.remove("error");
      ui.busy.hidden = false;
      const reply = await runIlp(id, s);
      if (reply.error === "cancelled") return; // superseded; the newer request owns the spinner
      if (reply.error || !reply.x) {
        if (id === requestId) {
          ui.busyText.textContent = `ILP failed: ${reply.error}`;
          ui.busy.classList.add("error");
          ui.busy.hidden = false;
        }
        return;
      }
      const cov = scenario(s.source, s.emsResponseS).cov;
      sol = { x: reply.x, lives: evaluate(cov, reply.x), method: "ilp", runtimeS: reply.runtimeS!, status: reply.status };
    }
    solveCache.set(key, sol);
  }
  if (id !== requestId) return; // a newer request superseded this one
  if (inflight && inflight.id !== id) {
    // A cached or team answer arrived while an older ILP was still running: stop it.
    inflight.cancel();
    worker.terminate();
    worker = newWorker();
  }
  ui.busy.hidden = true;
  state.solution = sol;
  render();
}

function render() {
  drawMap();
  drawPanels();
  drawCharts();
}

function drawCharts() {
  const s = settings();
  const show = !!lead && s.source.kind === "lead";
  ui.charts.hidden = !show;
  document.getElementById("chartsEmpty")!.hidden = show;
  if (!show || sheet.hidden) return; // charts need a visible sheet to measure their width
  const atBase = s.emsResponseS === Number(lead!.params.ems_response_s);
  drawKCurve(ui.kcurve, lead!.results.kCurve, lead!.results.mcKCurve, s.budget,
    atBase ? null : state.solution?.lives ?? null);
  drawTornado(ui.tornado, lead!.results.oat);
}

// ---------- floating panel and insights sheet ----------
const panelToggle = document.getElementById("panelToggle") as HTMLButtonElement;
function setPanel(open: boolean, refit = true) {
  document.body.classList.toggle("panel-open", open);
  panelToggle.setAttribute("aria-expanded", String(open));
  panelToggle.setAttribute("aria-label", open ? "Collapse list" : "Expand list");
  // Refit once the panel has settled so the data sits in the newly visible area.
  if (refit) setTimeout(() => lockToData(true), 360);
}
panelToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  setPanel(!document.body.classList.contains("panel-open"));
});
// Phones: the panel is a bottom sheet; tapping its header folds it down or up.
document.querySelector(".panel-head")!.addEventListener("click", () => {
  if (window.innerWidth <= 700) setPanel(!document.body.classList.contains("panel-open"));
});
if (window.innerWidth <= 700) setPanel(false, false);

const sheet = document.getElementById("sheet")!;
let sheetOpener: HTMLElement | null = null;
function setSheet(open: boolean, tab?: string) {
  sheet.hidden = !open;
  if (open) {
    if (tab) showTab(tab);
    drawCharts();
    sheet.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  } else sheetOpener?.focus();
}
function showTab(name: string) {
  sheet.querySelectorAll<HTMLButtonElement>("[role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  sheet.querySelectorAll<HTMLElement>("[role=tabpanel]").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (name === "charts") drawCharts();
}
ui.summary.addEventListener("click", () => { sheetOpener = ui.summary; setSheet(true, "charts"); });
document.getElementById("sheetClose")!.addEventListener("click", () => setSheet(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden && pop.hidden) setSheet(false); });
sheet.querySelector(".tabs")!.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>("[role=tab]");
  if (tab) showTab(tab.dataset.tab!);
});

// ---------- filter pills and their popovers ----------
// The controls are single elements that move into whichever popover is open, so "All" and the
// single-control pills always show the same state.
const pop = document.getElementById("pop")!;
const fieldStore = document.getElementById("fieldStore")!;
const POPS: Record<string, string[]> = {
  // "All" holds every setting, so the bar can drop the less-used Show and Dataset pills.
  all: ["budgetField", "emsField", "periodField", "showField", "dataField"],
  budget: ["budgetField"], ems: ["emsField"], time: ["periodField"], show: ["showField"], data: ["dataField"],
  layers: ["layersField"],
};
let popFor: HTMLButtonElement | null = null;
function closePop(focusPill = false) {
  if (!popFor) return;
  fieldStore.append(...pop.children);
  pop.hidden = true;
  popFor.setAttribute("aria-expanded", "false");
  if (focusPill) popFor.focus();
  popFor = null;
}
function openPop(pill: HTMLButtonElement) {
  const same = popFor === pill;
  closePop();
  if (same) return;
  const name = pill.dataset.pop!;
  pop.append(...POPS[name].map((id) => document.getElementById(id)!));
  pop.classList.toggle("wide", name === "all");
  pop.setAttribute("aria-label", pill.textContent!.trim());
  pop.hidden = false;
  pill.setAttribute("aria-expanded", "true");
  popFor = pill;
  // Anchor under the pill; keep inside the window.
  const r = pill.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12))}px`;
  pop.querySelector<HTMLElement>("input[type=range], .opt[aria-checked=true], input:checked, button, input")?.focus({ preventScroll: true });
}
document.getElementById("filters")!.addEventListener("click", (e) => {
  const pill = (e.target as HTMLElement).closest<HTMLButtonElement>(".fpill");
  if (pill) openPop(pill);
});
// Scrolling the pill row would leave the popover behind: close it.
document.getElementById("filters")!.addEventListener("scroll", () => closePop());
document.addEventListener("pointerdown", (e) => {
  const t = e.target as HTMLElement;
  if (popFor && !pop.contains(t) && !popFor.contains(t)) closePop();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && popFor) closePop(true); });
window.addEventListener("resize", () => closePop());

// Time of day: one row per period, with its hours.
function buildPeriodButtons() {
  const { inst } = scenario(settings().source, settings().emsResponseS);
  if (state.period >= inst.periods.length) state.period = 0;
  ui.periods.innerHTML = inst.periods.map((p, q) =>
    `<button type="button" role="radio" data-q="${q}" class="opt" aria-checked="${q === state.period}">` +
    `<span class="opt-ico">${periodIcon(p)}</span><span class="opt-text">${PERIOD_NAMES[p] ?? cap(p)}<small>${PERIOD_HOURS_TEXT[p] ?? ""}</small></span></button>`).join("");
  syncPeriodPill();
}
function syncPeriodPill() {
  const { inst } = scenario(settings().source, settings().emsResponseS);
  const p = inst.periods[state.period];
  document.getElementById("periodOut")!.textContent = PERIOD_NAMES[p] ?? cap(p);
  document.getElementById("periodIcon")!.innerHTML = periodIcon(p, 20);
}

/** Fill the range track up to the thumb (WebKit has no ::range-progress). */
function paintRange(el: HTMLInputElement) {
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty("--pct", `${pct}%`);
}

ui.periods.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-q]");
  if (!btn) return;
  state.period = Number(btn.dataset.q);
  ui.periods.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
  syncPeriodPill();
  render();
});
// Arrow keys move between options in a radio group, as native radios do.
for (const group of [ui.periods, document.getElementById("showOpts")!]) {
  group.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const opts = [...group.querySelectorAll<HTMLButtonElement>(".opt")];
    const k = opts.indexOf(document.activeElement as HTMLButtonElement);
    const nextOpt = opts[(k + (e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length];
    nextOpt.focus();
    nextOpt.click();
  });
}

const SHOW_LABELS: Record<Show, string> = { all: "All AEDs", new: "Recommended", existing: "Installed" };
document.getElementById("showOpts")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-show]");
  if (!btn) return;
  state.show = btn.dataset.show as Show;
  btn.parentElement!.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b === btn)));
  document.getElementById("showOut")!.textContent = SHOW_LABELS[state.show];
  drawList();
});

let debounce = 0;
const resolveSoon = (ms = 150) => { clearTimeout(debounce); debounce = window.setTimeout(solve, ms); };
function syncRangeLabels() {
  ui.budgetOut.textContent = ui.budgetVal.textContent = ui.budget.value;
  ui.emsOut.textContent = ui.emsVal.textContent = `${Number(ui.ems.value).toFixed(1)} min`;
  paintRange(ui.budget);
  paintRange(ui.ems);
}
ui.budget.addEventListener("input", () => { syncRangeLabels(); resolveSoon(); });
ui.ems.addEventListener("input", () => { syncRangeLabels(); resolveSoon(); });
syncRangeLabels();
function onSourceChange() {
  map.attributionControl[settings().source.kind === "york" ? "addAttribution" : "removeAttribution"](YORK_CREDIT);
  state.solution = null;
  state.selected = null;
  hideInspector();
  updateCustomUi();
  buildPeriodButtons();
  render();
  solve();
}
document.querySelectorAll("input[name=dataset]").forEach((el) => el.addEventListener("change", onSourceChange));
const YORK_CREDIT = "Buildings &copy; OpenStreetMap contributors (ODbL)";
let chartW = 0;
new ResizeObserver(([e]) => {
  const w = Math.round(e.contentRect.width);
  if (w !== chartW) { chartW = w; if (lead) drawCharts(); }
}).observe(ui.charts);
// Clicking the K-curve sets the budget.
ui.kcurve.addEventListener("pick", (e) => {
  ui.budget.value = String((e as CustomEvent<number>).detail);
  ui.budget.dispatchEvent(new Event("input"));
});

(async () => {
  [lead, york, photos] = await Promise.all([loadLead(), loadYork(), loadPhotos()]);
  if (lead) {
    setLeadInstance(leadInstance(lead));
  }
  if (york) setInstance({ kind: "york" }, datasetToInstance(york));
  if (custom) {
    // A dataset saved in this browser from an earlier visit.
    setInstance({ kind: "custom", version: customVer }, datasetToInstance(custom));
    prevIds = custom.sites.map((st) => st.id);
  }
  updateCustomUi();
  buildPeriodButtons();
  render();
  solve();
})();

// Development-only test hook (stripped from production builds): lets automated checks drive the editor.
if (import.meta.env.DEV) {
  (window as unknown as { __aed: unknown }).__aed = { openSiteEditor, openDemandEditor, getCustom: () => custom };
}
