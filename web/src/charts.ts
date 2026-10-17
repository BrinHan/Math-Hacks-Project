// Plain-SVG charts for the lead's results: lives vs budget (with Monte Carlo band) and the OAT tornado.
// Series use the 400 shades, which hold contrast on the dark surface #171717.
import type { KCurveRow, MCRow, OATRow } from "./data";

const C = {
  ilp: "#2dd4bf",     // teal 400
  greedy: "#c084fc",  // violet 400
  pop: "#fb923c",     // orange 400: population-only baseline
  low: "#60a5fa",     // blue 400: parameter at its low value
  high: "#fb923c",    // orange 400: parameter at its high value
  grid: "#2e2e2e",
  axis: "#777777",
  ink: "#ededed",
  ink2: "#9e9e9e",
  ink3: "#777777",
  surface: "#171717",
};

const PARAM_LABELS: Record<string, [string, (v: number) => string]> = {
  ems_response_s: ["Ambulance response", (v) => `${(v / 60).toFixed(0)} min`],
  walk_speed_mps: ["Walking speed", (v) => `${v.toFixed(1)} m/s`],
  survival_k_per_min: ["Survival decay", (v) => `${(v * 100).toFixed(0)}%/min`],
  survival_S0: ["Survival at t = 0", (v) => `${(v * 100).toFixed(0)}%`],
  shockable_fraction: ["Shockable rhythm", (v) => `${(v * 100).toFixed(0)}%`],
  away_time_share: ["Time away from home", (v) => `${(v * 100).toFixed(0)}%`],
  incidence_per_100k_yr: ["Arrest incidence", (v) => `${v.toFixed(0)}/100k`],
  public_fraction: ["Public share", (v) => `${(v * 100).toFixed(0)}%`],
  detour_factor: ["Detour factor", (v) => `×${v.toFixed(2)}`],
  dispatch_delay_s: ["Bystander delay", (v) => `${v.toFixed(0)} s`],
};
const paramLabel = (p: string) => PARAM_LABELS[p]?.[0] ?? p;
const paramFmt = (p: string, v: number) => (PARAM_LABELS[p]?.[1] ?? ((x: number) => String(x)))(v);

const svgEl = (w: number, h: number) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" style="display:block;overflow:visible">`;

