// Google Maps-style tilt for a Leaflet map. Leaflet has no camera pitch, so the map element itself is
// leaned back with a CSS perspective transform. It is enlarged first so the far side still fills the
// screen, and a haze hides the horizon. Controls move to an untilted overlay so they stay flat, and
// mouse positions are projected back onto the tilted plane, so clicks, wheel zoom and tooltips land
// where the pointer is.
import L from "leaflet";

const ANGLE = 40; // degrees of tilt
const PERSPECTIVE = 1500; // px
const MS = 600; // tilt animation

export interface Tilt {
  set(on: boolean): void;
  readonly on: boolean;
}

/**
 * @param onSize called (before Leaflet is told about it) whenever tilting changes the map's size,
 *   so a resize observer can tell it apart from a real layout change.
 */
export function addTilt(map: L.Map, onSize: () => void): Tilt {
  const el = map.getContainer();
  // Controls in an overlay with the same box and classes as the map, outside the tilted element.
  const overlay = document.createElement("div");
  overlay.className = `${el.className} map-overlay`;
  overlay.classList.remove("leaflet-grab", "leaflet-drag-target");
  const controls = (map as unknown as { _controlContainer: HTMLElement })._controlContainer;
  overlay.appendChild(controls);
  el.after(overlay);

  // Screen -> map-plane mouse position through the element's current (possibly animating) transform.
  const m = map as unknown as { mouseEventToContainerPoint(e: MouseEvent): L.Point };
  const flat = m.mouseEventToContainerPoint.bind(map);
  m.mouseEventToContainerPoint = (e: MouseEvent) => {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return flat(e);
    const [ox, oy] = getComputedStyle(el).transformOrigin.split(" ").map(parseFloat);
    const n = new DOMMatrix().translate(ox, oy).multiply(new DOMMatrix(t)).translate(-ox, -oy);
    const sx = e.clientX - el.offsetLeft - el.clientLeft, sy = e.clientY - el.offsetTop - el.clientTop;
    // (x, y, 0, 1) -> (X, Y, W) with screen = (X / W, Y / W): two linear equations in x and y.
    const a = n.m11 - sx * n.m14, b = n.m21 - sx * n.m24, c = sx * n.m44 - n.m41;
    const d = n.m12 - sy * n.m14, f = n.m22 - sy * n.m24, g = sy * n.m44 - n.m42;
    const det = a * f - b * d;
    return det ? L.point((c * f - b * g) / det, (a * g - c * d) / det) : flat(e);
  };

  let on = false;
  let busy = 0;
  const resize = (center: L.LatLng, zoom: number) => {
    onSize();
    map.invalidateSize({ pan: false });
    map.setView(center, zoom, { animate: false });
  };
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    get on() { return on; },
    set(next: boolean) {
      if (next === on) return;
      on = next;
      const center = map.getCenter(), zoom = map.getZoom();
      const token = ++busy;
      overlay.classList.toggle("tilted", on);
      if (on) {
        // Enlarge (shown flat, shifted so the view does not jump), then lean back.
        el.classList.add("tilt-big");
        resize(center, zoom);
        if (reduced()) { el.classList.add("tilted"); return; }
        void el.offsetWidth; // apply the flat start state before animating
        requestAnimationFrame(() => { if (token === busy) el.classList.add("tilted"); });
      } else {
        el.classList.remove("tilted");
        const finish = () => {
          if (token !== busy) return;
          el.classList.remove("tilt-big");
          resize(map.getCenter(), map.getZoom());
        };
        if (reduced()) finish(); else setTimeout(finish, MS);
      }
    },
  };
}

export const TILT_CSS = { ANGLE, PERSPECTIVE, MS };
