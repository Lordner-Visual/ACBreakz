/* V15 — the undoable RESET TEAMS / CLEAR HIGHLIGHTS deck keys, driven through the real
   /deck endpoint rather than the RPC, so this covers the edge function's action list too.

   The assertion that matters most is the event one: the clearing half must emit ONE
   board_reset, and the undo half must emit NOTHING. Restoring 32 eliminations by emitting a
   team_pick each would fire 32 stingers at once for a single press. The overlay puts the dim
   back on its own, from applyState.

     node qa/shoot-reset-undo.mjs                                                          */
import { readFileSync } from "fs";
/* refuses to run while a live PC looks busy — these suites mutate the production rows */
import { assertIdle } from "./lib/live-guard.mjs";
await assertIdle();

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const PC = Number(process.argv[2] ?? 5);
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = async (q) => {
  const r = await fetch(`${B}&${q}&pc=${PC}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`deck ${q} -> ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return j;
};
const board = async () => {
  const rows = await fetch(
    `${env.SUPABASE_URL}/rest/v1/stream_state?select=data&id=eq.${PC}`, { headers: REST })
    .then(r => r.json());
  const d = rows[0]?.data ?? {};
  return { picked: Object.keys(d.board?.picked ?? {}).sort(),
           hl: Object.keys(d.board?.highlighted ?? {}).sort(),
           undoPicked: Object.keys(d.undo?.picked ?? {}).sort(),
           undoHl: Object.keys(d.undo?.highlighted ?? {}).sort() };
};
/* Count events for THIS pc emitted by ONE call, anchored on the last event id rather than a
   timestamp window: a couple of seconds of lookback also catches the setup's own board_reset
   and its team_picks, which is exactly how this suite first reported three false failures.
   The insert shares board_action's transaction, so it is visible the moment the call returns. */
/* events.id is a UUID, NOT a sequence — `id=gt.` and `order=id.asc` are meaningless on it and
   silently match nothing, which reads as "no event was emitted". Anchor on created_at. */
const lastEventAt = async () => {
  const rows = await fetch(
    `${env.SUPABASE_URL}/rest/v1/events?select=created_at&order=created_at.desc&limit=1`,
    { headers: REST }).then(r => r.json());
  return Array.isArray(rows) && rows[0] ? rows[0].created_at : "1970-01-01T00:00:00Z";
};
const eventsAfter = async (ts) => {
  const rows = await fetch(`${env.SUPABASE_URL}/rest/v1/events` +
    `?select=type,payload,created_at&created_at=gt.${encodeURIComponent(ts)}` +
    `&order=created_at.asc&limit=200`, { headers: REST })
    .then(r => r.json());
  return (Array.isArray(rows) ? rows : [])
    .filter(e => Number(e.payload?.pc) === PC)
    .reduce((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a; }, {});
};

const before = await board();
console.log(`PC${PC} before: picked=[${before.picked}] hl=[${before.hl}]\n`);

/* ---------- eliminations ---------- */
await deck("action=board_reset");
for (const t of ["kc", "phi", "buf", "gb"]) await deck(`action=team_pick&team=${t}`);

let mark = await lastEventAt();
const clear = await deck("action=board_reset_toggle");
let s = await board();
ok("press 1 clears every elimination", s.picked.length === 0);
ok("press 1 stashes exactly what was on the board", s.undoPicked.join() === "buf,gb,kc,phi");
ok("the deck response carries the snapshot so a key can paint UNDO",
  Object.keys(clear.results?.[0]?.undo?.picked ?? {}).length === 4);
let ev = await eventsAfter(mark);
ok("clearing emits exactly one board_reset event", ev.board_reset === 1);

mark = await lastEventAt();
await deck("action=board_reset_toggle");
s = await board();
ok("press 2 puts all four back", s.picked.join() === "buf,gb,kc,phi");
ok("press 2 spends the snapshot", s.undoPicked.length === 0);
ev = await eventsAfter(mark);
ok("undo emits NO board_reset (it would clear every dim timer)", !ev.board_reset);
ok("undo emits NO team_pick (32 stingers for one press)", !ev.team_pick);

await deck("action=board_reset_toggle");
ok("press 3 clears again", (await board()).picked.length === 0);

/* ---------- highlights use a separate snapshot ---------- */
await deck("action=highlight_clear");
for (const t of ["dal", "sf"]) await deck(`action=highlight&team=${t}`);
await deck("action=team_pick&team=ne");
await deck("action=highlight_clear_toggle");
s = await board();
ok("clearing highlights leaves eliminations alone", s.hl.length === 0 && s.picked.join() === "ne");
ok("the two snapshots are independent",
  s.undoHl.join() === "dal,sf" && s.undoPicked.join() === "kc,phi,buf,gb".split(",").sort().join());
await deck("action=highlight_clear_toggle");
s = await board();
ok("undo restores the highlights only", s.hl.join() === "dal,sf" && s.picked.join() === "ne");

/* ---------- a no-op press must stay a no-op ---------- */
await deck("action=highlight_clear_toggle");        // clear + stash
await deck("action=highlight_clear_toggle");        // restore + spend
await deck("action=highlight_clear");               // clear WITHOUT stashing
s = await board();
const noop = await deck("action=highlight_clear_toggle");
const after = await board();
ok("nothing live and nothing stashed changes nothing",
  noop.results?.[0]?.changed === false && after.hl.length === 0 && after.undoHl.length === 0);

/* ---------- a team key still works normally alongside all this ---------- */
const tog = await deck("action=team_toggle&team=ari");
ok("team_toggle still reports its paint token", ["out", "in"].includes(tog.state));
await deck("action=team_toggle&team=ari");

/* ---------- leave the board as we found it ---------- */
await deck("action=board_reset");
await deck("action=highlight_clear");
for (const t of before.picked) await deck(`action=team_pick&team=${t}`);
for (const t of before.hl) await deck(`action=highlight&team=${t}`);
const end = await board();
ok("board restored to how the suite found it",
  end.picked.join() === before.picked.join() && end.hl.join() === before.hl.join());

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
