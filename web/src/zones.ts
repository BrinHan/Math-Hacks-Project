// Time-to-AED field painted like a weather map: every point on campus is coloured by the time for a
// bystander to fetch the nearest open AED and come back, on a smooth green -> yellow -> red ramp, and
// red where no AED arrives before the ambulance. The field is computed on a coarse grid and scaled up
// with smoothing (soft, radar-like edges), then clipped to the campus boundary so nothing spills out.
import L from "leaflet";

/** An open AED: where it is and the fixed part of its time (bystander delay + time inside the building). */
export interface Zone { at: L.LatLng; slackS: number }
export interface ZoneTiming { perMetreS: number; emsS: number; maxS: number }

// Weather-style ramp over time as a share of the ambulance time (0 = AED at hand, 1 = ambulance arrives).
const RAMP: [number, [number, number, number]][] = [
  [0.0, [0, 104, 55]],      // deep green
  [0.2, [26, 152, 80]],
  [0.35, [102, 189, 99]],
  [0.5, [166, 217, 106]],
  [0.62, [217, 239, 139]],  // yellow-green
  [0.72, [254, 224, 139]],  // yellow
  [0.82, [253, 174, 97]],   // orange
  [0.92, [244, 109, 67]],
  [1.0, [215, 48, 39]],     // red: the ambulance gets there first
];
export const NO_AED_RGB: [number, number, number] = [215, 48, 39];
/** CSS gradient matching the ramp, for the legend. */
export const RAMP_CSS = `linear-gradient(to right, ${RAMP.map(([f, c]) => `rgb(${c.join(" ")}) ${f * 100}%`).join(", ")})`;

