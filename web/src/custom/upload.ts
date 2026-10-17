// "Upload dataset" dialog: drop a CSV / GeoJSON / KML file, confirm what it holds and which columns
// mean what, preview the result, then import it as candidate sites or demand points.
import type { CustomSite, DemandPoint } from "./dataset";
import { convertRows, detectMapping, Field, FIELD_LABELS, Mapping, parseFile, ParsedFile, REQUIRED, Role } from "./parse";

export interface ImportResult {
  fileName: string;
  role: Role;
  sites: CustomSite[];
  demand: DemandPoint[];
  mode: "replace" | "add";
  arrestsPerYear: number;
}

export interface UploadOptions {
  hasCustom: () => boolean;
  currentArrests: () => number;
  onImport: (r: ImportResult) => void;
}

const FIELDS: Record<Role, Field[]> = {
  sites: ["lat", "lon", "name", "id", "kind", "existing", "mustInclude"],
  demand: ["lat", "lon", "weight", "name", "id"],
};
const HINTS: Partial<Record<Field, string>> = {
  kind: "library, residential, academic, dining, athletic, outdoor…",
  existing: "yes / true / 1 = already has an AED",
  mustInclude: "yes / true / 1 = always place an AED here",
  weight: "people, footfall or relative risk",
};

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function initUpload(opts: UploadOptions) {
  const dlg = document.getElementById("uploadDialog") as HTMLDialogElement;
  const body = dlg.querySelector<HTMLElement>(".dlg-body")!;
  const importBtn = dlg.querySelector<HTMLButtonElement>("[data-act=import]")!;
  const backBtn = dlg.querySelector<HTMLButtonElement>("[data-act=back]")!;
  let file: { name: string; parsed: ParsedFile } | null = null;
  let mapping: Mapping;
  let role: Role = "sites";
  let notes: string[] = [];
  let mode: "replace" | "add" = "replace";
  let arrests = 5;

  dlg.querySelector("[data-act=close]")!.addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click on the backdrop
  backBtn.addEventListener("click", () => { file = null; render(); });
  importBtn.addEventListener("click", () => {
    if (!file) return;
    const c = convertRows(file.parsed.rows, mapping, role);
    opts.onImport({ fileName: file.name, role, sites: c.sites, demand: c.demand, mode, arrestsPerYear: arrests });
    dlg.close();
  });

  async function accept(f: File | undefined) {
    if (!f) return;
    try {
      const parsed = await parseFile(f);
      const d = detectMapping(parsed.columns, parsed.rows);
      file = { name: f.name, parsed };
      mapping = d.mapping; role = d.role; notes = d.notes;
      render();
    } catch (err) {
      file = null;
      render(err instanceof Error ? err.message : String(err));
    }
  }

  function renderDrop(error?: string) {
    body.innerHTML = `
      <label class="drop" tabindex="0">
        <input type="file" accept=".csv,.tsv,.txt,.json,.geojson,.kml" hidden />
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4m0 0-4 4m4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
        <b>Drop a file here or click to choose</b>
        <span>CSV, GeoJSON / JSON or KML · one row or feature per location</span>
      </label>
      ${error ? `<p class="dlg-error" role="alert">${esc(error)}</p>` : ""}
      <p class="dlg-help">Upload <b>candidate AED sites</b> (where an AED could go) and, optionally, <b>demand points</b>
        (where people are, with a weight). Without demand points the app spreads demand evenly around your sites.
        Templates: <a href="samples/aed-sites-template.csv" download>sites CSV</a> ·
        <a href="samples/demand-template.csv" download>demand CSV</a></p>`;
    const drop = body.querySelector<HTMLLabelElement>(".drop")!;
    const input = drop.querySelector<HTMLInputElement>("input")!;
    input.addEventListener("change", () => accept(input.files?.[0]));
    drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); });
    for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); accept((e as DragEvent).dataTransfer?.files[0]); });
  }

  function renderMapping() {
    const { parsed, name } = file!;
    const conv = convertRows(parsed.rows, mapping, role);
    const items = role === "sites" ? conv.sites : conv.demand;
    const missing = REQUIRED.filter((f) => !mapping[f]);
    const options = (sel: string | null) => `<option value="">— none —</option>` +
      parsed.columns.map((c) => `<option value="${esc(c)}"${c === sel ? " selected" : ""}>${esc(c)}</option>`).join("");
    const fieldRows = FIELDS[role].map((f) => `
      <label class="map-row${REQUIRED.includes(f) && !mapping[f] ? " missing" : ""}">
        <span>${FIELD_LABELS[f]}${REQUIRED.includes(f) ? ' <em aria-label="required">*</em>' : ""}
          ${HINTS[f] ? `<small>${HINTS[f]}</small>` : ""}</span>
        <select data-field="${f}">${options(mapping[f])}</select>
      </label>`).join("");
    const preview = items.slice(0, 5).map((it) => role === "sites"
      ? `<tr><td>${esc((it as CustomSite).name)}</td><td>${esc((it as CustomSite).kind)}</td><td class="num">${it.lat.toFixed(5)}</td><td class="num">${it.lon.toFixed(5)}</td><td>${(it as CustomSite).existing ? "AED" : ""}${(it as CustomSite).mustInclude ? " must" : ""}</td></tr>`
      : `<tr><td>${esc(it.name)}</td><td class="num">${(it as DemandPoint).weight}</td><td class="num">${it.lat.toFixed(5)}</td><td class="num">${it.lon.toFixed(5)}</td><td></td></tr>`).join("");
    const skipped = conv.skipped.length
      ? `<span class="warn">${conv.skipped.length} skipped</span> (${conv.skipped.slice(0, 3).map((s) => `row ${s.row}: ${s.reason}`).join("; ")}${conv.skipped.length > 3 ? "…" : ""})`
      : "";

    body.innerHTML = `
      <div class="file-chip"><b>${esc(name)}</b><span>${parsed.format.toUpperCase()} · ${parsed.rows.length} rows · ${parsed.columns.length} columns</span></div>
      <fieldset class="field"><legend>This file contains</legend>
        <div class="seg" id="roleSeg">
          <label><input type="radio" name="uRole" value="sites"${role === "sites" ? " checked" : ""} /><span>Candidate AED sites</span></label>
          <label><input type="radio" name="uRole" value="demand"${role === "demand" ? " checked" : ""} /><span>Demand points</span></label>
        </div>
      </fieldset>
      ${notes.length ? `<ul class="dlg-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <div class="map-grid">${fieldRows}</div>
      ${role === "demand" ? `<label class="map-row"><span>Public arrests per year<small>total across all points; the weights only set the split</small></span>
        <input type="number" id="uArrests" min="0" step="0.1" value="${arrests}" /></label>` : ""}
      ${opts.hasCustom() ? `<fieldset class="field"><legend>Existing custom ${role === "sites" ? "sites" : "demand points"}</legend>
        <div class="seg"><label><input type="radio" name="uMode" value="replace"${mode === "replace" ? " checked" : ""} /><span>Replace</span></label>
        <label><input type="radio" name="uMode" value="add"${mode === "add" ? " checked" : ""} /><span>Add to them</span></label></div></fieldset>` : ""}
      <div class="dlg-preview">
        <div class="dlg-count"><b>${items.length}</b> ${role === "sites" ? "sites" : "points"} ready ${skipped}</div>
        ${items.length ? `<table><thead><tr><th>Name</th><th>${role === "sites" ? "Type" : "Weight"}</th><th>Lat</th><th>Lon</th><th></th></tr></thead><tbody>${preview}</tbody></table>` : ""}
      </div>`;

    body.querySelectorAll<HTMLSelectElement>("select[data-field]").forEach((s) =>
      s.addEventListener("change", () => { mapping[s.dataset.field as Field] = s.value || null; notes = []; render(); }));
    body.querySelectorAll<HTMLInputElement>("input[name=uRole]").forEach((r) =>
      r.addEventListener("change", () => { role = r.value as Role; render(); }));
    body.querySelectorAll<HTMLInputElement>("input[name=uMode]").forEach((r) =>
      r.addEventListener("change", () => { mode = r.value as "replace" | "add"; }));
    body.querySelector<HTMLInputElement>("#uArrests")?.addEventListener("input", (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= 0) arrests = v;
    });
    importBtn.disabled = missing.length > 0 || items.length === 0;
    importBtn.textContent = items.length ? `Import ${items.length} ${role === "sites" ? "sites" : "points"}` : "Import";
  }

  function render(error?: string) {
    backBtn.hidden = !file;
    importBtn.hidden = !file;
    if (file) renderMapping(); else renderDrop(error);
  }

  return {
    open() {
      file = null; mode = "replace"; arrests = opts.currentArrests();
      render();
      dlg.showModal();
    },
  };
}
