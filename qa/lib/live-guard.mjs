/* Refuse to disturb a live PC.

   Why it exists: several suites mutate the PRODUCTION rows — shoot-multipc deletes an asset and
   asserts every board's background clears, verify-sd-profile board_resets all five, others
   toggle real teams. Run mid-show that is bad on its own, but it also caused a subtler outage:
   a banner or background that momentarily 404s during a test was latched by the overlay and
   stayed blank until somebody physically refreshed the OBS source. The overlay now backs off
   instead of latching; this stops the other half.

       import { assertIdle } from "./lib/live-guard.mjs";
       await assertIdle();                      // exits 3 if anything looks live

   Or, to skip only the destructive part of an otherwise-safe suite:

       if (await isIdle()) { ...live fire... } else { console.log("skipped: a PC is live"); }

   Deliberate override:  ACBZ_ALLOW_LIVE=1 node qa/shoot-multipc.mjs
   PC 6 (PC Test) never counts as live — that is the entire point of having it.

   No side effects on import: a module that exits the process merely for being imported cannot
   be used for the second form above.                                                        */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const LIVE_PCS = [1, 2, 3, 4, 5];
const IDLE_MINUTES = Number(process.env.ACBZ_IDLE_MINUTES ?? 20);

let cached = null;

export async function liveness() {
  if (cached) return cached;
  if (process.env.ACBZ_ALLOW_LIVE === "1") return (cached = { online: [], busy: [], overridden: true });

  const cfg = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8");
  const url = cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1];
  const anon = cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1];
  const sb = createClient(url, anon, { realtime: { params: { eventsPerSecond: 5 } } });

  /* presence is the strong signal: an overlay browser source reports itself while OBS holds it
     open. Nothing here can see whether OBS is actually STREAMING, so this stays a proxy. */
  const seen = new Set();
  await new Promise((resolve) => {
    const ch = sb.channel("presence:overlays");
    const read = () => {
      const st = ch.presenceState();
      for (const k of Object.keys(st))
        for (const m of st[k]) if (m?.pc !== undefined) seen.add(Number(m.pc));
    };
    ch.on("presence", { event: "sync" }, read).subscribe((s) => {
      if (s === "SUBSCRIBED") setTimeout(() => { read(); ch.unsubscribe(); resolve(); }, 5000);
    });
    setTimeout(() => { try { ch.unsubscribe(); } catch (_) {} resolve(); }, 11000);
  });

  const { data: rows } = await sb.from("stream_state").select("id,updated_at").in("id", LIVE_PCS);
  const now = Date.now();
  return (cached = {
    online: [...seen].filter(p => LIVE_PCS.includes(p)).sort(),
    busy: (rows ?? []).filter(r => (now - Date.parse(r.updated_at)) / 60000 < IDLE_MINUTES)
      .map(r => ({ pc: r.id, mins: Math.round((now - Date.parse(r.updated_at)) / 60000) })),
    overridden: false,
  });
}

export async function isIdle() {
  const l = await liveness();
  return l.overridden || (!l.online.length && !l.busy.length);
}

export function describe(l) {
  const bits = [];
  if (l.online.length) bits.push(`overlay sources present on ${l.online.map(p => "PC" + p).join(", ")}`);
  if (l.busy.length) bits.push(`boards written recently: ${l.busy.map(b => `PC${b.pc} ${b.mins}m ago`).join(", ")}`);
  return bits.join("; ") || "nothing live";
}

export async function assertIdle() {
  const l = await liveness();
  if (l.overridden) { console.log("[live-guard] ACBZ_ALLOW_LIVE=1 — disturbing production on purpose.\n"); return; }
  if (l.online.length || l.busy.length) {
    console.error(`\n[live-guard] REFUSING to run: this suite writes to the production rows.`);
    console.error(`  ${describe(l)}`);
    console.error(`  Point it at PC Test where the suite takes a pc argument, wait for the rigs to`);
    console.error(`  go idle, or set ACBZ_ALLOW_LIVE=1 if you accept disturbing a show.\n`);
    process.exit(3);
  }
  console.log("[live-guard] no live PC detected — safe to run.\n");
}
