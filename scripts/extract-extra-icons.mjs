/* Grab the black "scene inactive" tile from the old profile and make a neutral tile
   for any API Ninja key that has no artwork (so the Ninja logo never shows). */
import { readdirSync, readFileSync, statSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const ROOT = process.argv[2];
const OUT = "C:/ACBreakz-Cloud/streamdeck/icons/main";
mkdirSync(OUT, { recursive: true });

let blackSrc = null;
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json" && !blackSrc) {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      for (const c of j.Controllers ?? [])
        for (const a of Object.values(c.Actions ?? {}))
          if (a.UUID === "com.elgato.obsstudio.scene" && a.States?.[1]?.Image && !blackSrc) {
            const abs = join(dirname(p), a.States[1].Image);
            if (existsSync(abs)) blackSrc = abs;
          }
    }
  }
})(ROOT);

if (!blackSrc) { console.log("could not find the inactive-scene tile"); process.exit(1); }
copyFileSync(blackSrc, join(OUT, "scene-inactive.png"));
/* the same dark tile doubles as the fallback for artless request keys */
copyFileSync(blackSrc, join(OUT, "blank.png"));
console.log("wrote scene-inactive.png and blank.png from", blackSrc.split(/[\\/]/).pop());
