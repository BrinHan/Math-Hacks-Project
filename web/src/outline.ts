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

export class OutlineLayer extends L.Layer {
  private canvas = document.createElement("canvas");
  private rings: L.LatLng[][] = [];
  private bounds: L.LatLngBounds | null = null;
  private drawZoom = 0;

  constructor(private style: OutlineStyle) {
    super();
    this.canvas.className = "outline-canvas leaflet-zoom-animated";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.transformOrigin = "0 0";
  }

  setRings(rings: [number, number][][]) {
    this.rings = rings.map((r) => r.map(([a, b]) => L.latLng(a, b)));
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
}
