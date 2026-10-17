// Crisp map outlines (campus boundary, building footprints) on a canvas that is repainted on every
// frame of a pan or fly-to, so line widths and dash lengths stay constant instead of being stretched
// with the map and snapping back when it settles. Only CSS zoom animations (zoom buttons, wheel)
// briefly scale the last frame, like Leaflet's own layers, and repaint when they end.
import L from "leaflet";

export interface OutlineStyle {
  stroke: string;
  width: number;
  alpha?: number;
  dash?: number[];
  fill?: string;
  fillAlpha?: number;
  halo?: { stroke: string; width: number; alpha: number }; // wide soft line drawn underneath
}

const PANE = "outlines";
const LIGHT = [-0.6, -0.8]; // light from the upper left (screen x, y), for wall shading
/** Height drawn per metre: under 1 so the oblique view does not hide too much of the map. */
const TILT = 0.75;

export class OutlineLayer extends L.Layer {
  private canvas = document.createElement("canvas");
  private rings: L.LatLng[][] = [];
  private bounds: L.LatLngBounds | null = null;
  private drawZoom = 0;
  private heights: number[] = []; // metres, per ring (3D mode)
  private extrude = false;

  constructor(private style: OutlineStyle) {
    super();
    this.canvas.className = "outline-canvas leaflet-zoom-animated";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.transformOrigin = "0 0";
  }

  setRings(rings: [number, number][][], heightsM: number[] = []) {
    this.rings = rings.map((r) => r.map(([a, b]) => L.latLng(a, b)));
    this.heights = heightsM;
    this.redraw();
    return this;
  }

  /** 2.5D: extrude each ring upward by its height (Leaflet cannot tilt the camera, so the view stays
   * top-down and buildings lean north like an oblique aerial photo). */
  set3D(on: boolean) {
    this.extrude = on;
    this.redraw();
    return this;
  }

  getEvents(): { [name: string]: L.LeafletEventHandlerFn } {
    // "move" and "zoom" fire on every frame of drags and fly-to: repaint (cheap: a few hundred points).
    return {
      move: this.redraw, zoom: this.redraw, moveend: this.redraw, zoomend: this.redraw,
      resize: this.redraw, viewreset: this.redraw, zoomanim: this.animateZoom as L.LeafletEventHandlerFn,
    };
  }

  onAdd(map: L.Map) {
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      pane.style.zIndex = "390"; // above the time-to-AED colours (380), below markers
      pane.style.pointerEvents = "none";
    }
    map.getPane(PANE)!.appendChild(this.canvas);
    this.redraw();
    return this;
  }

  onRemove() {
    this.canvas.remove();
    return this;
  }

  private mapRef() {
    return (this as unknown as { _map?: L.Map })._map;
  }

  private animateZoom(e: L.ZoomAnimEvent) {
    const map = this.mapRef();
    if (!map || !this.bounds) return;
    const m = map as unknown as { _latLngBoundsToNewLayerBounds(b: L.LatLngBounds, z: number, c: L.LatLng): L.Bounds };
    L.DomUtil.setTransform(this.canvas, m._latLngBoundsToNewLayerBounds(this.bounds, e.zoom, e.center).min!, map.getZoomScale(e.zoom, this.drawZoom));
  }

  redraw() {
    const map = this.mapRef();
    if (!map) return;
    const size = map.getSize();
    const pad = 40; // a little margin so line caps at the edge are not clipped
    const W = size.x + 2 * pad, H = size.y + 2 * pad;
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    L.DomUtil.setTransform(c, map.containerPointToLayerPoint([-pad, -pad]), 1);
    this.drawZoom = map.getZoom();
    this.bounds = L.latLngBounds(map.containerPointToLatLng([-pad, size.y + pad]), map.containerPointToLatLng([size.x + pad, -pad]));
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.rings.length) return;

    const path = () => {
      ctx.beginPath();
      for (const ring of this.rings) {
        ring.forEach((p, i) => {
          const pt = map.latLngToContainerPoint(p);
          if (i) ctx.lineTo(pt.x + pad, pt.y + pad); else ctx.moveTo(pt.x + pad, pt.y + pad);
        });
        ctx.closePath();
      }
    };
    const s = this.style;
    if (this.extrude && this.heights.length) { this.drawExtruded(ctx, map, pad); return; }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    path();
    if (s.fill) { ctx.globalAlpha = s.fillAlpha ?? 1; ctx.fillStyle = s.fill; ctx.fill(); }
    if (s.halo) {
      ctx.setLineDash([]);
      ctx.globalAlpha = s.halo.alpha; ctx.strokeStyle = s.halo.stroke; ctx.lineWidth = s.halo.width; ctx.stroke();
    }
    ctx.setLineDash(s.dash ?? []);
    ctx.globalAlpha = s.alpha ?? 1; ctx.strokeStyle = s.stroke; ctx.lineWidth = s.width; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawExtruded(ctx: CanvasRenderingContext2D, map: L.Map, pad: number) {
    const lat = map.getCenter().lat;
    const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (map.getZoom() + 8);
    const items = this.rings.map((ring, i) => {
      const pts = ring.map((p) => { const q = map.latLngToContainerPoint(p); return [q.x + pad, q.y + pad]; });
      return { pts, lift: ((this.heights[i] ?? 7) / mPerPx) * TILT, ymax: Math.max(...pts.map((p) => p[1])) };
    });
    // Paint far (north, higher on screen) to near, so nearer buildings cover the ones behind.
    items.sort((a, b) => a.ymax - b.ymax);
    ctx.lineJoin = "round";
    ctx.setLineDash([]);
    for (const { pts, lift } of items) {
      const n = pts.length;
      let area = 0;
      for (let k = 0; k < n; k++) { const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % n]; area += x1 * y2 - x2 * y1; }
      const sign = Math.sign(area) || 1;
      // Footprint shadow on the ground.
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x + lift * 0.35, y + lift * 0.1) : ctx.moveTo(x + lift * 0.35, y + lift * 0.1)));
      ctx.closePath();
      ctx.globalAlpha = 0.35; ctx.fillStyle = "#000000"; ctx.fill();
      // Walls facing the viewer (outward normal pointing down the screen), shaded by orientation.
      for (let k = 0; k < n; k++) {
        const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % n];
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < 0.01) continue;
        const nx = (sign * (y2 - y1)) / len, ny = (sign * -(x2 - x1)) / len;
        if (ny <= 0) continue;
        const lit = 0.5 + 0.5 * -(nx * LIGHT[0] + ny * LIGHT[1]); // 0 (shade) .. 1 (lit)
        const v = Math.round(70 + 80 * lit);
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - lift); ctx.lineTo(x1, y1 - lift);
        ctx.closePath();
        ctx.globalAlpha = 0.92; ctx.fillStyle = `rgb(${v},${v},${v + 8})`; ctx.fill();
        ctx.lineWidth = 0.6; ctx.strokeStyle = "#1a1a1a"; ctx.globalAlpha = 0.5; ctx.stroke();
      }
      // Roof.
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y - lift) : ctx.moveTo(x, y - lift)));
      ctx.closePath();
      ctx.globalAlpha = 0.9; ctx.fillStyle = "#c9ccd1"; ctx.fill();
      ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = "#f2f2f2"; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
