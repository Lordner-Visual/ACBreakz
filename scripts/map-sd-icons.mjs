/* Map each NFL team to the icon PNG already used in the existing profile, and show
   how the big team pages are laid out (which keys are teams vs navigation). */
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, dirname } from "path";

const ROOT = process.argv[2];
const pages = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j.Controllers?.some(c => c.Actions && Object.keys(c.Actions).length))
        pages.push({ file: p, dir: dirname(p), j });
    }
  }
})(ROOT);

const TEAMS = ["49ers","Bears","Bengals","Bills","Broncos","Browns","Buccaneers","Cardinals",
  "Chargers","Chiefs","Colts","Commanders","Cowboys","Dolphins","Eagles","Falcons","Giants",
  "Jaguars","Jets","Lions","Packers","Panthers","Patriots","Raiders","Rams","Ravens","Saints",
  "Seahawks","Steelers","Texans","Titans","Vikings"];

const icons = new Map();
for (const { dir, j } of pages) {
  const acts = j.Controllers[0].Actions ?? {};
  const kinds = {};
  for (const [pos, a] of Object.entries(acts)) {
    const uuid = a.UUID ?? "?";
    kinds[uuid] = (kinds[uuid] ?? 0) + 1;
    /* the button's own icon + its title tell us which team it is */
    const img = a.States?.[0]?.Image;
    const title = a.States?.[0]?.Title ?? a.Name ?? "";
    const blob = JSON.stringify(a.Settings ?? {}) + " " + title;
    const team = TEAMS.find(t => new RegExp(`\\b${t}\\b`, "i").test(blob));
    if (team && img && !icons.has(team)) {
      const abs = join(dir, img);
      if (existsSync(abs)) icons.set(team, abs);
    }
  }
  console.log(`\npage ${dir.split(/[\\/]/).pop()}  (${Object.keys(acts).length} keys)`);
  Object.entries(kinds).forEach(([u, c]) => console.log(`   ${String(c).padStart(3)} x ${u}`));
  const nav = Object.entries(acts).filter(([, a]) =>
    /profile\.rotate|page\.|backtoparent|openchild/.test(a.UUID ?? ""));
  if (nav.length) console.log(`   nav keys at: ${nav.map(([p]) => p).join(", ")}`);
}

console.log(`\nteam icons found: ${icons.size}/32`);
for (const t of TEAMS) if (!icons.has(t)) console.log("   MISSING:", t);
console.log(JSON.stringify(Object.fromEntries(icons), null, 0).slice(0, 300));