function niceMax(v: number) {
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function ensureTooltip(host: HTMLElement) {
  let tip = host.querySelector<HTMLDivElement>(".chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    host.appendChild(tip);
  }
  return tip;
}

function placeTip(host: HTMLElement, tip: HTMLElement, x: number, y: number) {
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  const left = x + 14 + w > host.clientWidth ? x - 14 - w : x + 14;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, Math.min(y - h / 2, host.clientHeight - h))}px`;
}

/** Lives saved per year vs budget K: ILP line, greedy dashed, MC 90% band, existing-only reference. */
export function drawKCurve(host: HTMLElement, rows: KCurveRow[], mc: MCRow[], current: number, scenarioLives: number | null) {
  const plot = host.querySelector<HTMLElement>(".chart-plot")!;
  const W = Math.max(280, plot.clientWidth), H = 220;
  const m = { t: 12, r: 64, b: 30, l: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const kMax = rows[rows.length - 1].K;
  const yMax = niceMax(Math.max(...rows.map((r) => r.ilp_lives), ...mc.map((r) => r.p95), scenarioLives ?? 0));
  const x = (k: number) => m.l + (k / kMax) * iw;
  const y = (v: number) => m.t + ih - (v / yMax) * ih;
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${x(a).toFixed(1)},${y(b).toFixed(1)}`).join("");

  let s = svgEl(W, H);
  // grid + y axis
  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4, yy = y(v);
    s += `<line x1="${m.l}" x2="${m.l + iw}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`;
    s += `<text x="${m.l - 8}" y="${yy + 3.5}" text-anchor="end" class="tick">${v.toFixed(v < 1 ? 2 : 1)}</text>`;
  }
  for (let k = 0; k <= kMax; k += 5) {
    s += `<text x="${x(k)}" y="${H - 10}" text-anchor="middle" class="tick">${k}</text>`;
  }
  s += `<text x="${m.l + iw}" y="${H - 10}" text-anchor="end" class="tick axis-title" dx="${m.r - 4}">K</text>`;

  // MC band (only at the budgets the lead sampled)
  if (mc.length) {
    const top = mc.map((r) => [r.K, r.p95] as [number, number]);
    const bot = mc.map((r) => [r.K, r.p5] as [number, number]).reverse();
    s += `<path d="${line(top)}${line(bot).replace("M", "L")}Z" fill="${C.ilp}" fill-opacity="0.16" stroke="none"/>`;
  }
  // existing-only reference
  const ex = rows[0].existing_lives;
  s += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(ex)}" y2="${y(ex)}" stroke="${C.axis}" stroke-width="1.5" stroke-dasharray="2 3"/>`;
  // current K
  s += `<line x1="${x(current)}" x2="${x(current)}" y1="${m.t}" y2="${m.t + ih}" stroke="${C.ink3}" stroke-width="1"/>`;
  // series
  const hasPop = rows.every((r) => typeof r.pop_lives === "number");
  if (hasPop) {
    s += `<path d="${line(rows.map((r) => [r.K, r.pop_lives!]))}" fill="none" stroke="${C.pop}" stroke-width="2" stroke-dasharray="7 3 1.5 3" stroke-linejoin="round"/>`;
  }
  s += `<path d="${line(rows.map((r) => [r.K, r.greedy_lives]))}" fill="none" stroke="${C.greedy}" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round"/>`;
  s += `<path d="${line(rows.map((r) => [r.K, r.ilp_lives]))}" fill="none" stroke="${C.ilp}" stroke-width="2" stroke-linejoin="round"/>`;
  // marker at current K (2px surface ring)
  const cur = rows.find((r) => r.K === current);
  if (cur) s += `<circle cx="${x(current)}" cy="${y(cur.ilp_lives)}" r="4.5" fill="${C.ilp}" stroke="${C.surface}" stroke-width="2"/>`;
  if (scenarioLives !== null) {
    s += `<circle cx="${x(current)}" cy="${y(scenarioLives)}" r="4.5" fill="${C.surface}" stroke="${C.ink}" stroke-width="2"/>`;
  }
  // direct labels at the right end, nudged apart so they never collide
  const last = rows[rows.length - 1];
  const labels = [
    { text: "ILP", y: y(last.ilp_lives), cls: "dlabel" },
    { text: "Greedy", y: y(last.greedy_lives), cls: "dlabel muted" },
    ...(hasPop ? [{ text: "Population", y: y(last.pop_lives!), cls: "dlabel muted" }] : []),
    { text: "Existing", y: y(ex), cls: "dlabel muted" },
  ].sort((a, b) => a.y - b.y);
  // Push labels down so neighbours sit at least 12px apart, then pull the stack back inside the plot.
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 12);
  const overflow = labels[labels.length - 1].y - (m.t + ih);
  if (overflow > 0) labels.forEach((l) => (l.y -= overflow));
  for (const l of labels) s += `<text x="${m.l + iw + 6}" y="${l.y + 3.5}" class="${l.cls}">${l.text}</text>`;
  // hover layer
  s += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="${C.ink2}" stroke-width="1" visibility="hidden"/>`;
  s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" style="cursor:pointer"/>`;
  s += "</svg>";
  plot.innerHTML = s;

  const svg = plot.querySelector("svg")!;
  const hit = svg.querySelector<SVGRectElement>(".hit")!;
  const xhair = svg.querySelector<SVGLineElement>(".xhair")!;
  const tip = ensureTooltip(plot);
  const kAt = (ev: MouseEvent) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(kMax, Math.round(((px - m.l) / iw) * kMax)));
  };
  hit.addEventListener("pointermove", (ev) => {
    const k = kAt(ev), r = rows.find((row) => row.K === k)!;
    const band = mc.find((b) => b.K === k);
    xhair.setAttribute("x1", String(x(k))); xhair.setAttribute("x2", String(x(k)));
    xhair.setAttribute("visibility", "visible");
    tip.innerHTML = `<div class="tip-h">K = ${k}</div>` +
      `<div><i style="background:${C.ilp}"></i>ILP<b>${r.ilp_lives.toFixed(3)}</b></div>` +
      `<div><i style="background:${C.greedy}"></i>Greedy<b>${r.greedy_lives.toFixed(3)}</b></div>` +
      `<div><i class="none"></i>Swap<b>${r.swap_lives.toFixed(3)}</b></div>` +
      (hasPop ? `<div><i style="background:${C.pop}"></i>Population-only<b>${r.pop_lives!.toFixed(3)}</b></div>` : "") +
      (band ? `<div><i style="background:${C.ilp};opacity:.35"></i>90% MC<b>${band.p5.toFixed(2)}–${band.p95.toFixed(2)}</b></div>` : "") +
      `<div class="tip-f">Gap ${r.gap_pct.toFixed(1)}% · click to set budget</div>`;
    const pr = plot.getBoundingClientRect();
    placeTip(plot, tip, (x(k) / W) * pr.width, (y(r.ilp_lives) / H) * pr.height);
  });
  hit.addEventListener("pointerleave", () => { tip.hidden = true; xhair.setAttribute("visibility", "hidden"); });
  hit.addEventListener("click", (ev) => host.dispatchEvent(new CustomEvent("pick", { detail: kAt(ev) })));
}

