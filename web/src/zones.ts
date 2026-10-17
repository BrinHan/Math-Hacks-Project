// AED reach zones painted on one canvas: the campus is clipped and filled red ("no AED before the
// ambulance"), then each time band is painted over it from the outermost in. Painting opaque colours
// and fading the whole canvas keeps overlaps clean and leaves red only where no AED reaches.
import L from "leaflet";

export interface Zone { at: L.LatLng; radii: number[] } // metres per band, innermost first

export class ZoneLayer extends L.Layer {
  private canvas = document.createElement("canvas");
  private zones: Zone[] = [];
  private ring: L.LatLng[] | null = null;

  constructor(private colours: string[], private uncovered: string, private opacity = 0.5) {
    super();
    this.canvas.className = "zone-canvas leaflet-zoom-hide";
    this.canvas.style.opacity = String(opacity);
    this.canvas.style.pointerEvents = "none";
  }

  /** Zones to paint and the boundary to clip to (null: no clip and no red base). */
  setData(zones: Zone[], ring: [number, number][] | null | undefined) {
    this.zones = zones;
    this.ring = ring?.length ? ring.map(([a, b]) => L.latLng(a, b)) : null;
    this.redraw();
    return this;
  }

  onAdd(map: L.Map) {
    if (!map.getPane("zones")) {
      const pane = map.createPane("zones");
      pane.style.zIndex = "380"; // above tiles and building outlines, below markers
      pane.style.pointerEvents = "none";
    }
    map.getPane("zones")!.appendChild(this.canvas);
    map.on("moveend zoomend resize viewreset", this.redraw, this);
    this.redraw();
    return this;
  }

  onRemove(map: L.Map) {
    this.canvas.remove();
    map.off("moveend zoomend resize viewreset", this.redraw, this);
    return this;
  }

  redraw() {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (!map) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    c.width = Math.round(size.x * dpr);
    c.height = Math.round(size.y * dpr);
    c.style.width = `${size.x}px`;
    c.style.height = `${size.y}px`;
    // Pin the canvas to the current view inside the panning map pane.
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.save();

    if (this.ring) {
      ctx.beginPath();
      this.ring.forEach((p, i) => {
        const pt = map.latLngToContainerPoint(p);
        if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = this.uncovered;
      ctx.fillRect(0, 0, size.x, size.y);
    }

    // Metres -> pixels at this zoom (Web Mercator), per zone latitude.
    const zoom = map.getZoom();
    const pxPerMetre = (lat: number) => (256 * 2 ** zoom) / (40075016.686 * Math.cos((lat * Math.PI) / 180));
    for (let b = this.colours.length - 1; b >= 0; b--) {
      ctx.fillStyle = this.colours[b];
      ctx.beginPath();
      for (const z of this.zones) {
        const r = z.radii[b] * pxPerMetre(z.at.lat);
        if (!(r > 0)) continue;
        const pt = map.latLngToContainerPoint(z.at);
        ctx.moveTo(pt.x + r, pt.y);
        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }
}
