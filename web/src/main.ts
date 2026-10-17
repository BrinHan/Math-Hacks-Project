// AED placement demo (Plan 3): budget slider, ambulance time, time-of-day selector, Leaflet map.
// One placement serves every period (spec section 5); switching period never re-optimizes.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { evaluate } from "./model/coverage";
import { metresToLatLon } from "./model/instance";
import { CITATIONS } from "./model/params";
import type { Solution } from "./model/solvers";
import { LeadData, leadInstance, loadLead, loadYork, YorkData } from "./data";
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
const ACCENT = "#2dd4bf"; // teal: selection, active states and primary actions only
const SITE = { existing: "#60a5fa", new: "#f4f4f5", locked: "#52525b" };
// Muted, low-chroma tags so building type reads as metadata, not as another status colour.
const KIND_COLOURS: Record<string, string> = {
  academic: "#9a8fbf", library: "#7f9fbf", residential: "#86a88f",
  athletic: "#b8a37a", dining: "#b8917a", outdoor: "#a3a3a3",
};
const PERIOD_NAMES: Record<string, string> = { day: "Day", evening: "Evening", night: "Night" };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  budget: $<HTMLInputElement>("budget"),
  budgetOut: $<HTMLOutputElement>("budgetOut"),
  ems: $<HTMLInputElement>("ems"),
  emsOut: $<HTMLOutputElement>("emsOut"),
  periods: $("periods"),
  uploadBtn: $<HTMLButtonElement>("uploadBtn"),
  copyBtn: $<HTMLButtonElement>("copyBtn"),
  clearBtn: $<HTMLButtonElement>("clearBtn"),
  arrestsField: $("arrestsField"),
  arrests: $<HTMLInputElement>("arrests"),
  sites: $<HTMLTableElement>("sites"),
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

type SortKey = "site" | "kind" | "open" | "freq" | "lat";
const state = {
  period: 0,
  solution: null as Solution | null,
  selected: null as number | null,
  sort: { key: "site" as SortKey, dir: 1 },
};
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
const map = L.map("map", { preferCanvas: true, zoomControl: true, maxBoundsViscosity: 1.0 });
// Esri Dark Gray Canvas (no API key): a muted base under the overlay, labels on top of it.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const tileOpts = { maxZoom: 19, maxNativeZoom: 16 };
L.tileLayer(`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
  ...tileOpts,
  attribution: '&copy; Esri &middot; &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
map.createPane("labels");
map.getPane("labels")!.style.zIndex = "450"; // above the cell overlay, below markers
map.getPane("labels")!.style.pointerEvents = "none";
L.tileLayer(`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { ...tileOpts, pane: "labels" }).addTo(map);
// Layers, toggled from the control at the top right. Each is cleared and refilled on redraw, so the
// control's on/off state persists.
const heatLayer = L.layerGroup().addTo(map);       // cells / demand coloured by time to the nearest AED
const demandLayer = L.layerGroup();                // raw demand points
const candidateLayer = L.layerGroup();             // candidate sites without an AED
const existingLayer = L.layerGroup().addTo(map);   // existing AEDs
const newLayer = L.layerGroup().addTo(map);        // AEDs the optimizer recommends (and must-include)
const buildingLayer = L.layerGroup().addTo(map);   // real building footprints (York dataset)
L.control.layers(undefined, {
  "Building outlines": buildingLayer,
  "Optimization heatmap": heatLayer,
  "Raw demand points": demandLayer,
  "Existing AEDs": existingLayer,
  "Recommended AEDs": newLayer,
  "Candidate AED sites": candidateLayer,
}, { position: "topright", collapsed: window.matchMedia("(max-width: 600px)").matches }).addTo(map);

let fittedFor = "";
let viewBounds: L.LatLngBounds | null = null;
let viewLoose = false; // custom data: allow a little zoom-out and panning so points can be added nearby