/** One-at-a-time sensitivity: lives at each parameter's low and high value around the base case. */
export function drawTornado(host: HTMLElement, rows: OATRow[]) {
  const plot = host.querySelector<HTMLElement>(".chart-plot")!;
  const sorted = [...rows].sort((a, b) =>
    Math.abs(b.lives_at_high - b.lives_at_low) - Math.abs(a.lives_at_high - a.lives_at_low));
  const W = Math.max(260, plot.clientWidth), rowH = 22;
  const m = { t: 6, r: 12, b: 26, l: 128 };
  const H = m.t + m.b + sorted.length * rowH;
  const iw = W - m.l - m.r;
  const base = sorted[0]?.base_lives ?? 0;
  const lo = Math.min(...sorted.flatMap((r) => [r.lives_at_low, r.lives_at_high]), base);
  const hi = Math.max(...sorted.flatMap((r) => [r.lives_at_low, r.lives_at_high]), base);
  const pad = (hi - lo) * 0.06;
  const x = (v: number) => m.l + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * iw;

  let s = svgEl(W, H);
  sorted.forEach((r, i) => {
    const yy = m.t + i * rowH;
    s += `<text x="${m.l - 10}" y="${yy + rowH / 2 + 3.5}" text-anchor="end" class="rlabel">${paramLabel(r.param)}</text>`;
    for (const side of ["low", "high"] as const) {
      const v = side === "low" ? r.lives_at_low : r.lives_at_high;
      const x0 = Math.min(x(base), x(v)), w = Math.max(1, Math.abs(x(v) - x(base)));
      const val = side === "low" ? r.low_value : r.high_value;
      s += `<rect class="tbar" x="${x0}" y="${yy + 4}" width="${w}" height="${rowH - 8}" rx="2" fill="${side === "low" ? C.low : C.high}" ` +
        `data-tip="${paramLabel(r.param)} = ${paramFmt(r.param, val)}|${v.toFixed(3)} lives/yr (${v >= base ? "+" : ""}${(v - base).toFixed(3)})"/>`;
    }
  });
  s += `<line x1="${x(base)}" x2="${x(base)}" y1="${m.t}" y2="${H - m.b + 2}" stroke="${C.ink2}" stroke-width="1"/>`;
  s += `<text x="${x(base)}" y="${H - 8}" text-anchor="middle" class="tick">base ${base.toFixed(3)}</text>`;
  s += "</svg>";
  plot.innerHTML = s;

  const tip = ensureTooltip(plot);
  plot.querySelectorAll<SVGRectElement>(".tbar").forEach((bar) => {
    bar.addEventListener("pointermove", (ev) => {
      const [h, b] = bar.dataset.tip!.split("|");
      tip.innerHTML = `<div class="tip-h">${h}</div><div>${b}</div>`;
      const pr = plot.getBoundingClientRect();
      placeTip(plot, tip, ev.clientX - pr.left, ev.clientY - pr.top);
    });
    bar.addEventListener("pointerleave", () => { tip.hidden = true; });
  });
}
