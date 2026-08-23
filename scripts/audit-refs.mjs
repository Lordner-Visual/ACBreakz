/* Find every reference to a storage file that no longer exists.

   This is the check that was missing. An asset ROW can be purged while its entry survives
   inside a per-PC `stream_state` document — `assets_deselect` only runs when a row is
   deleted through the panel, so anything orphaned before that logic landed (or by a
   direct DB edit) is invisible. One such orphan, a banner purged in the pre-V13 era,
   sat in all five rotations generating ~330 HTTP 400s an hour for weeks.

   Judge existence by BUCKET LISTING, never by fetching the public URL: the CDN serves
   cached 200s long after a delete, and a HEAD returns misleading headers.

     node scripts/audit-refs.mjs            # report
     node scripts/audit-refs.mjs --fix      # also deselect orphans from every PC        */
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" };
const FIX = process.argv.includes("--fix");

const rest = (p) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: H }).then(r => r.json());
const list = (prefix) => fetch(`${env.SUPABASE_URL}/storage/v1/object/list/media`, {
  method: "POST", headers: H,
  body: JSON.stringify({ prefix, limit: 1000 }) }).then(r => r.json());

/* ---- 1. every path that exists in the bucket, walked one level deep ---- */
const have = new Set();
const roots = await list("");
for (const o of roots) {
  if (o.id) { have.add(o.name); continue; }
  for (const c of await list(o.name)) {
    if (c.id) { have.add(`${o.name}/${c.name}`); continue; }
    for (const g of await list(`${o.name}/${c.name}`))
      if (g.id) have.add(`${o.name}/${c.name}/${g.name}`);
  }
}
console.log(`bucket holds ${have.size} objects\n`);

const pathOf = (u) => {
  if (typeof u !== "string") return null;
  const i = u.indexOf("/media/");
  return i < 0 ? null : decodeURIComponent(u.slice(i + "/media/".length)).split("?")[0];
};
const MEDIA_KEYS = ["url", "base_url", "button_url", "bg_url", "poster", "sfxUrl"];
const dangling = [];               // {where, name, url, id}
const check = (where, name, u, id) => {
  const p = pathOf(u);
  if (p && !have.has(p)) dangling.push({ where, name, url: u, id, path: p });
};

/* ---- 2. asset rows (including trashed ones — a restore would resurrect a dead ref) ---- */
for (const a of await rest("assets?select=id,kind,name,url,meta")) {
  check(`asset:${a.kind}${a.meta?.deleted ? " (trash)" : ""}`, a.name, a.url, a.id);
  for (const k of MEDIA_KEYS) if (a.meta?.[k]) check(`asset.meta.${k}`, a.name, a.meta[k], a.id);
}

/* ---- 3. every per-PC selection ---- */
const states = await rest("stream_state?select=id,data&order=id");
for (const row of states) {
  const d = row.data ?? {};
  const one = (label, v) => { if (v) { check(`PC${row.id}.${label}`, v.name, v.url, v.id);
    for (const k of MEDIA_KEYS) if (v.meta?.[k]) check(`PC${row.id}.${label}.${k}`, v.name, v.meta[k], v.id); } };
  one("background", d.background);
  one("animStyle", d.animStyle);
  one("boardButtons", d.boardButtons);
  one("boardBg", d.boardBg);
  one("boardFrame", d.boardFrame);        // added to the state model after this file was written
  one("buttonAnim", d.buttonAnim);
  one("loopFx", d.loopFx);
  (d.buttonAnims || []).forEach((v, i) => one(`buttonAnims[${i}]`, v));
  (d.banners?.rotation || []).forEach((v, i) => one(`banners.rotation[${i}]`, v));
}

/* ---- 4. report ---- */
if (!dangling.length) {
  console.log("No dangling references. Every selected file exists in the bucket.");
  process.exit(0);
}
console.log(`${dangling.length} DANGLING REFERENCE(S):\n`);
const byPath = new Map();
for (const d of dangling) {
  if (!byPath.has(d.path)) byPath.set(d.path, []);
  byPath.get(d.path).push(d);
}
for (const [p, refs] of byPath) {
  console.log(`  ${p}`);
  console.log(`    name: ${JSON.stringify(refs[0].name)}   id: ${refs[0].id ?? "(none)"}`);
  console.log(`    referenced by: ${refs.map(r => r.where).join(", ")}\n`);
}

if (!FIX) {
  console.log("Run with --fix to strip these from every PC's selections.");
  process.exit(1);
}

/* ---- 5. fix, through the row-locked V13 writer so a live press cannot be clobbered ---- */
const q = (sql) => fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
  method: "POST",
  headers: { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN, "content-type": "application/json" },
  body: JSON.stringify({ query: sql }) }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
    return j;
  });

for (const [p, refs] of byPath) {
  const id = refs.find(r => r.id)?.id ?? "";
  const url = refs[0].url.replace(/'/g, "''");
  console.log(`fixing ${p} …`);
  const out = await q(`select public.assets_deselect('${id}', '${url}', 'audit') as touched;`);
  console.log(`  rows touched: ${JSON.stringify(out)}`);
}
console.log("\nre-run without --fix to confirm.");
