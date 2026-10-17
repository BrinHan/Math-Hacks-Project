// AED placement demo (Plan 3): budget slider, ambulance time, time-of-day selector, Leaflet map.
// One placement serves every period (spec section 5); switching period never re-optimizes.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { evaluate, evaluateByPeriod } from "./model/coverage";
import { metresToLatLon } from "./model/instance";
import { CITATIONS } from "./model/params";
import type { Solution } from "./model/solvers";
import { LeadData, leadInstance, loadLead } from "./data";
import { drawKCurve, drawTornado } from "./charts";
import { scenario, setLeadInstance, Source } from "./scenario";
import type { IlpReply, IlpRequest } from "./ilpWorker";

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
  seed: $<HTMLInputElement>("seed"),
  budget: $<HTMLInputElement>("budget"),
  budgetOut: $<HTMLOutputElement>("budgetOut"),
  ems: $<HTMLInputElement>("ems"),
  emsOut: $<HTMLOutputElement>("emsOut"),
  periods: $("periods"),
  candidates: $<HTMLInputElement>("candidates"),
  metrics: $("metrics"),
  bars: $("bars"),
  sites: $<HTMLTableElement>("sites"),
  params: $<HTMLTableElement>("params"),
  busy: $("busy"),
  busyText: $("busyText"),
  siteCount: $("siteCount"),
  seedField: $("seedField"),
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

const settings = () => ({
  source: (lead && document.querySelector<HTMLInputElement>("input[name=dataset]:checked")?.value === "lead"
    ? { kind: "lead" }
    : { kind: "synthetic", seed: Math.max(0, Math.floor(Number(ui.seed.value) || 0)) }) as Source,
  budget: Number(ui.budget.value),
  emsResponseS: Number(ui.ems.value) * 60,
});

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
const cellLayer = L.layerGroup().addTo(map);
const siteLayer = L.layerGroup().addTo(map);
let fittedFor = "";
let campusBounds: L.LatLngBounds | null = null;
/** Fit the campus and lock the view to it: no zooming out past it, no panning away. */
function lockToCampus() {
  if (!campusBounds) return;
  map.invalidateSize();
  map.setMinZoom(0); // let fitBounds pick the zoom before clamping to it
  map.fitBounds(campusBounds, { padding: [10, 10], animate: false });
  map.setMinZoom(map.getZoom());
  map.setMaxBounds(campusBounds.pad(0.05));
}
// The container can change size after first paint (fonts, layout breakpoints); refit then.
let lastSize = "";
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  const size = `${Math.round(width)}x${Math.round(height)}`;
  if (size === lastSize) return; // ignore no-op notifications so a fly-to is never cancelled
  lastSize = size;
  lockToCampus();
}).observe(document.getElementById("map")!);

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

