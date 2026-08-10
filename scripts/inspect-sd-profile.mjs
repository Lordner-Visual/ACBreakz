/* Inspect an extracted Stream Deck profile: which plugins does it require,
   how many buttons use each, and what do those buttons do. */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.argv[2];
const manifests = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") manifests.push(p);
  }
})(ROOT);

const plugins = new Map();   // plugin uuid -> {name, versions:Set, actions:Map, count}
const note = (act) => {
  const pl = act.Plugin ?? {};
  const puid = pl.UUID ?? (act.UUID ? act.UUID.split(".").slice(0, 3).join(".") : "(builtin)");
  if (!plugins.has(puid))
    plugins.set(puid, { name: pl.Name ?? "(built into Stream Deck)", versions: new Set(),
      actions: new Map(), count: 0, sample: null });
  const p = plugins.get(puid);
  if (pl.Version) p.versions.add(pl.Version);
  p.count++;
  const a = act.UUID ?? "(none)";
  p.actions.set(a, (p.actions.get(a) ?? 0) + 1);
  if (!p.sample) p.sample = JSON.stringify(act.Settings ?? {}).slice(0, 200);
};

/* actions nest: Controllers[].Actions{} and multi-actions carry Actions[] */
const visit = (act) => {
  if (!act || typeof act !== "object") return;
  if (act.UUID || act.Plugin) note(act);
  const kids = act.Actions;
  if (Array.isArray(kids)) kids.forEach(visit);
  else if (kids && typeof kids === "object") Object.values(kids).forEach(visit);
};

let pages = 0, keys = 0;
for (const m of manifests) {
  const j = JSON.parse(readFileSync(m, "utf8"));
  const ctrls = j.Controllers ?? [];
  for (const c of ctrls) {
    const acts = c.Actions ?? {};
    if (!Object.keys(acts).length) continue;
    pages++; keys += Object.keys(acts).length;
    Object.values(acts).forEach(visit);
  }
}

console.log(`${pages} pages, ${keys} keys, ${manifests.length} manifests\n`);
console.log("PLUGINS REQUIRED BY THIS PROFILE");
[...plugins.entries()].sort((a, b) => b[1].count - a[1].count).forEach(([uuid, p]) => {
  console.log(`\n  ${p.name}`);
  console.log(`    plugin uuid : ${uuid}`);
  if (p.versions.size) console.log(`    version(s)  : ${[...p.versions].join(", ")}`);
  console.log(`    used by     : ${p.count} actions`);
  [...p.actions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .forEach(([a, c]) => console.log(`        ${String(c).padStart(4)} x ${a}`));
  if (p.sample) console.log(`    sample settings: ${p.sample}`);
});
