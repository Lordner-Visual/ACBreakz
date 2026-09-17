/* PC 7 ("Dev") is the test rig: addressable by name from every writer, and deliberately EXCLUDED
   from the no-pc broadcast. Both halves matter. If it were included, an ALL-PCs write during a
   show would stamp over whatever was being tested; if it were unreachable, it would be useless.
   A silent clamp is the dangerous failure here — state_patch with a stale 1..6 range returns 200
   having written nothing.

   V18 also moved PC 6 ("PC Test") INTO the broadcast: that profile was installed on a real
   streamer's OBS, so it is a live PC that has not been renamed yet.

   Two parts. The first changes nothing on any live board and always runs — the broadcast list is
   proven with an empty patch (it only restamps updatedAt) and a deck unhighlight of a team that
   does not exist. The second really eliminates and resets teams on every live PC, so it runs only
   when nothing looks live (qa/lib/live-guard.mjs), or with ACBZ_ALLOW_LIVE=1.

     node qa/shoot-dev.mjs                                                                     */
import { readFileSync } from "fs";
import { isIdle, describe, liveness } from "./lib/live-guard.mjs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const DEV = 7, LIVE = [1, 2, 3, 4, 5, 6];

let fails = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "   " + x : ""}`); if (!c) fails++; };
const deck = (q) => fetch(`${B}&${q}`).then(r => r.json());
const boards = async () => Object.fromEntries((await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=id,data&order=id`, { headers: REST })
  .then(r => r.json())).map(r => [r.id, r.data]));
const sql = (q) => fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
  method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }) }).then(r => r.json());

/* /panel is deployed WITH jwt verification, so every call needs the anon key as a bearer token
   on top of its own auth field. Omitting it 401s identically for every pc, which reads exactly
   like "pc 7 is rejected" — it is not. Hence the paired live-PC control below. */
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", ...REST },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const OP = readFileSync("C:/ACBreakz-Cloud/control/op.js", "utf8").match(/ACBZ_OP\s*=\s*"([^"]+)"/)[1];

/* ================= part 1: touches only Dev ================= */
const before = await boards();
ok("the Dev row exists", !!before[DEV]);
ok("it was seeded from a production board, not left empty", Object.keys(before[DEV] ?? {}).length >= 10);

await deck(`action=board_reset&pc=${DEV}`);
const pick = await deck(`action=team_pick&team=kc&pc=${DEV}`);
let s = await boards();
ok("a deck press naming pc=7 lands on Dev", !!s[DEV].board?.picked?.kc && JSON.stringify(pick.pcs) === "[7]");

const probe = Math.random().toString(36).slice(2);
const opDev = await panel({ op: OP, pc: DEV, action: "patch", patch: { __dev_probe: probe } });
const opLive = await panel({ op: OP, pc: 5, action: "patch", patch: {} });
s = await boards();
ok("the operator dashboard can write pc 7, and it really landed there",
  opDev.status === 200 && !opDev.body.error && s[DEV].__dev_probe === probe);
ok("the same call works on a live PC (isolates auth from the pc range)", opLive.status === 200 && !opLive.body.error);
const keyDev = await panel({ key: env.PANEL_KEY, pc: DEV, action: "patch", patch: { __dev_probe: probe + "2" } });
s = await boards();
ok("a PANEL_KEY write reaches pc 7", keyDev.status === 200 && !keyDev.body.error && s[DEV].__dev_probe === probe + "2");

/* the broadcast list, without changing a single live board */
const all = await panel({ key: env.PANEL_KEY, pc: "all", action: "patch", patch: {} });
ok("ALL PCs means 1-6: PC Test included, Dev excluded",
  Object.keys(all.body.docs ?? {}).sort().join() === LIVE.join(), JSON.stringify(Object.keys(all.body.docs ?? {})));
const b0 = await boards();
const noop = await deck("action=unhighlight&team=zz_probe");
const b1 = await boards();
ok("a deck call with no pc targets PCs 1-6", JSON.stringify(noop.pcs) === JSON.stringify(LIVE), JSON.stringify(noop.pcs));
ok("...and that probe changed no board", Object.keys(b0).every(id => JSON.stringify(b0[id].board) === JSON.stringify(b1[id].board)));

/* ================= part 2: real presses on every live PC ================= */
if (!(await isIdle())) {
  console.log(`\nskipped the live broadcast presses: ${describe(await liveness())}`);
} else {
  await deck("action=board_reset");                    // no pc -> PCs 1-6
  for (const t of ["dal", "sf"]) await deck(`action=team_pick&team=${t}`);
  s = await boards();
  ok("a no-pc press reaches all six live PCs, PC Test included",
    LIVE.every(n => s[n].board?.picked?.dal && s[n].board?.picked?.sf));
  ok("a no-pc press does NOT touch Dev", !s[DEV].board?.picked?.dal && !s[DEV].board?.picked?.sf);
  ok("Dev kept the state it already had", !!s[DEV].board?.picked?.kc);
  await deck("action=board_reset");
  s = await boards();
  ok("a broadcast board_reset leaves Dev alone", !!s[DEV].board?.picked?.kc);
  ok("a broadcast board_reset does clear the live PCs",
    LIVE.every(n => Object.keys(s[n].board?.picked ?? {}).length === 0));
}

/* cleanup: Dev only */
await sql(`update public.stream_state set data = data - '__dev_probe' where id = ${DEV}`);
await deck(`action=board_reset&pc=${DEV}`);

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
