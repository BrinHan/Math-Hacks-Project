// AED placement demo (Plan 3): budget slider, solver choice, time-of-day selector, Leaflet map.
// One placement serves every period (spec section 5); switching period never re-optimizes.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { evaluate, evaluateByPeriod } from "./model/coverage";
import { metresToLatLon } from "./model/instance";
import { CITATIONS } from "./model/params";
import { Solution, solveGreedy } from "./model/solvers";
import { scenario } from "./scenario";
import type { IlpReply, IlpRequest } from "./ilpWorker";

// Fastest-AED bands on the map (seconds); anything at or past EMS arrival is "unreached".
const BANDS = [
  { edge: 120, colour: "#1a9850", label: "≤ 2 min" },
  { edge: 240, colour: "#91cf60", label: "2–4 min" },
  { edge: 360, colour: "#fee08b", label: "4–6 min" },
  { edge: Infinity, colour: "#fc8d59", label: "6 min – EMS" },
];
const UNREACHED = "#d73027";
const SITE = { existing: "#2b6cb0", new: "#111111", locked: "#a0aec0" };

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
};

const state = { period: 0, solution: null as Solution | null };
const solveCache = new Map<string, Solution>();

const settings = () => ({
  seed: Math.max(0, Math.floor(Number(ui.seed.value) || 0)),
  budget: Number(ui.budget.value),
  emsResponseS: Number(ui.ems.value) * 60,
  method: (document.querySelector<HTMLInputElement>("input[name=solver]:checked")!.value) as "ilp" | "greedy",
});

// ---------- map ----------
const map = L.map("map", { preferCanvas: true, zoomControl: true, maxBoundsViscosity: 1.0 });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
}).addTo(map);
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
new ResizeObserver(lockToCampus).observe(document.getElementById("map")!);

const legend = new L.Control({ position: "bottomleft" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = "<b>Fastest AED this period</b>" +
    [...BANDS.map((b) => [b.colour, b.label]), [UNREACHED, "not before EMS"]]
      .map(([c, l]) => `<div><i style="background:${c}"></i>${l}</div>`).join("") +
    `<div class="note">Darker cell = more arrests</div>` +
    `<div><i class="dot" style="background:${SITE.existing}"></i>existing AED</div>` +
    `<div><i class="dot" style="background:${SITE.new}"></i>new AED</div>` +
    `<div><i class="dot" style="background:${SITE.locked}"></i>locked this period</div>`;
  return div;
};
legend.addTo(map);

function bandColour(t: number, emsS: number) {
  if (t >= emsS) return UNREACHED;
  return BANDS.find((b) => t <= b.edge)!.colour;
}

function drawMap() {
  const { seed, emsResponseS } = settings();
  const { inst, tau } = scenario(seed, emsResponseS);
  const x = state.solution?.x ?? inst.siteExisting;
  const q = state.period, P = inst.periods.length, J = inst.nSites;
  const ll = (mx: number, my: number) => metresToLatLon(mx, my, inst.originLatLon);

  cellLayer.clearLayers();
  siteLayer.clearLayers();

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
      fillOpacity: maxRate > 0 ? 0.15 + 0.55 * (rate / maxRate) : 0.15,
    }).bindTooltip(`${Number.isFinite(t) ? `${(t / 60).toFixed(1)} min to AED` : "no AED in reach"} · ${rate.toFixed(4)} arrests/yr`)
      .addTo(cellLayer);
  }

  for (let j = 0; j < J; j++) {
    const open = inst.siteOpen[j * P + q] === 1;
    const pos = ll(inst.siteXY[2 * j], inst.siteXY[2 * j + 1]);
    if (x[j]) {
      const role = inst.siteExisting[j] ? "existing" : "new";
      L.circleMarker(pos, {
        radius: 7, color: "#fff", weight: 2, fillOpacity: 1,
        fillColor: open ? SITE[role] : SITE.locked,
      }).bindTooltip(`#${j} ${role} AED · ${inst.siteKind[j]}${open ? "" : " · LOCKED"}`).addTo(siteLayer);
    } else if (ui.candidates.checked) {
      L.circleMarker(pos, { radius: 2.5, stroke: false, fillColor: "#718096", fillOpacity: open ? 0.7 : 0.2 })
        .bindTooltip(`#${j} candidate · ${inst.siteKind[j]}`).addTo(siteLayer);
    }
  }

  const key = `${seed}`;
  if (fittedFor !== key) {
    const ext = Math.sqrt(inst.nCells) * inst.cellSizeM;
    campusBounds = L.latLngBounds([ll(0, 0), ll(ext, ext)]);
    lockToCampus();
    fittedFor = key;
  }
}

