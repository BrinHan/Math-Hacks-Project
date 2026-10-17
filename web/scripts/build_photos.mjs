// Build web/public/data/photos.json: a landmark photo for each named AED site, from Wikimedia Commons.
//
//   node web/scripts/build_photos.mjs
//
// For each building name in lead.json: a Commons file whose title contains the building name and
// "York" (or that is geotagged within 400 m of the site). Nearby geotagged photos were tried and
// dropped: most showed a different building. Matches were reviewed by hand; SKIP drops ones that
// show something else. Sites without a photo fall back to aerial imagery in the app. Photos keep their author and licence for credit.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEAD = join(HERE, "..", "public", "data", "lead.json");
const OUT = join(HERE, "..", "public", "data", "photos.json");
const API = "https://commons.wikimedia.org/w/api.php";
// Reviewed matches that show the wrong subject (logos, protests, unrelated places).
const SKIP = [/TTC/, /seal/i, /logo/i, /strike/i, /protest/i, /map/i, /diagram/i, /\.png$/i, /\.svg$/i];

const lead = JSON.parse(readFileSync(LEAD, "utf8"));
const { siteXY, siteName, originLatLon } = lead.instance;
const M_PER_DEG_LAT = 111_320;
const toLatLon = (x, y) => [originLatLon[0] + y / M_PER_DEG_LAT,
  originLatLon[1] + x / (M_PER_DEG_LAT * Math.cos((originLatLon[0] * Math.PI) / 180))];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params, tries = 6) {
  const url = `${API}?${new URLSearchParams({ action: "query", format: "json", ...params })}`;
  const r = await fetch(url, { headers: { "User-Agent": "aed-placement-web/1.0 (Math Hacks project)" } });
  if (r.status === 429 && tries > 0) { await sleep(Number(r.headers.get("retry-after") ?? 0) * 1000 || 8000); return api(params, tries - 1); }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  await sleep(1200); // be polite to the API
  return r.json();
}
const INFO = { prop: "imageinfo|coordinates", iiprop: "url|extmetadata", iiurlwidth: "800",
  iiextmetadatafilter: "Artist|LicenseShortName", colimit: "max" };

const distM = (a, b) => {
  const dy = (a[0] - b[0]) * M_PER_DEG_LAT, dx = (a[1] - b[1]) * M_PER_DEG_LAT * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dx, dy);
};
const strip = (html) => String(html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const photo = (p, how) => {
  const ii = p.imageinfo?.[0];
  if (!ii?.thumburl) return null;
  return {
    src: ii.thumburl.replace(/\?.*$/, ""), page: ii.descriptionurl, title: p.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
    artist: strip(ii.extmetadata?.Artist?.value) || "Unknown", license: strip(ii.extmetadata?.LicenseShortName?.value), how,
  };
};
const usable = (p) => !SKIP.some((re) => re.test(p.title));

const out = {};
const names = [...new Set(siteName)];
for (const name of names) {
  const j = siteName.indexOf(name);
  const at = toLatLon(siteXY[2 * j], siteXY[2 * j + 1]);
  const key = name.replace(/^The /, "").replace(/ of York University$/, "");
  let found = null;
  // By name: the title must contain the building name and either "York" or a nearby geotag.
  const byName = await api({ generator: "search", gsrsearch: `intitle:"${key}" filetype:bitmap`, gsrnamespace: "6", gsrlimit: "12", ...INFO });
  const hits = Object.values(byName.query?.pages ?? {}).sort((a, b) => a.index - b.index).filter(usable).filter((p) => {
    if (!p.title.toLowerCase().includes(key.toLowerCase())) return false;
    const c = p.coordinates?.[0];
    return c ? distM([c.lat, c.lon], at) < 400 : /york/i.test(p.title);
  });
  if (hits.length) found = photo(hits[0], "name");
  console.log(`${found ? found.how.padEnd(6) : "none  "} ${name}${found ? `  ->  ${found.title}` : ""}`);
  if (found) out[name] = found;
}
writeFileSync(OUT, JSON.stringify({ source: "Wikimedia Commons", built: new Date().toISOString().slice(0, 10), photos: out }, null, 1));
console.log(`\n${Object.keys(out).length} / ${names.length} buildings have a photo -> ${OUT}`);
