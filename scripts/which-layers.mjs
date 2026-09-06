/* Each overlay source tracks itself on presence:overlays as { pc, layer }. So this shows
   exactly which of the three browser sources each PC currently has running — and "stingers
   missing" with bg+hud present is the signature of an FX source that is closed or hidden. */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const cfg = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8");
const sb = createClient(cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1],
                        cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1],
                        { realtime: { params: { eventsPerSecond: 5 } } });

const found = new Map();                      // pc -> Set(layer)
await new Promise((resolve) => {
  const ch = sb.channel("presence:overlays");
  const read = () => {
    const st = ch.presenceState();
    for (const k of Object.keys(st))
      for (const m of st[k]) {
        if (m?.pc === undefined) continue;
        const pc = Number(m.pc);
        if (!found.has(pc)) found.set(pc, new Set());
        found.get(pc).add(m.layer ?? "?");
      }
  };
  ch.on("presence", { event: "sync" }, read).subscribe((s) => {
    if (s === "SUBSCRIBED") setTimeout(() => { read(); ch.unsubscribe(); resolve(); }, 7000);
  });
  setTimeout(() => { try { ch.unsubscribe(); } catch (_) {} resolve(); }, 13000);
});

console.log("browser sources currently running, per PC:");
for (const pc of [1, 2, 3, 4, 5, 6]) {
  const s = found.get(pc);
  if (!s) { console.log(`  PC${pc === 6 ? " Test" : pc}  — nothing online`); continue; }
  const want = ["bg", "hud", "fx"];
  const missing = want.filter(l => !s.has(l) && !s.has("all"));
  console.log(`  PC${pc === 6 ? " Test" : pc}  [${want.map(l => s.has(l) || s.has("all") ? l : "----").join(" ")}]` +
    (missing.length ? `   <-- MISSING: ${missing.join(", ")}` : "   all three up"));
}
process.exit(0);
