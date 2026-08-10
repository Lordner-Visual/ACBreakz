/* Pull the team icon sets out of the old profile: normal, X'd, and highlight/glow.
   Saves them to streamdeck/icons/<set>/<Team>.png and reports what each page holds. */
import { readdirSync, readFileSync, statSync, mkdirSync, copyFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const ROOT = process.argv[2];
const OUT = "C:/ACBreakz-Cloud/streamdeck/icons";
const TEAMS = ["49ers","Bears","Bengals","Bills","Broncos","Browns","Buccaneers","Cardinals",
  "Chargers","Chiefs","Colts","Commanders","Cowboys","Dolphins","Eagles","Falcons","Giants",
  "Jaguars","Jets","Lions","Packers","Panthers","Patriots","Raiders","Rams","Ravens","Saints",
  "Seahawks","Steelers","Texans","Titans","Vikings"];

const pages = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
      const acts = j.Controllers?.[0]?.Actions;
      if (acts && Object.keys(acts).length) pages.push({ dir: dirname(p), acts, name: j.Name ?? "" });
    }
  }
})(ROOT);

const report = [];
for (const { dir, acts } of pages) {
  const found = new Map();     // team -> {state0, state1}
  for (const a of Object.values(acts)) {
    const blob = JSON.stringify(a.Settings ?? {}) + " " + (a.States?.[0]?.Title ?? "") +
      " " + JSON.stringify(a.Actions ?? "");
    const team = TEAMS.find(t => new RegExp(`\\b${t}\\b`, "i").test(blob));
    if (!team) continue;
    found.set(team, (a.States ?? []).map(s => s.Image).filter(Boolean));
  }
  if (found.size >= 20) report.push({ dir, found });
}

console.log(`pages holding a full team set: ${report.length}`);
report.forEach((r, i) => {
  const sample = [...r.found.values()][0];
  console.log(`  page ${i}: ${r.found.size} teams, ${sample.length} image state(s) per key`);
});

/* page 0 = the pick page (state0 normal, state1 = X'd/after), later pages = highlights */
report.forEach((r, i) => {
  [...r.found.entries()].forEach(([team, imgs]) => {
    imgs.forEach((img, s) => {
      const set = `page${i}-state${s}`;
      mkdirSync(join(OUT, set), { recursive: true });
      const src = join(r.dir, img);
      try { copyFileSync(src, join(OUT, set, `${team}.png`)); } catch {}
    });
  });
});
const sets = readdirSync(OUT).filter(d => statSync(join(OUT, d)).isDirectory());
console.log("\nicon sets written:");
sets.forEach(s => console.log(`   ${s}: ${readdirSync(join(OUT, s)).length} files`));
writeFileSync(join(OUT, "sets.json"), JSON.stringify(sets, null, 1));
