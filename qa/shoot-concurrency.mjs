/* Concurrency acceptance — every board write that reaches the server must apply.

   Before the V11 atomic fix this FAILS loudly: the deck function does
   read -> mutate in JS -> write whole doc with no lock, so concurrent presses
   erase each other, and a panel push ships a stale `board` that reverts them.

   Runs on one idle PC and restores its exact state. Node only, no browser. */
import { readFileSync } from "fs";

const PC = Number(process.argv[2]) || 5;
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}&pc=${PC}`)
  .then(r => r.json().catch(() => ({})));
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const rest = (path) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json());
const board = async () => {
  const d = (await rest(`stream_state?id=eq.${PC}&select=data`))[0].data;
  return { picked: d.board?.picked ?? {}, highlighted: d.board?.highlighted ?? {}, data: d };
};
const onlyTrue = (o) => Object.keys(o).filter(k => o[k]).sort();
const eventsSince = async (iso, type) =>
  (await rest(`events?created_at=gte.${encodeURIComponent(iso)}&type=eq.${type}&select=payload,created_at`))
    .filter(e => Number(e.payload?.pc) === PC);

const TEAMS = ["atl","phi","mia","dal","wsh","ind","kc","lac","ari","sf","tb","cle"];

const ORIGINAL = (await board()).data;
console.log(`snapshot of PC${PC} taken (${JSON.stringify(ORIGINAL).length} bytes) — restored at the end\n`);

/* warm the edge function: a cold start serialises the burst and would mask the bug */
await deck("action=board_reset");
await deck("action=highlight_clear");
await new Promise(r => setTimeout(r, 500));

console.log("=== 1. twelve distinct teams, pressed simultaneously ===");
let t0 = new Date().toISOString();
await deck("action=board_reset");
await new Promise(r => setTimeout(r, 400));
await Promise.all(TEAMS.map(t => deck(`action=team_toggle&team=${t}`)));
await new Promise(r => setTimeout(r, 1200));
let b = await board();
let got = onlyTrue(b.picked);
ok(`all 12 presses landed (${got.length}/12 eliminated${got.length < 12
  ? " — LOST: " + TEAMS.filter(t => !got.includes(t)).join(",") : ""})`, got.length === 12);
let evs = await eventsSince(t0, "team_pick");
ok(`exactly 12 team_pick events fired, one per team (${evs.length})`, evs.length === 12);

console.log("\n=== 2. same team, eight simultaneous toggles (parity must hold) ===");
t0 = new Date().toISOString();
await deck("action=board_reset");
await new Promise(r => setTimeout(r, 400));
await Promise.all(Array.from({ length: 8 }, () => deck("action=team_toggle&team=kc")));
await new Promise(r => setTimeout(r, 1200));
b = await board();
ok(`8 toggles = even number = KC back on the board (picked.kc=${!!b.picked.kc})`, !b.picked.kc);
const picks = (await eventsSince(t0, "team_pick")).filter(e => e.payload?.team === "kc").length;
const rests = (await eventsSince(t0, "team_restore")).filter(e => e.payload?.team === "kc").length;
ok(`serialised into 4 eliminations + 4 restores (got ${picks} + ${rests})`, picks === 4 && rests === 4);

console.log("\n=== 3. panel pushes hammering deck presses ===");
await deck("action=board_reset");
await deck("action=highlight_clear");
for (const t of ["gb", "det"]) await deck(`action=highlight&team=${t}`);
await new Promise(r => setTimeout(r, 600));
const hlBefore = onlyTrue((await board()).highlighted);
const ten = TEAMS.slice(0, 10);
for (let i = 0; i < ten.length; i++) {
  const cur = (await board()).data;
  await Promise.all([
    panel({ action: "state", pc: PC, data: { ...cur, boardGap: i + 1, updatedAt: Date.now() } }),
    deck(`action=team_toggle&team=${ten[i]}`),
  ]);
}
await new Promise(r => setTimeout(r, 1200));
b = await board();
got = onlyTrue(b.picked);
ok(`no deck press reverted by a concurrent panel push (${got.length}/10${got.length < 10
  ? " — LOST: " + ten.filter(t => !got.includes(t)).join(",") : ""})`, got.length === 10);
ok(`the panel's own change survived too (boardGap=${b.data.boardGap})`, b.data.boardGap === 10);
ok(`a boardGap push left highlights untouched (${onlyTrue(b.highlighted).join(",") || "none"})`,
  JSON.stringify(onlyTrue(b.highlighted)) === JSON.stringify(hlBefore));

console.log("\n=== 4. highlight and eliminate the same team at once ===");
await deck("action=board_reset");
await deck("action=highlight_clear");
await new Promise(r => setTimeout(r, 400));
await Promise.all([deck("action=highlight&team=sea"), deck("action=team_toggle&team=sea")]);
await new Promise(r => setTimeout(r, 1200));
b = await board();
ok(`both subtrees survived (highlighted.sea=${!!b.highlighted.sea} picked.sea=${!!b.picked.sea})`,
  b.highlighted.sea === true && b.picked.sea === true);

console.log("\n=== 5. semantics still hold ===");
await deck("action=board_reset");
await new Promise(r => setTimeout(r, 500));
b = await board();
ok(`board_reset clears picked but keeps highlights (${onlyTrue(b.highlighted).join(",") || "none"})`,
  Object.keys(onlyTrue(b.picked)).length === 0 && b.highlighted.sea === true);
await deck("action=team_toggle&team=sea");
await deck("action=highlight_clear");
await new Promise(r => setTimeout(r, 600));
b = await board();
ok(`highlight_clear clears highlights but keeps picked (picked.sea=${!!b.picked.sea})`,
  onlyTrue(b.highlighted).length === 0 && b.picked.sea === true);

/* ---- restore ---- */
await deck("action=board_reset");
await deck("action=highlight_clear");
const res = await panel({ action: "state", pc: PC, data: ORIGINAL, force: true });
const back = (await board()).data;
/* updatedAt/lastWriter are stamped server-side on every write now, so compare
   everything else — those two fields are expected to differ after a restore. */
const bare = (d) => { const { updatedAt, lastWriter, ...rest } = d; return JSON.stringify(rest); };
ok(`PC${PC} restored (${res.ok ? "written" : JSON.stringify(res)})`, bare(back) === bare(ORIGINAL));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
