/* Promote staging/ over the live overlay + control pages.

   Why this exists: overlay/ and control/ are single static files that EVERY PC loads, and each
   overlay polls its own hash every 45s and reloads when it changes. So a push is not a gentle
   rollout — within ~45s all five live streams reload the new code, mid-show if that is when you
   pushed. staging/ is a second deployed copy that only PC Test points at, so changes can be
   proved on air-gapped-in-practice hardware first, and promotion is one deliberate step.

     node scripts/promote.mjs --check            what would change, and is it safe right now
     node scripts/promote.mjs                    promote if nothing looks live
     node scripts/promote.mjs --force            promote regardless (say why in the commit)
     node scripts/promote.mjs --at 2026-08-24T07:00:00Z    write the schedule marker instead

   Liveness is a JUDGEMENT, not a fact we can read: nothing here knows whether OBS is streaming.
   Two proxies are combined, and both are reported so a human can overrule:
     1. Realtime presence on "presence:overlays" — every overlay browser source tracks itself
        there, so a PC with OBS open shows up. Strongest signal available.
     2. stream_state.updated_at recency — somebody actively working a board.
   Presence needs a websocket, so this waits a few seconds for the channel to sync.            */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from "fs";
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.env.ACBZ_ROOT ?? "C:/ACBreakz-Cloud";
const PAIRS = [["staging/overlay", "overlay"], ["staging/control", "control"]];
const LIVE_PCS = [1, 2, 3, 4, 5];          // PC 6 is the staging rig; it is never "live"
const IDLE_MINUTES = Number(process.env.ACBZ_IDLE_MINUTES ?? 30);
const MARKER = `${ROOT}/staging/PROMOTE_AT`;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const CHECK = has("--check");
const FORCE = has("--force");

/* ---------- the anon key is public by design; read it out of the shipped overlay ---------- */
const cfg = readFileSync(`${ROOT}/overlay/config.js`, "utf8");
const SUPABASE_URL = cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1];
const ANON = cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1];

/* ---------- 1. what would actually change ---------- */
const sha = (p) => createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 12);
const walk = (dir, base = dir) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push({ rel: p.slice(base.length + 1), path: p, size: statSync(p).size });
  }
  return out;
};

const changes = [];
for (const [from, to] of PAIRS) {
  const src = walk(`${ROOT}/${from}`);
  for (const f of src) {
    const dst = `${ROOT}/${to}/${f.rel}`;
    const state = !existsSync(dst) ? "new"
      : sha(f.path) !== sha(dst) ? "changed" : "same";
    if (state !== "same") changes.push({ from: `${from}/${f.rel}`, to: `${to}/${f.rel}`, state, size: f.size });
  }
  /* a file deleted in staging is NOT removed from live — deleting a deployed asset is a
     different, riskier decision than updating one, and it should be explicit */
  for (const f of walk(`${ROOT}/${to}`))
    if (!existsSync(`${ROOT}/${from}/${f.rel}`))
      console.log(`note: ${to}/${f.rel} exists live but not in staging — left alone, remove by hand if intended`);
}

console.log(changes.length
  ? `${changes.length} file(s) would be promoted:\n` +
    changes.map(c => `  ${c.state.padEnd(7)} ${c.from}  ->  ${c.to}`).join("\n")
  : "staging and live are identical — nothing to promote.");

/* ---------- 2. schedule instead of promoting ---------- */
const at = valOf("--at");
if (at) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) { console.log(`\nFATAL: could not parse --at "${at}"`); process.exit(1); }
  writeFileSync(MARKER, `${new Date(t).toISOString()}\n`);
  console.log(`\nscheduled: staging/PROMOTE_AT = ${new Date(t).toISOString()}`);
  console.log("commit and push that file; the promote workflow checks it every 15 minutes.");
  process.exit(0);
}
if (!changes.length && !CHECK) process.exit(0);

/* ---------- 3. is anything live right now ---------- */
const sb = createClient(SUPABASE_URL, ANON, { realtime: { params: { eventsPerSecond: 5 } } });

const seen = new Set();
await new Promise((resolve) => {
  const ch = sb.channel("presence:overlays");
  const read = () => {
    const st = ch.presenceState();
    for (const k of Object.keys(st))
      for (const m of st[k]) if (m?.pc !== undefined) seen.add(Number(m.pc));
  };
  ch.on("presence", { event: "sync" }, read).subscribe((s) => {
    if (s === "SUBSCRIBED") setTimeout(() => { read(); ch.unsubscribe(); resolve(); }, 6000);
  });
  setTimeout(() => { try { ch.unsubscribe(); } catch (_) {} resolve(); }, 12000);
});

const { data: rows } = await sb.from("stream_state").select("id,updated_at").in("id", LIVE_PCS);
const now = Date.now();
const recent = (rows ?? []).filter(r => (now - Date.parse(r.updated_at)) / 60000 < IDLE_MINUTES);

const onlineLive = [...seen].filter(p => LIVE_PCS.includes(p)).sort();
console.log(`\nliveness:`);
console.log(`  overlay sources present: ${onlineLive.length ? onlineLive.map(p => "PC" + p).join(", ") : "none"}` +
  `${seen.has(6) ? "  (PC Test also present)" : ""}`);
console.log(`  boards touched in the last ${IDLE_MINUTES}m: ` +
  (recent.length ? recent.map(r => `PC${r.id} ${Math.round((now - Date.parse(r.updated_at)) / 60000)}m ago`).join(", ") : "none"));

const busy = onlineLive.length > 0 || recent.length > 0;
if (CHECK) {
  console.log(`\nverdict: ${busy ? "NOT SAFE — something looks live" : "safe to promote"}`);
  process.exit(0);
}
if (busy && !FORCE) {
  console.log("\nREFUSING to promote: a live PC would reload mid-show within ~45s.");
  console.log("Re-run with --force to override, or --at <iso> to schedule it.");
  process.exit(2);
}

/* ---------- 4. promote ---------- */
for (const c of changes) writeFileSync(`${ROOT}/${c.to}`, readFileSync(`${ROOT}/${c.from}`));
if (existsSync(MARKER)) rmSync(MARKER);
console.log(`\npromoted ${changes.length} file(s)${FORCE && busy ? "  (FORCED while live)" : ""}.`);
console.log("commit + push to deploy; every overlay picks it up within ~45s.");
process.exit(0);