// ---------- panels ----------
function metric(label: string, value: string, note: string, tone = "") {
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="note ${tone}">${note}</div></div>`;
}

function drawPanels() {
  const { seed, emsResponseS, method } = settings();
  const { inst, cov, params } = scenario(seed, emsResponseS);
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

  ui.metrics.innerHTML =
    metric("Lives saved / yr", lives.toFixed(3), `${signed(lives - existing)} vs existing AEDs only`, "up") +
    metric("AEDs placed", `${nNew} new`, `${nExisting} existing`) +
    metric(`${periodName} share`, byPeriod[q].toFixed(3), `${locked} AED${locked === 1 ? "" : "s"} locked now`, locked ? "warn" : "") +
    metric("Solve time", sol ? `${sol.runtimeS.toFixed(2)} s` : "—",
      sol ? (sol.method === "ilp" ? `HiGHS · ${sol.status}` : "lazy greedy") : method);

  const maxP = Math.max(...byPeriod, 1e-12);
  ui.bars.innerHTML = byPeriod.map((v, p) =>
    `<div class="bar ${p === q ? "active" : ""}"><span>${cap(inst.periods[p])}</span>` +
    `<div class="track"><div style="width:${(100 * v) / maxP}%"></div></div><b>${v.toFixed(3)}</b></div>`).join("");

  const rows: string[] = [];
  for (let j = 0; j < inst.nSites; j++) {
    if (!x[j] || inst.siteExisting[j]) continue;
    const [lat, lon] = metresToLatLon(inst.siteXY[2 * j], inst.siteXY[2 * j + 1], inst.originLatLon);
    const open = inst.periods.filter((_, p) => inst.siteOpen[j * P + p]).map((p) => p[0].toUpperCase()).join("/");
    rows.push(`<tr><td>${j}</td><td>${inst.siteKind[j]}</td><td>${open}</td><td>${lat.toFixed(5)}</td><td>${lon.toFixed(5)}</td></tr>`);
  }
  ui.sites.innerHTML = "<thead><tr><th>site</th><th>kind</th><th>open</th><th>lat</th><th>lon</th></tr></thead><tbody>" +
    (rows.join("") || `<tr><td colspan="5" class="empty">No new AEDs at this budget</td></tr>`) + "</tbody>";

  ui.params.innerHTML = "<thead><tr><th>parameter</th><th>value</th><th>source</th></tr></thead><tbody>" +
    (Object.keys(CITATIONS) as (keyof typeof CITATIONS)[]).filter((k) => k !== "bandEdgesS")
      .map((k) => `<tr><td>${k}</td><td>${params[k]}</td><td>${CITATIONS[k]}</td></tr>`).join("") + "</tbody>";
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const signed = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(3);

// ---------- solving ----------
const worker = new Worker(new URL("./ilpWorker.ts", import.meta.url), { type: "module" });
let requestId = 0;

async function solve() {
  const s = settings();
  const key = `${s.seed}:${s.emsResponseS}:${s.method}:${s.budget}`;
  const id = ++requestId;
  let sol = solveCache.get(key);
  if (!sol) {
    if (s.method === "greedy") {
      sol = solveGreedy(scenario(s.seed, s.emsResponseS).cov, s.budget);
    } else {
      ui.busy.textContent = "Solving…";
      ui.busy.hidden = false;
      const reply = await new Promise<IlpReply>((resolve) => {
        const onMsg = (e: MessageEvent<IlpReply>) => {
          if (e.data.id !== id) return;
          worker.removeEventListener("message", onMsg);
          resolve(e.data);
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage({ id, seed: s.seed, emsResponseS: s.emsResponseS, budget: s.budget } satisfies IlpRequest);
      });
      if (id === requestId) ui.busy.hidden = true;
      if (reply.error || !reply.x) {
        if (id === requestId) ui.busy.textContent = `ILP failed: ${reply.error}`, ui.busy.hidden = false;
        return;
      }
      const cov = scenario(s.seed, s.emsResponseS).cov;
      sol = { x: reply.x, lives: evaluate(cov, reply.x), method: "ilp", runtimeS: reply.runtimeS!, status: reply.status };
    }
    solveCache.set(key, sol);
  }
  if (id !== requestId) return; // a newer request superseded this one
  state.solution = sol;
  render();
}

function render() {
  drawMap();
  drawPanels();
}

// ---------- wiring ----------
function buildPeriodButtons() {
  const { inst } = scenario(settings().seed, settings().emsResponseS);
  ui.periods.innerHTML = inst.periods.map((p, q) =>
    `<button type="button" data-q="${q}" class="${q === state.period ? "on" : ""}">${cap(p)}</button>`).join("");
}

ui.periods.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  state.period = Number(btn.dataset.q);
  ui.periods.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === btn));
  render();
});

let debounce = 0;
const resolveSoon = () => { clearTimeout(debounce); debounce = window.setTimeout(solve, 150); };
ui.budget.addEventListener("input", () => { ui.budgetOut.textContent = ui.budget.value; resolveSoon(); });
ui.ems.addEventListener("input", () => { ui.emsOut.textContent = `${Number(ui.ems.value).toFixed(1)} min`; resolveSoon(); });
ui.seed.addEventListener("change", () => { state.solution = null; solve(); });
document.querySelectorAll("input[name=solver]").forEach((el) => el.addEventListener("change", solve));
ui.candidates.addEventListener("change", drawMap);

buildPeriodButtons();
render();
solve();