/** Fit the dataset and limit the view to it: zoom-out stops at the data, panning stays near it. */
function lockToData(animate = false) {
  if (!viewBounds) return;
  map.invalidateSize();
  map.setMinZoom(0); // let fitBounds pick the zoom before clamping to it
  map.setMaxBounds(undefined as unknown as L.LatLngBounds);
  const fitZoom = map.getBoundsZoom(viewBounds, false, L.point(20, 20));
  map.setMinZoom(Math.max(0, fitZoom - (viewLoose ? 2 : 0)));
  map.setMaxBounds(viewBounds.pad(viewLoose ? 0.75 : 0.05));
  if (animate && !document.hidden && !reducedMotion.matches) map.flyToBounds(viewBounds, { padding: [20, 20], duration: 0.8 });
  else map.fitBounds(viewBounds, { padding: [20, 20], animate: false });
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
    `<li><i class="${dot ? "dot" : ""}" style="background:${colour}${dot ? `;box-shadow:0 0 0 2px #0b0f17,0 0 0 3px ${colour}` : ""}"></i>${label}</li>`;
  div.innerHTML =
    `<button type="button" class="legend-toggle" aria-expanded="true"><h3>Legend</h3></button>` +
    `<div class="legend-body"><h3>Fastest AED</h3><ul>` +
    BANDS.map((b) => item(b.colour, b.label)).join("") + item(UNREACHED, "After ambulance") +
    `</ul><p class="note">Stronger tint = more arrests</p><hr />` +
    `<h3>AEDs</h3><ul>` +
    item(SITE.existing, "Existing", true) + item(SITE.new, "New", true) + item(SITE.locked, "Locked this period", true) +
    `</ul></div>`;
  const toggle = div.querySelector<HTMLButtonElement>(".legend-toggle")!;
  const setCollapsed = (c: boolean) => {
    div.classList.toggle("collapsed", c);
    toggle.setAttribute("aria-expanded", String(!c));
  };
  toggle.addEventListener("click", () => setCollapsed(!div.classList.contains("collapsed")));
  setCollapsed(window.matchMedia("(max-width: 600px)").matches); // starts folded on phones
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
  if (source.kind === "york" && york) {
    // Campus boundary and real footprints, drawn under the heatmap so colours stay readable.
    L.polygon(york.campus, { color: "#71717a", weight: 1.2, dashArray: "4 4", fill: false, interactive: false }).addTo(buildingLayer);
    for (const fp of york.footprints) {
      L.polygon(fp.ring, { color: "#a1a1aa", weight: 0.8, opacity: 0.7, fillColor: "#a1a1aa", fillOpacity: 0.08, interactive: false }).addTo(buildingLayer);
    }
  }
  markers.clear();

  let maxRate = 0;
  for (let i = 0; i < inst.nCells; i++) maxRate = Math.max(maxRate, inst.cellRate[i * P + q]);
  const half = inst.cellSizeM / 2;
  for (let i = 0; i < inst.nCells; i++) {
    let t = Infinity;
    for (let j = 0; j < J; j++) {
      if (x[j] && inst.siteOpen[j * P + q]) t = Math.min(t, tau[i * J + j]);
    }
    const rate = inst.cellRate[i * P + q];
    const share = maxRate > 0 ? rate / maxRate : 0;
    const cx = inst.cellXY[2 * i], cy = inst.cellXY[2 * i + 1];
    const tip = `${Number.isFinite(t) ? `<b>${(t / 60).toFixed(1)} min</b> to nearest AED` : "No AED in reach"}<br>${rate.toFixed(4)} arrests / yr`;
    if (half > 0) {
      L.rectangle([ll(cx - half, cy - half), ll(cx + half, cy + half)], {
        stroke: false, fillColor: bandColour(t, emsResponseS), fillOpacity: 0.18 + 0.5 * share,
      }).bindTooltip(tip).addTo(heatLayer);
    } else {
      // Point demand (custom data): a soft disc per point, larger where more arrests are expected.
      L.circleMarker(ll(cx, cy), {
        radius: 6 + 10 * Math.sqrt(share), stroke: false, fillColor: bandColour(t, emsResponseS), fillOpacity: 0.25 + 0.4 * share,
      }).bindTooltip(tip).addTo(heatLayer);
    }
    const dot = L.circleMarker(ll(cx, cy), { radius: editable ? 3.5 : 2, color: "#0e1014", weight: editable ? 1 : 0, fillColor: "#d4d4d8", fillOpacity: 0.85 })
      .bindTooltip(`Demand point<br>${rate.toFixed(4)} arrests / yr`).addTo(demandLayer);
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
        color: forced ? "#f4f4f5" : "#0e1014", weight: forced ? 2.5 : 2, dashArray: forced ? "3 2" : undefined,
      }).bindTooltip(`<b>${name(j)}</b> · ${role === "new" ? (forced ? "Must-include" : "Recommended") : "Existing"} AED<br>${cap(inst.siteKind[j])}${open ? "" : " · locked this period"}`)
        .addTo(role === "existing" ? existingLayer : newLayer);
      if (role === "new") markers.set(j, m);
      wireSite(m, j, role === "new");
    } else {
      const m = L.circleMarker(pos, {
        radius: editable ? 4.5 : 2.5, color: "#0e1014", weight: editable ? 1 : 0, fillColor: "#94a3b8", fillOpacity: open ? 0.8 : 0.3,
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

function selectSite(j: number | null, opts: { pan?: boolean; scrollRow?: boolean } = {}) {
  state.selected = state.selected === j ? null : j;
  drawSelection();
  ui.sites.querySelectorAll<HTMLTableRowElement>("tbody tr[data-site]").forEach((tr) => {
    const on = Number(tr.dataset.site) === state.selected;
    tr.classList.toggle("selected", on);
    tr.setAttribute("aria-selected", String(on));
    if (on && opts.scrollRow) tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  const m = state.selected === null ? undefined : markers.get(state.selected);
  if (m && opts.pan) {
    const zoom = Math.max(map.getZoom(), map.getMinZoom() + 1);
    // Jump instead of flying when motion is unwanted or cannot play (hidden page: no animation frames).
    if (document.hidden || reducedMotion.matches) map.setView(m.getLatLng(), zoom, { animate: false });
    else map.flyTo(m.getLatLng(), zoom, { duration: 0.6 });
  }
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
    if (Number(ui.budget.value) > 30) { ui.budget.value = "30"; ui.budgetOut.textContent = "30"; }
    if (york && settings().source.kind === "york") {
      ui.datasetNote.textContent = `${york.stats.buildings} real buildings · ${york.stats.mappedAeds} AED mapped in OpenStreetMap · occupancy modelled`;
    } else if (lead && datasetChoice() === "lead") {
      const ks = lead.results.kCurve.map((r) => r.K);
      ui.datasetNote.textContent = `Team campus · seed ${lead.source.seed} · K = ${Math.min(...ks)}–${Math.max(...ks)} solved`;
    } else if (!lead) {
      ui.datasetNote.textContent = "Team export missing (run web/scripts/export_data.py): showing a placeholder campus";
    }
  }
  ui.datasetSeg.hidden = !custom && !york;
  ui.customOpt.hidden = !custom;
  ui.yorkOpt.hidden = !york;
  ui.budget.parentElement!.querySelector(".scale span:last-child")!.textContent = ui.budget.max;
  paintRange(ui.budget);
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
    renderer: ringRenderer, pane: "selection", radius: 12, color: "#f4f4f5", weight: 2, dashArray: "4 3",
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

// ---------- panels ----------
function availBadges(open: boolean[], periods: string[]) {
  const names = periods.map((p) => PERIOD_NAMES[p] ?? cap(p));
  const title = names.map((n, p) => `${n}: ${open[p] ? "open" : "locked"}`).join(" · ");
  return `<span class="avail" title="${title}" aria-label="${title}">` +
    names.map((n, p) => `<span class="${open[p] ? "on" : ""}">${n[0]}</span>`).join("") + "</span>";
}

const COLUMNS: { key: SortKey; label: string; cls?: string; title?: string; leadOnly?: boolean }[] = [
  { key: "site", label: "Site" },
  { key: "kind", label: "Type" },
  { key: "open", label: "Open" },
  { key: "freq", label: "Freq", cls: "right", leadOnly: true,
    title: "Share of the lead's Monte Carlo scenarios (K = 10) whose re-optimized plan uses this site" },
  { key: "lat", label: "Lat/Lon", cls: "right" },
];

function drawTable() {
  const { source, emsResponseS } = settings();
  const { inst } = scenario(source, emsResponseS);
  const x = state.solution?.x ?? inst.siteExisting;
  const P = inst.periods.length;
  const freq = source.kind === "lead" && lead
    ? new Map(lead.results.siteFreq.map((r) => [r.site_id, r.freq])) : null;
  const cols = COLUMNS.filter((c) => !c.leadOnly || freq);
  if (!cols.some((c) => c.key === state.sort.key)) state.sort = { key: "site", dir: 1 };

  type Row = { j: number; kind: string; open: boolean[]; nOpen: number; freq: number; lat: number; lon: number };
  const rows: Row[] = [];
  for (let j = 0; j < inst.nSites; j++) {
    if (!x[j] || inst.siteExisting[j]) continue;
    const [lat, lon] = metresToLatLon(inst.siteXY[2 * j], inst.siteXY[2 * j + 1], inst.originLatLon);
    const open = inst.periods.map((_, p) => inst.siteOpen[j * P + p] === 1);
    rows.push({ j, kind: inst.siteKind[j], open, nOpen: open.filter(Boolean).length, freq: freq?.get(j) ?? 0, lat, lon });
  }
  if (state.selected !== null && !rows.some((r) => r.j === state.selected)) state.selected = null;

  const { key, dir } = state.sort;
  const by: Record<SortKey, (r: Row) => number | string> = {
    site: (r) => r.j, kind: (r) => r.kind, open: (r) => r.nOpen, freq: (r) => r.freq, lat: (r) => r.lat,
  };
  rows.sort((a, b) => {
    const va = by[key](a), vb = by[key](b);
    return (va < vb ? -1 : va > vb ? 1 : a.j - b.j) * dir;
  });

  const head = cols.map((c) => {
    const active = c.key === key;
    const sort = active ? (dir > 0 ? "ascending" : "descending") : "none";
    return `<th class="${c.cls ?? ""}" aria-sort="${sort}"${c.title ? ` title="${c.title}"` : ""}><button type="button" class="sort ${active ? "on" : ""}" data-key="${c.key}">` +
      `${c.label}<span class="caret" aria-hidden="true">${active ? (dir > 0 ? "▲" : "▼") : "▲"}</span></button></th>`;
  }).join("");

  const body = rows.map((r) => {
    const sel = r.j === state.selected;
    return `<tr data-site="${r.j}" tabindex="0" class="${sel ? "selected" : ""}" aria-selected="${sel}">` +
      (inst.siteName ? `<td class="site-name" title="Site #${r.j}">${esc(inst.siteName[r.j])}</td>` : `<td class="site-id">${r.j}</td>`) +
      `<td><span class="kind"><i style="background:${KIND_COLOURS[r.kind] ?? "#a3a3a3"}"></i>${r.kind}</span></td>` +
      `<td>${availBadges(r.open, inst.periods)}</td>` +
      (freq ? `<td class="freq${r.freq >= 0.5 ? " strong" : ""}" title="Chosen in ${(r.freq * 100).toFixed(1)}% of the lead's Monte Carlo scenarios">${Math.round(r.freq * 100)}%</td>` : "") +
      `<td class="coords" title="${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}"><span>${r.lat.toFixed(3)}</span><span>${r.lon.toFixed(3)}</span></td></tr>`;
  }).join("");

  ui.siteCount.textContent = rows.length ? `${rows.length} site${rows.length === 1 ? "" : "s"}` : "";
  ui.sites.innerHTML = `<thead><tr>${head}</tr></thead><tbody>` +
    (body || `<tr><td colspan="${cols.length}" class="empty">No new AEDs at this budget</td></tr>`) + "</tbody>";
}

ui.sites.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const btn = t.closest<HTMLButtonElement>("button.sort");
  if (btn) {
    const k = btn.dataset.key as SortKey;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : 1 };
    drawTable();
    return;
  }
  const tr = t.closest<HTMLTableRowElement>("tr[data-site]");
  if (tr) selectSite(Number(tr.dataset.site), { pan: true });
});
ui.sites.addEventListener("keydown", (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-site]");
  if (!tr) return;
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSite(Number(tr.dataset.site), { pan: true }); }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = e.key === "ArrowDown" ? tr.nextElementSibling : tr.previousElementSibling;
    if (next instanceof HTMLElement) next.focus();
  }
});
ui.sites.addEventListener("mouseover", (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-site]");
  hoverSite(tr ? Number(tr.dataset.site) : null);
});
ui.sites.addEventListener("mouseleave", () => hoverSite(null));
ui.sites.addEventListener("focusin", (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-site]");
  hoverSite(tr ? Number(tr.dataset.site) : null);
});