function rampColour(f: number): [number, number, number] {
  if (f <= 0) return RAMP[0][1];
  for (let i = 1; i < RAMP.length; i++) {
    const [f1, c1] = RAMP[i];
    if (f <= f1) {
      const [f0, c0] = RAMP[i - 1];
      const t = (f - f0) / (f1 - f0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return NO_AED_RGB;
}

const PAD = 0.3;  // draw this share of the view beyond each edge, so panning never shows a blank strip
const CELL = 4;   // CSS pixels per computed cell; smoothing hides the grid

export class ZoneLayer extends L.Layer {
  private canvas = document.createElement("canvas");
  private grid = document.createElement("canvas");
  private zones: Zone[] = [];
  private ring: L.LatLng[] | null = null;
  private timing: ZoneTiming = { perMetreS: 1.86, emsS: 540, maxS: 540 };
  private bounds: L.LatLngBounds | null = null; // geographic extent of the last drawing (for zoom animation)
  private drawZoom = 0;                           // zoom level the last drawing was made at

  constructor(opacity = 0.55) {
    super();
    // "leaflet-zoom-animated" lets Leaflet scale the canvas along with the zoom instead of hiding it.
    this.canvas.className = "zone-canvas leaflet-zoom-animated";
    this.canvas.style.opacity = String(opacity);
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.transformOrigin = "0 0";
  }

  setData(zones: Zone[], ring: [number, number][] | null | undefined, timing: ZoneTiming) {
    this.zones = zones;
    this.ring = ring?.length ? ring.map(([a, b]) => L.latLng(a, b)) : null;
    this.timing = timing;
    this.redraw();
    return this;
  }

  getEvents(): { [name: string]: L.LeafletEventHandlerFn } {
    // "zoom" fires on every frame of flyTo / setView animations, which send no zoomanim: follow them.
    return { zoomanim: this.animateZoom as L.LeafletEventHandlerFn, zoom: this.follow, moveend: this.redraw, zoomend: this.redraw, resize: this.redraw, viewreset: this.redraw };
  }

  onAdd(map: L.Map) {
    if (!map.getPane("zones")) {
      const pane = map.createPane("zones");
      pane.style.zIndex = "380"; // above tiles and building outlines, below markers
      pane.style.pointerEvents = "none";
    }
    map.getPane("zones")!.appendChild(this.canvas);
    this.redraw();
    return this;
  }

  onRemove() {
    this.canvas.remove();
    return this;
  }

  /** Scale and shift the last drawing to where it will sit at the target zoom (same maths as image overlays). */
  private animateZoom(e: L.ZoomAnimEvent) {
    const map = this.mapRef();
    if (!map || !this.bounds) return;
    const scale = map.getZoomScale(e.zoom);
    const m = map as unknown as { _latLngBoundsToNewLayerBounds(b: L.LatLngBounds, z: number, c: L.LatLng): L.Bounds };
    const offset = m._latLngBoundsToNewLayerBounds(this.bounds, e.zoom, e.center).min!;
    L.DomUtil.setTransform(this.canvas, offset, scale);
  }

  /** Keep the last drawing pinned to the map mid-animation by moving and scaling it (no repaint). */
  private follow() {
    const map = this.mapRef();
    if (!map || !this.bounds) return;
    L.DomUtil.setTransform(this.canvas, map.latLngToLayerPoint(this.bounds.getNorthWest()), map.getZoomScale(map.getZoom(), this.drawZoom));
  }

  private mapRef() {
    return (this as unknown as { _map?: L.Map })._map;
  }

  redraw() {
    const map = this.mapRef();
    if (!map) return;
    const size = map.getSize();
    const padX = Math.round(size.x * PAD), padY = Math.round(size.y * PAD);
    const W = size.x + 2 * padX, H = size.y + 2 * padY;
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const topLeft = map.containerPointToLayerPoint([-padX, -padY]);
    L.DomUtil.setTransform(c, topLeft, 1);
    this.bounds = L.latLngBounds(
      map.containerPointToLatLng([-padX, size.y + padY]),
      map.containerPointToLatLng([size.x + padX, -padY]),
    );
    this.drawZoom = map.getZoom();
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const toCanvas = (p: L.LatLng) => {
      const pt = map.latLngToContainerPoint(p);
      return [pt.x + padX, pt.y + padY] as const;
    };

    // 1. Fastest time on a coarse grid (straight-line walk to the AED and back, at the campus latitude).
    const gw = Math.ceil(W / CELL), gh = Math.ceil(H / CELL);
    const g = this.grid;
    g.width = gw;
    g.height = gh;
    const gctx = g.getContext("2d")!;
    const img = gctx.createImageData(gw, gh);
    const lat = (this.ring?.[0] ?? this.zones[0]?.at ?? map.getCenter()).lat;
    const metresPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** map.getZoom());
    const sPerPx = this.timing.perMetreS * metresPerPx;
    const limit = Math.min(this.timing.emsS, this.timing.maxS);
    const pts = this.zones.map((z) => { const [x, y] = toCanvas(z.at); return [x, y, z.slackS] as const; });
    const clipped = !!this.ring;
    for (let gy = 0; gy < gh; gy++) {
      const y = (gy + 0.5) * CELL;
      for (let gx = 0; gx < gw; gx++) {
        const x = (gx + 0.5) * CELL;
        let t = Infinity;
        for (const [px, py, slack] of pts) {
          const tt = slack + sPerPx * Math.hypot(x - px, y - py);
          if (tt < t) t = tt;
        }
        const k = 4 * (gy * gw + gx);
        if (t < limit) {
          const [r, gg, b] = rampColour(t / this.timing.emsS);
          img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
        } else if (clipped) {
          // Inside the campus but out of reach: red. Without a boundary, leave it clear.
          [img.data[k], img.data[k + 1], img.data[k + 2]] = NO_AED_RGB; img.data[k + 3] = 255;
        }
      }
    }
    gctx.putImageData(img, 0, 0);

    // 2. Scale up smoothly, clipped to the campus.
    ctx.save();
    if (this.ring) {
      ctx.beginPath();
      this.ring.forEach((p, i) => { const [x, y] = toCanvas(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.clip();
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(g, 0, 0, gw * CELL, gh * CELL);
    ctx.restore();
  }
}
