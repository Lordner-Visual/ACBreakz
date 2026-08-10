/* Diff Brandon's hand-made API Ninja key against one of mine. */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.argv[2];
const acts = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
      const visit = (a, where) => {
        if (!a || typeof a !== "object") return;
        if (a.UUID === "com.barraider.apininja") acts.push({ a, where });
        const k = a.Actions;
        if (Array.isArray(k)) k.forEach(x => visit(x, where + ">multi"));
        else if (k && typeof k === "object") Object.values(k).forEach(x => visit(x, where + ">multi"));
      };
      (j.Controllers ?? []).forEach(c =>
        Object.entries(c.Actions ?? {}).forEach(([pos, a]) => visit(a, pos)));
    }
  }
})(ROOT);

const hand = acts.find(x => x.a.Plugin?.Version !== "1.0");
const mine = acts.find(x => x.a.Plugin?.Version === "1.0" && !x.where.includes("multi"));
if (!hand) { console.log("no hand-made action found"); process.exit(0); }

console.log("=== HAND-MADE (works?) at key", hand.where, "===");
console.log(JSON.stringify({ ...hand.a, Settings: undefined }, null, 1));
console.log("Settings:", JSON.stringify(hand.a.Settings, null, 1));

console.log("\n=== MINE at key", mine?.where, "===");
console.log(JSON.stringify({ ...mine?.a, Settings: undefined }, null, 1));

const h = hand.a.Settings ?? {}, m = mine?.a.Settings ?? {};
const allKeys = [...new Set([...Object.keys(h), ...Object.keys(m)])].sort();
console.log("\n=== SETTINGS DIFF ===");
for (const k of allKeys) {
  const hv = JSON.stringify(h[k]), mv = JSON.stringify(m[k]);
  if (hv !== mv) console.log(`  ${k}:  hand=${hv}   mine=${mv}`);
}
console.log("\n=== TOP-LEVEL DIFF ===");
for (const k of [...new Set([...Object.keys(hand.a), ...Object.keys(mine?.a ?? {})])].sort()) {
  if (k === "Settings" || k === "ActionID" || k === "States") continue;
  const hv = JSON.stringify(hand.a[k]), mv = JSON.stringify(mine?.a?.[k]);
  if (hv !== mv) console.log(`  ${k}:  hand=${hv}   mine=${mv}`);
}
