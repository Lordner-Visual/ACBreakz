/* Each overlay source tracks itself on presence:overlays as { pc, layer }. So this shows
   exactly which of the three browser sources each PC currently has running — and "stingers
   missing" with bg+hud present is the signature of an FX source that is closed or hidden. */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const cfg = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8");
const sb = createClient(cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1],
                        cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1],
                        { realtime: { params: { eventsPerSecond: 5 } } });

const found = new Map();
const skew  = new Map();
const info  = new Map();                      // pc -> { build, db channel state }                      // pc -> newest (their clock - ours), ms                      // pc -> Set(layer)
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
        /* Each source tracks at: Date.now() from ITS OWN clock. handleEvent discards any event
           more than 20s old by that same local clock, so a PC running fast silently drops every
           stinger. A tracked time in the FUTURE is proof of skew. */
        /* at is re-tracked every 30s, so a large NEGATIVE value is a stale track (that PC has
           not taken the build that re-tracks) and a large POSITIVE value is a fast clock —
           which silently drops every stinger, because handleEvent throws away anything more
           than 20s old by the local clock. */
        if (typeof m.at === "number") {
          const sk = m.at - Date.now();
          if (!skew.has(pc) || Math.abs(sk) < Math.abs(skew.get(pc))) skew.set(pc, sk);
        }
        if (m.build) info.set(pc, { build: m.build, db: m.db });
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
  const sk = skew.get(pc);
  /* +ve = that PC believes it is LATER than we do. Past +20s the overlay throws away its own
     stinger events; past a few seconds it is worth fixing anyway. */
  const nfo = info.get(pc);
  const clock = sk === undefined ? ""
    : sk > 20000 ? `   CLOCK +${Math.round(sk / 1000)}s  <-- DROPS EVERY STINGER`
    : Math.abs(sk) < 60000 ? `   clock ${sk > 0 ? "+" : ""}${Math.round(sk / 1000)}s`
    : `   last tracked ${Math.round(-sk / 60000)}m ago`;
  const build = nfo ? `   build=${nfo.build}` + (nfo.db && nfo.db !== "joined" ? `  DATA CHANNEL ${nfo.db} <-- deaf` : "  data ok")
                    : "   build=? (pre-instrumentation)";
  console.log(`  PC${pc === 6 ? " Test" : pc}  [${want.map(l => s.has(l) || s.has("all") ? l : "----").join(" ")}]` +
    (missing.length ? `   <-- MISSING: ${missing.join(", ")}` : "   all three up") + build + clock);
}
process.exit(0);
