/* Are the icons really embedded, and do the team keys reference them? */
import { readFileSync } from "fs";
import JSZip from "jszip";

const zip = await JSZip.loadAsync(readFileSync(
  "C:/ACBreakz-Cloud/streamdeck/ACBreakz Cloud PC1.local.streamDeckProfile"));
const names = Object.keys(zip.files);
const imgs = names.filter(n => n.endsWith(".png"));
console.log(`png entries in the zip: ${imgs.length}`);
console.log("  samples:", imgs.slice(0, 4).map(n => n.split("/").slice(-2).join("/")).join(", "));

for (const n of names.filter(n => n.endsWith("manifest.json"))) {
  const j = JSON.parse(await zip.file(n).async("string"));
  const acts = j.Controllers?.[0]?.Actions;
  if (!acts || Object.keys(acts).length !== 32) continue;
  const k = acts["0,0"];
  console.log(`\npage with 32 keys -> key 0,0 (${k.UUID.split(".").pop()})`);
  console.log("  States:", JSON.stringify(k.States));
  /* does the referenced file exist inside the zip, next to this manifest? */
  const base = n.replace(/manifest\.json$/, "");
  for (const s of k.States ?? []) {
    if (!s.Image) { console.log("  !! state has no Image"); continue; }
    const full = base + s.Image;
    const hit = zip.file(full) || zip.file(full + ".png");
    console.log(`  ${s.Image} -> ${hit ? "present" : "MISSING in zip"}`);
  }
}
