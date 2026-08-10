/* Pull a real com.elgato.streamdeck.system.open action out of the installed profiles
   so the generated dashboard button uses the exact settings shape Stream Deck writes. */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.env.APPDATA, "Elgato", "StreamDeck", "ProfilesV2");
const found = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      const visit = (a) => {
        if (!a || typeof a !== "object") return;
        if (a.UUID === "com.elgato.streamdeck.system.open") found.push(a);
        const k = a.Actions;
        if (Array.isArray(k)) k.forEach(visit);
        else if (k && typeof k === "object") Object.values(k).forEach(visit);
      };
      (j.Controllers ?? []).forEach(c => Object.values(c.Actions ?? {}).forEach(visit));
    }
  }
})(ROOT);

console.log(`found ${found.length} Open action(s)`);
found.slice(0, 3).forEach((a, i) => console.log(`\n#${i}\n` + JSON.stringify(a, null, 1)));