function drawPanels() {
  const { source, emsResponseS } = settings();
  const { params } = scenario(source, emsResponseS);

  drawTable();

  ui.params.innerHTML = "<thead><tr><th>Parameter</th><th>Value</th><th>Source</th></tr></thead><tbody>" +
    (Object.keys(CITATIONS) as (keyof typeof CITATIONS)[]).filter((k) => k !== "bandEdgesS")
      .map((k) => `<tr><td>${k}</td><td>${params[k]}</td><td>${CITATIONS[k]}</td></tr>`).join("") + "</tbody>";
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const signed = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(3);

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
  if (!show) return;
  const atBase = s.emsResponseS === Number(lead!.params.ems_response_s);
  drawKCurve(ui.kcurve, lead!.results.kCurve, lead!.results.mcKCurve, s.budget,
    atBase ? null : state.solution?.lives ?? null);
  drawTornado(ui.tornado, lead!.results.oat);
}

// ---------- wiring ----------
function buildPeriodButtons() {
  const { inst } = scenario(settings().source, settings().emsResponseS);
  ui.periods.innerHTML = inst.periods.map((p, q) =>
    `<button type="button" data-q="${q}" class="${q === state.period ? "on" : ""}" aria-pressed="${q === state.period}">${PERIOD_NAMES[p] ?? cap(p)}</button>`).join("");
}

/** Fill the range track up to the thumb (WebKit has no ::range-progress). */
function paintRange(el: HTMLInputElement) {
  const pct = ((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100;
  el.style.setProperty("--pct", `${pct}%`);
}

ui.periods.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  state.period = Number(btn.dataset.q);
  ui.periods.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b === btn);
    b.setAttribute("aria-pressed", String(b === btn));
  });
  render();
});

let debounce = 0;
const resolveSoon = (ms = 150) => { clearTimeout(debounce); debounce = window.setTimeout(solve, ms); };
ui.budget.addEventListener("input", () => { ui.budgetOut.textContent = ui.budget.value; paintRange(ui.budget); resolveSoon(); });
ui.ems.addEventListener("input", () => { ui.emsOut.textContent = `${Number(ui.ems.value).toFixed(1)} min`; paintRange(ui.ems); resolveSoon(); });
paintRange(ui.budget);
paintRange(ui.ems);
function onSourceChange() {
  map.attributionControl[settings().source.kind === "york" ? "addAttribution" : "removeAttribution"](YORK_CREDIT);
  state.solution = null;
  state.selected = null;
  hideInspector();
  updateCustomUi();
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
  [lead, york] = await Promise.all([loadLead(), loadYork()]);
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