function drawMap() {
  const { source, emsResponseS } = settings();
  const { inst, tau } = scenario(source, emsResponseS);
  const x = state.solution?.x ?? inst.siteExisting;
  const q = state.period, P = inst.periods.length, J = inst.nSites;
  const ll = (mx: number, my: number) => metresToLatLon(mx, my, inst.originLatLon);

  cellLayer.clearLayers();
  siteLayer.clearLayers();
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
    const cx = inst.cellXY[2 * i], cy = inst.cellXY[2 * i + 1];
    L.rectangle([ll(cx - half, cy - half), ll(cx + half, cy + half)], {
      stroke: false, fillColor: bandColour(t, emsResponseS),
      fillOpacity: maxRate > 0 ? 0.18 + 0.5 * (rate / maxRate) : 0.18,
    }).bindTooltip(`${Number.isFinite(t) ? `<b>${(t / 60).toFixed(1)} min</b> to nearest AED` : "No AED in reach"}<br>${rate.toFixed(4)} arrests / yr`)
      .addTo(cellLayer);
  }

  for (let j = 0; j < J; j++) {
    const open = inst.siteOpen[j * P + q] === 1;
    const pos = ll(inst.siteXY[2 * j], inst.siteXY[2 * j + 1]);
    if (x[j]) {
      const role = inst.siteExisting[j] ? "existing" : "new";
      const m = L.circleMarker(pos, {
        radius: MARKER_R, color: "#0e1014", weight: 2, fillOpacity: 1,
        fillColor: open ? SITE[role] : SITE.locked,
      }).bindTooltip(`<b>Site ${j}</b> · ${role === "new" ? "New" : "Existing"} AED<br>${cap(inst.siteKind[j])}${open ? "" : " · locked this period"}`)
        .addTo(siteLayer);
      if (role === "new") {
        markers.set(j, m);
        m.on("click", () => selectSite(j, { scrollRow: true }));
      }
    } else if (ui.candidates.checked) {
      L.circleMarker(pos, { radius: 2.5, stroke: false, fillColor: "#94a3b8", fillOpacity: open ? 0.75 : 0.25 })
        .bindTooltip(`Site ${j} · candidate<br>${cap(inst.siteKind[j])}`).addTo(siteLayer);
    }
  }

  const key = JSON.stringify(source);
  if (fittedFor !== key) {
    const ext = Math.sqrt(inst.nCells) * inst.cellSizeM;
    campusBounds = L.latLngBounds([ll(0, 0), ll(ext, ext)]);
    lockToCampus();
    fittedFor = key;
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

// ---------- panels ----------
const ICONS = {
  heart: '<path d="M12 20s-7-4.3-9-8.6C1.7 8.4 3.6 5 6.8 5c1.9 0 3.3 1 4.2 2.2h2C13.9 6 15.3 5 17.2 5c3.2 0 5.1 3.4 3.8 6.4C19 15.7 12 20 12 20z"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z"/>',
};
const icon = (name: keyof typeof ICONS) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

function metric(ic: keyof typeof ICONS, label: string, value: string, note: string, tone = "") {
  return `<div class="metric"><div class="label">${icon(ic)}${label}</div><div class="value">${value}</div>` +
    `<div class="note ${tone}" title="${note}">${note}</div></div>`;
}

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
      `<td class="site-id">${r.j}</td>` +
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
  const { inst, cov, params } = scenario(source, emsResponseS);
  const sol = state.solution;
  const x = sol?.x ?? inst.siteExisting;
  const P = inst.periods.length, q = state.period;
  const lives = evaluate(cov, x);
  const existing = evaluate(cov, cov.siteExisting);
  const byPeriod = evaluateByPeriod(cov, x);
  let nNew = 0, nExisting = 0, locked = 0;
  for (let j = 0; j < inst.nSites; j++) {
    if (!x[j]) continue;
    if (inst.siteExisting[j]) nExisting++; else nNew++;
    if (!inst.siteOpen[j * P + q]) locked++;
  }
  const periodName = cap(inst.periods[q]);

  const gain = lives - existing;
  // When showing the lead's own placement, check our evaluate() reproduces their k_curve.csv number.
  const leadRow = sol?.status === "lead" ? lead?.results.kCurve.find((r) => r.K === settings().budget) : undefined;
  const livesNote = leadRow
    ? `${signed(gain)} vs existing · ${Math.abs(leadRow.ilp_lives - lives) < 5e-6 ? "matches" : "differs from"} lead's ${leadRow.ilp_lives.toFixed(3)}`
    : `${signed(gain)} vs existing AEDs only`;
  // Greedy is not a choice in the app; the team's precomputed gap says what optimizing buys.
  const solveNote = !sol ? "HiGHS ILP"
    : leadRow ? `Team ILP · ${leadRow.gap_pct > 0.05 ? `greedy is ${leadRow.gap_pct.toFixed(1)}% short` : "greedy ties"}`
    : `HiGHS ILP in browser · ${sol.status}`;
  ui.metrics.innerHTML =
    metric("heart", "Lives saved / yr", lives.toFixed(3), livesNote, gain > 0 ? "up" : "") +
    metric("pin", "AEDs placed", `${nNew}<small>new</small>`, `plus ${nExisting} existing`) +
    metric("clock", `${periodName} lives / yr`, byPeriod[q].toFixed(3),
      locked ? `${locked} AED${locked === 1 ? "" : "s"} locked this period` : "All AEDs open this period", locked ? "warn" : "") +
    metric("bolt", "Solve time", sol ? `${sol.runtimeS.toFixed(2)}<small>s</small>` : "—", solveNote);

  const maxP = Math.max(...byPeriod, 1e-12);
  ui.bars.innerHTML = byPeriod.map((v, p) =>
    `<div class="bar ${p === q ? "active" : ""}"><span>${PERIOD_NAMES[inst.periods[p]] ?? cap(inst.periods[p])}</span>` +
    `<div class="track"><div style="width:${(100 * v) / maxP}%"></div></div><b>${v.toFixed(3)}</b></div>`).join("");

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
    w.postMessage({ id, source: s.source, emsResponseS: s.emsResponseS, budget: s.budget } satisfies IlpRequest);
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
const resolveSoon = () => { clearTimeout(debounce); debounce = window.setTimeout(solve, 150); };
ui.budget.addEventListener("input", () => { ui.budgetOut.textContent = ui.budget.value; paintRange(ui.budget); resolveSoon(); });
ui.ems.addEventListener("input", () => { ui.emsOut.textContent = `${Number(ui.ems.value).toFixed(1)} min`; paintRange(ui.ems); resolveSoon(); });
paintRange(ui.budget);
paintRange(ui.ems);
function onSourceChange() {
  const synthetic = settings().source.kind === "synthetic";
  ui.seedField.hidden = !synthetic;
  state.solution = null;
  state.selected = null;
  render();
  solve();
}
ui.seed.addEventListener("change", onSourceChange);
document.querySelectorAll("input[name=dataset]").forEach((el) => el.addEventListener("change", onSourceChange));
ui.candidates.addEventListener("change", drawMap);
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
  lead = await loadLead();
  if (lead) {
    setLeadInstance(leadInstance(lead));
    const ks = lead.results.kCurve.map((r) => r.K);
    ui.datasetNote.textContent = `seed ${lead.source.seed} · K = ${Math.min(...ks)}–${Math.max(...ks)} solved`;
  } else {
    // No export yet: fall back to the TypeScript generator and say how to produce the lead's data.
    const leadRadio = document.querySelector<HTMLInputElement>("input[name=dataset][value=lead]")!;
    leadRadio.disabled = true;
    document.querySelector<HTMLInputElement>("input[name=dataset][value=synthetic]")!.checked = true;
    ui.datasetNote.textContent = "Lead export missing: run web/scripts/export_data.py";
  }
  ui.seedField.hidden = settings().source.kind !== "synthetic";
  buildPeriodButtons();
  render();
  solve();
})();
