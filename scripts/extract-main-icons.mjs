/* Pull the non-team button artwork (games, scenes, record/replay…) out of the old
   profile so the new main page can wear the same icons. */
import { readdirSync, readFileSync, statSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { join, dirname } from "path";

const ROOT = process.argv[2];
const OUT = "C:/ACBreakz-Cloud/streamdeck/icons/main";
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });

const TEAMS = /49ers|Bears|Bengals|Bills|Broncos|Browns|Buccaneers|Cardinals|Chargers|Chiefs|Colts|Commanders|Cowboys|Dolphins|Eagles|Falcons|Giants|Jaguars|Jets|Lions|Packers|Panthers|Patriots|Raiders|Rams|Ravens|Saints|Seahawks|Steelers|Texans|Titans|Vikings/i;

const found = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      const acts = j.Controllers?.[0]?.Actions ?? {};
      if (Object.keys(acts).length === 32) continue;          // team pages, already handled
      for (const [pos, a] of Object.entries(acts)) {
        const title = (a.States ?? []).map(s => s.Title).filter(Boolean).join(" ");
        const img = (a.States ?? []).map(s => s.Image).find(Boolean);
        if (!img || TEAMS.test(title)) continue;
        found.push({ dir: dirname(p), pos, title: title.replace(/\s+/g, " ").trim(),
                     img, uuid: a.UUID });
      }
    }
  }
})(ROOT);

console.log(`non-team keys with artwork: ${found.length}\n`);
let n = 0;
for (const f of found) {
  const safe = (f.title || `key-${f.pos}`).replace(/[^\w ]+/g, "").trim().replace(/ +/g, "-") || `key${n}`;
  const dest = join(OUT, `${safe}.png`);
  try { copyFileSync(join(f.dir, f.img), dest); n++;
    console.log(`  "${f.title}"  <- ${f.uuid.split(".").slice(-2).join(".")}`);
  } catch {}
}
console.log(`\nsaved ${n} icons to ${OUT}`);
