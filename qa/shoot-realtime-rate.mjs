/* MessagePerSecondRateLimitReached — measure what ONE overlay source actually receives.

   Every press costs a client TWO postgres_changes messages: the stream_state UPDATE for its own
   PC, and the events INSERT. events is subscribed UNFILTERED (its pc lives inside jsonb and
   realtime filters only work on real columns), so a source also receives every OTHER PC's
   events and throws them away. The overlay creates its client with no realtime params at all,
   which means the supabase-js default of 10 messages/second.

   So this compares the three ways to clear or restore a board and reports messages/second at the
   client — the number the rate limit actually judges.

     node qa/shoot-realtime-rate.mjs                                                          */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const PC = 6;                                   // the staging rig; never a live show
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const deck = (q) => fetch(`${B}&${q}&pc=${PC}`).then(r => r.status);

/* subscribe EXACTLY as the overlay does, including the unfiltered events binding */
/* RATE lets us compare the shipped default against a raised ceiling on identical work.
   The overlay creates its client with no realtime params, i.e. supabase-js default 10/s. */
const RATE = Number(process.argv[2] || 0);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY,
  RATE ? { realtime: { params: { eventsPerSecond: RATE } } } : undefined);
console.log(RATE ? `client rate: ${RATE}/s` : "client rate: DEFAULT (10/s)");
let stateMsgs = 0, eventMsgs = 0, stamps = [];
await new Promise((res, rej) => {
  sb.channel("db")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "stream_state",
        filter: `id=eq.${PC}` }, () => { stateMsgs++; stamps.push(Date.now()); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" },
        () => { eventMsgs++; stamps.push(Date.now()); })
    .subscribe((s) => { if (s === "SUBSCRIBED") res(); if (s === "CHANNEL_ERROR") rej(new Error(s)); });
  setTimeout(() => rej(new Error("subscribe timed out")), 15000);
});
console.log("subscribed as an overlay would (state filtered, events UNfiltered)\n");

const TEAMS = ["atl","phi","mia","dal","wsh","ind","kc","lac","ari","sf","tb","cle","den","buf",
               "cin","chi","min","ten","hou","pit","sea","no","lar","lv","ne","car","gb","det",
               "jax","nyj","nyg","bal"];

const measure = async (label, fn) => {
  stateMsgs = 0; eventMsgs = 0; stamps = [];
  const t0 = Date.now();
  await fn();
  await new Promise(r => setTimeout(r, 4000));         // let the tail arrive
  const total = stateMsgs + eventMsgs;
  const span = Math.max(0.001, (Math.max(...stamps, t0) - t0) / 1000);
  const peak = (() => {                                 // busiest 1s window
    let best = 0;
    for (const s of stamps) best = Math.max(best, stamps.filter(x => x >= s && x < s + 1000).length);
    return best;
  })();
  console.log(`${label}`);
  console.log(`  messages to this ONE source: ${total}  (state ${stateMsgs} + events ${eventMsgs})`);
  console.log(`  spread over ${span.toFixed(1)}s, peak ${peak}/second` +
    (peak > 10 ? "   <-- OVER the default 10/s client cap" : ""));
  return { total, peak };
};

/* set the board fully eliminated so each variant has the same work to undo */
const fill = async () => { for (const t of TEAMS) await deck(`action=team_pick&team=${t}`); };

await deck("action=board_reset");
await fill();
const a = await measure("A. restoring all 32 teams ONE KEY AT A TIME",
  async () => { for (const t of TEAMS) await deck(`action=team_restore&team=${t}`); });

await fill();
const b = await measure("\nB. one press of RESET BOARD (board_reset)",
  () => deck("action=board_reset"));

await fill();
await deck("action=board_reset_toggle");              // clears + stashes
const c = await measure("\nC. one press of the UNDO half of RESET TEAMS (board_reset_toggle)",
  () => deck("action=board_reset_toggle"));

console.log(`\nsummary — cost of putting a full board back:`);
console.log(`  one key at a time : ${a.total} messages, peak ${a.peak}/s`);
console.log(`  Reset Board       : ${b.total} messages, peak ${b.peak}/s`);
console.log(`  Reset Teams undo  : ${c.total} messages, peak ${c.peak}/s`);
console.log(`  individual is ${(a.total / Math.max(1, c.total)).toFixed(0)}x the traffic of the undo key.`);

await deck("action=board_reset");
process.exit(0);
