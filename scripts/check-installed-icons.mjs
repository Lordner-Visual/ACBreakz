/* Which ACBreakz Cloud profiles are installed, and do their team keys carry icons? */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.env.APPDATA, "Elgato", "StreamDeck", "ProfilesV3");
for (const prof of readdirSync(ROOT)) {
  const root = join(ROOT, prof);
  if (!statSync(root).isDirectory()) continue;
  let m; try { m = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")); } catch { continue; }
  if (!/ACBreakz Cloud/i.test(m.Name ?? "")) continue;

  let teamPages = 0, withIcons = 0, sample = null, mtime = null;
  (function walk(d) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === "manifest.json") {
        const st = statSync(p); if (!mtime || st.mtime > mtime) mtime = st.mtime;
        let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
        const acts = j.Controllers?.[0]?.Actions ?? {};
        if (Object.keys(acts).length !== 32) return;
        teamPages++;
        const k = Object.values(acts)[0];
        const imgs = (k.States ?? []).map(s => s.Image).filter(Boolean);
        if (imgs.length) { withIcons++; sample ??= imgs; }
      }
    }
  })(root);

  console.log(`\n"${m.Name}"  (${prof.slice(0, 8)})`);
  console.log(`   last written : ${mtime?.toLocaleString()}`);
  console.log(`   32-key pages : ${teamPages}, with icons: ${withIcons}`);
  console.log(`   sample images: ${sample ? sample.join(", ") : "(none — keys have no icons)"}`);
}
