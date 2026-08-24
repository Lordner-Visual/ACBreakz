/* PC 6 ("PC Test") is a staging rig: addressable by name from every writer, and deliberately
   EXCLUDED from the no-pc broadcast. Both halves matter. If it were included, an ALL-PCs write
   during a show would stamp over whatever was being tested; if it were unreachable, it would be
   useless. A silent clamp is the dangerous failure here — state_patch with a stale 1..5 range
   returns 200 having written nothing.

     node qa/shoot-pc-test.mjs                                                               */
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${B}&${q}`).then(r => r.json());
const boards = async () => Object.fromEntries((await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=id,data&order=id`, { headers: REST })
  .then(r => r.json())).map(r => [r.id, r.data]));

/* /panel is deployed WITH jwt verification, so every call needs the anon key as a bearer token
   on top of its own auth field. Omitting it 401s identically for pc 5 and pc 6, which reads
   exactly like "pc 6 is rejected" — it is not. Hence the paired pc-5 control below. */
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", ...REST },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const before = await boards();
ok("the PC Test row exists", !!before[6]);
ok("it was seeded from a live PC, not left empty", Object.keys(before[6] ?? {}).length >= 10);

/* ---- reachable by name ---- */
await deck("action=board_reset&pc=6");
await deck("action=team_pick&team=kc&pc=6");
let s = await boards();
ok("a deck press naming pc=6 lands on PC Test", !!s[6].board?.picked?.kc);

/* ---- excluded from the broadcast ---- */
await deck("action=board_reset");                    // no pc -> PCs 1-5 only
for (const t of ["dal", "sf"]) await deck(`action=team_pick&team=${t}`);
s = await boards();
ok("a no-pc press reaches all five live PCs",
  [1, 2, 3, 4, 5].every(n => s[n].board?.picked?.dal && s[n].board?.picked?.sf));
ok("a no-pc press does NOT touch PC Test",
  !s[6].board?.picked?.dal && !s[6].board?.picked?.sf);
ok("PC Test kept the state it already had", !!s[6].board?.picked?.kc);

/* ---- a broadcast reset must not clear the test rig either ---- */
await deck("action=board_reset");
s = await boards();
ok("a broadcast board_reset leaves PC Test alone", !!s[6].board?.picked?.kc);
ok("a broadcast board_reset does clear the live PCs",
  [1, 2, 3, 4, 5].every(n => Object.keys(s[n].board?.picked ?? {}).length === 0));

/* ---- the operator dashboard scope reaches it ---- */
const OP = readFileSync("C:/ACBreakz-Cloud/control/op.js", "utf8")
  .match(/ACBZ_OP\s*=\s*"([^"]+)"/)[1];
const op6 = await panel({ op: OP, pc: 6, action: "patch", patch: { __pctest_probe: true } });
const op5 = await panel({ op: OP, pc: 5, action: "patch", patch: { __pctest_probe: true } });
s = await boards();
ok("control/pc.html?pc=6 can write (operator scope accepts pc 6)",
  op6.status === 200 && !op6.body.error && s[6].__pctest_probe === true);
ok("the same call works on a live PC (isolates auth from the pc range)",
  op5.status === 200 && !op5.body.error);
ok("the operator write really landed on pc 6, not silently clamped away",
  s[6].__pctest_probe === true);

/* ---- the master panel can drive it too (token-less script auth) ---- */
const key6 = await panel({ key: env.PANEL_KEY, pc: 6, action: "patch",
  patch: { __pctest_probe2: true } });
s = await boards();
ok("a PANEL_KEY write reaches pc 6",
  key6.status === 200 && !key6.body.error && s[6].__pctest_probe2 === true);

/* cleanup */
await panel({ key: env.PANEL_KEY, pc: 6, action: "patch",
  patch: { __pctest_probe: null, __pctest_probe2: null } });
await panel({ key: env.PANEL_KEY, pc: 5, action: "patch", patch: { __pctest_probe: null } });
await deck("action=board_reset&pc=6");

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
