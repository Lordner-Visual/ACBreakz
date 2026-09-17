/* Each overlay source tracks itself on presence:overlays as { pc, layer }. So this shows
   exactly which of the three browser sources each PC currently has running — and "stingers
   missing" with bg+hud present is the signature of an FX source that is closed or hidden.

   Since 2026-09-16 each source also reports its uptime, realtime rebuilds and backstop misses
   in the last hour, what its FX lane has done, and why it last reloaded itself — and this
   cross-checks the DATABASE: how many events were addressed to that PC after its FX source
   last heard one. That number is the direct measure of "the stingers stopped", independent
   of whatever the page believes about its own connection (presence said "data ok" for a week
   while every rig was in a rebuild loop). */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const cfg = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8");
const sb = createClient(cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1],
                        cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1],
                        { realtime: { params: { eventsPerSecond: 5 } } });

const found = new Map();                      // pc -> Set(layer)
const skew  = new Map();                      // pc -> newest (their clock - ours), ms
const info  = new Map();                      // pc -> layer -> tracked payload
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
        /* at is re-tracked every 30s, so a large NEGATIVE value is a stale track (that PC has
           not taken the build that re-tracks) and a large POSITIVE value is a fast clock —
           which used to drop every stinger before the event filter became skew-immune. */
        if (typeof m.at === "number") {
          const sk = m.at - Date.now();
          if (!skew.has(pc) || Math.abs(sk) < Math.abs(skew.get(pc))) skew.set(pc, sk);
        }
        if (m.build) {
          if (!info.has(pc)) info.set(pc, new Map());
          info.get(pc).set(m.layer ?? "?", m);
        }
      }
  };
  ch.on("presence", { event: "sync" }, read).subscribe((s) => {
    if (s === "SUBSCRIBED") setTimeout(() => { read(); ch.unsubscribe(); resolve(); }, 7000);
  });
  setTimeout(() => { try { ch.unsubscribe(); } catch (_) {} resolve(); }, 13000);
});

const hrs = (s) => s == null ? "?" : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;

console.log("browser sources currently running, per PC:");
for (const pc of [1, 2, 3, 4, 5, 6]) {
  const name = `PC${pc === 6 ? " Test" : pc}`;
  const s = found.get(pc);
  if (!s) { console.log(`  ${name}  — nothing online`); continue; }
  const want = ["bg", "hud", "fx"];
  const missing = want.filter(l => !s.has(l) && !s.has("all"));
  const sk = skew.get(pc);
  const layers = info.get(pc) ?? new Map();
  /* the FX source is the one whose hearing matters — it plays the stingers and the sound */
  const nfo = layers.get("fx") ?? layers.get("all") ?? [...layers.values()][0];
  const clock = sk === undefined ? ""
    : sk > 20000 ? `   CLOCK +${Math.round(sk / 1000)}s`
    : Math.abs(sk) < 60000 ? `   clock ${sk > 0 ? "+" : ""}${Math.round(sk / 1000)}s`
    : `   last tracked ${Math.round(-sk / 60000)}m ago`;
  /* evAge/stAge = seconds since this rig last RECEIVED a realtime message. Rising without
     limit while the server log shows traffic is the definition of a deaf rig. */
  const heard = !nfo ? "" :
    (nfo.stAge == null && nfo.evAge == null) ? "   heard nothing yet"
      : `   last heard state ${nfo.stAge == null ? "never" : nfo.stAge + "s"}` +
        `, event ${nfo.evAge == null ? "never" : nfo.evAge + "s"}`;
  const builds = [...new Set([...layers.values()].map(m => m.build))];
  const build = nfo ? `   build=${builds.join("/")}${builds.length > 1 ? " <-- MIXED" : ""}` +
                      (nfo.db && nfo.db !== "joined" ? `  DATA CHANNEL ${nfo.db} <-- deaf` : "  data ok") + heard
                    : "   build=? (pre-instrumentation)";
  console.log(`  ${name}  [${want.map(l => s.has(l) || s.has("all") ? l : "----").join(" ")}]` +
    (missing.length ? `   <-- MISSING: ${missing.join(", ")}` : "   all three up") + build + clock);

  /* per-source health, where the build reports it */
  for (const [layer, m] of layers) {
    if (m.up == null) continue;
    const bits = [`up ${hrs(m.up)}`, `rebuilds/h ${m.rb}`];
    if (m.miss) bits.push(`backstop caught ${m.miss}/h`);
    if (m.fx) bits.push(`fx played ${m.fx.played}` + (m.fx.stuck ? ` stuck ${m.fx.stuck}` : "") +
                        (m.fx.dropped ? ` dropped ${m.fx.dropped}` : "") +
                        (m.fx.busy ? ` BUSY ${Math.round(m.fx.busyMs / 1000)}s q=${m.fx.queued}` : ""));
    if (m.rl) bits.push(`last self-reload: ${m.rl.why} (${hrs(m.rl.ago)} ago)`);
    const warn = m.rb > 20 ? "   <-- REBUILD LOOP" : m.fx?.busy && m.fx.busyMs > 45000 ? "   <-- FX LANE STUCK" : "";
    console.log(`        ${layer.padEnd(3)} ${bits.join(" · ")}${warn}`);
  }

  /* the database's side of the story: events addressed to this PC that arrived after its FX
     source last heard one. evAge is a DURATION measured on that PC, so it is skew-free; 10s of
     grace covers the gap between an insert and its delivery. */
  const fxm = layers.get("fx") ?? layers.get("all");
  /* never heard one since it loaded: count from the load instead (up is also a duration) */
  const quietFor = fxm ? (fxm.evAge ?? fxm.up) : null;
  if (quietFor != null && quietFor > 10) {
    const since = new Date(Date.now() - quietFor * 1000 + 10000).toISOString();
    const { count } = await sb.from("events").select("id", { count: "exact", head: true })
      .in("pc", [0, pc]).gt("created_at", since);
    if (count) console.log(`        fx  ${count} event(s) sent to ${name} after its FX source last heard one` +
      (fxm.miss != null ? " (the backstop plays these on builds that have it)" : "   <-- DEAF TO STINGERS"));
  }
}
process.exit(0);
