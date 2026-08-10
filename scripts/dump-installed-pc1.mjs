/* What does the installed ACBreakz Cloud PC1 profile actually contain? */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.env.APPDATA, "Elgato", "StreamDeck", "ProfilesV3");
const prof = readdirSync(ROOT).find(p => {
  try { return /ACBreakz Cloud PC1/i.test(
    JSON.parse(readFileSync(join(ROOT, p, "manifest.json"), "utf8")).Name ?? ""); } catch { return false; }
});
if (!prof) { console.log("not installed"); process.exit(0); }
const root = join(ROOT, prof);
const top = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
console.log(`profile "${top.Name}"  pages listed: ${top.Pages?.Pages?.length ?? 0}`);

(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json" && d !== root) {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
      const acts = j.Controllers?.[0]?.Actions ?? {};
      const n = Object.keys(acts).length;
      if (!n) return;
      const imgs = readdirSync(join(d, "Images")).length
        ? readdirSync(join(d, "Images")).length : 0;
      console.log(`\n page ${d.split(/[\\/]/).pop().slice(0,8)} — ${n} keys, ${imgs} images on disk`);
      Object.entries(acts).slice(0, 3).forEach(([pos, a]) => {
        const st = (a.States ?? []).map(s => s.Image ?? s.Title ?? "-").join(" | ");
        console.log(`   ${pos}  ${a.UUID.split(".").slice(-2).join(".")}  states: ${st}`);
      });
    }
  }
})(root);
