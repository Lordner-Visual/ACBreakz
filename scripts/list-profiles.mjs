/* Every installed profile: name, pages, whether team keys carry icons, last written. */
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(process.env.APPDATA, "Elgato", "StreamDeck", "ProfilesV3");
const rows = [];
for (const prof of readdirSync(ROOT)) {
  const root = join(ROOT, prof);
  if (!statSync(root).isDirectory()) continue;
  let m; try { m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")); } catch { continue; }

  let keys = 0, iconKeys = 0, newest = 0;
  const pagesDir = join(root, "Profiles");
  if (existsSync(pagesDir)) {
    for (const page of readdirSync(pagesDir)) {
      const mf = join(pagesDir, page, "manifest.json");
      if (!existsSync(mf)) continue;
      newest = Math.max(newest, statSync(mf).mtimeMs);
      let j; try { j = JSON.parse(readFileSync(mf, "utf8")); } catch { continue; }
      for (const a of Object.values(j.Controllers?.[0]?.Actions ?? {})) {
        keys++;
        if ((a.States ?? []).some(s => s.Image)) iconKeys++;
      }
    }
  }
  rows.push({ name: m.Name ?? "(unnamed)", id: prof.slice(0, 8), keys, iconKeys,
    when: newest ? new Date(newest).toLocaleString() : "-" });
}
rows.sort((a, b) => a.name.localeCompare(b.name));
console.log("name                            id        keys  withIcons  last written");
for (const r of rows)
  console.log(`${r.name.padEnd(30)}  ${r.id}  ${String(r.keys).padStart(4)}  ${String(r.iconKeys).padStart(9)}  ${r.when}`);
