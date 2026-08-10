/* What is actually installed on the deck right now: which ACBreakz profiles exist,
   and what settings did Stream Deck keep for their API Ninja keys? */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.env.APPDATA, "Elgato", "StreamDeck",
  process.argv[2] ?? "ProfilesV3");
for (const prof of readdirSync(ROOT)) {
  const root = join(ROOT, prof);
  if (!statSync(root).isDirectory()) continue;
  let name = "(unnamed)";
  try { name = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).Name ?? name; } catch {}

  const ninjas = [];
  const others = new Map();
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === "manifest.json") {
        let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
        const visit = (a) => {
          if (!a || typeof a !== "object") return;
          if (a.UUID === "com.barraider.apininja") ninjas.push(a);
          else if (a.UUID) others.set(a.UUID, (others.get(a.UUID) ?? 0) + 1);
          const k = a.Actions;
          if (Array.isArray(k)) k.forEach(visit);
          else if (k && typeof k === "object") Object.values(k).forEach(visit);
        };
        (j.Controllers ?? []).forEach(c => Object.values(c.Actions ?? {}).forEach(visit));
      }
    }
  })(root);

  if (!ninjas.length && !/AC\s?Breakz/i.test(name)) continue;
  console.log(`\n=== "${name}"  (${prof.slice(0, 8)})`);
  console.log(`    API Ninja keys: ${ninjas.length}`);
  if (ninjas.length) {
    const autorun = new Map(), keycount = new Map();
    for (const a of ninjas) {
      autorun.set(JSON.stringify(a.Settings?.autorunMinutes),
        (autorun.get(JSON.stringify(a.Settings?.autorunMinutes)) ?? 0) + 1);
      keycount.set(Object.keys(a.Settings ?? {}).length,
        (keycount.get(Object.keys(a.Settings ?? {}).length) ?? 0) + 1);
    }
    console.log(`    autorunMinutes values: ${[...autorun].map(([v,c]) => `${v} x${c}`).join(", ")}`);
    console.log(`    settings key counts:   ${[...keycount].map(([v,c]) => `${v} keys x${c}`).join(", ")}`);
    console.log(`    sample url: ${(ninjas[0].Settings?.url ?? "").slice(0, 95)}`);
  }
  const rest = [...others].filter(([u]) => !/multiactions|page|profile/.test(u));
  if (rest.length) console.log(`    other actions: ${rest.map(([u,c]) => `${u} x${c}`).join(", ")}`);
}
