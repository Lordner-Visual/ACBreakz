/* Five PCs at once — the coverage gap both existing concurrency suites leave.
   Neither of them ever presses two DIFFERENT PCs simultaneously, and neither ever
   runs an asset operation while presses are in flight.

     1. five decks pressed at the same instant, one press per PC
     2. the same, while an asset sweep (update_asset / delete_asset) rewrites every PC
     3. the same, while a five-PC master board tap runs

   2 and 3 are races, so they start the other side FIRST and repeat — a single run
   that happens to miss the window proves nothing.

   Snapshots every PC (1-5 plus PC Test) and restores them. */
import { readFileSync } from "fs";
/* refuses to run while a live PC looks busy — these suites mutate the production rows */
import { assertIdle } from "./lib/live-guard.mjs";
await assertIdle();

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}`)
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const panel = (b) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...b }) })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const rest = (p) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PCS = [1, 2, 3, 4, 5, 6];   // 6 = PC Test: separate row, so it widens the race
const TEAM = { 1: "atl", 2: "phi", 3: "mia", 4: "dal", 5: "wsh" };
const ROUNDS = Number(process.argv[2]) || 8;

const boards = async () => {
  const rows = await rest("stream_state?select=id,data&order=id");
  return Object.fromEntries(rows.map(r => [r.id, r.data?.board?.picked ?? {}]));
};
const resetAll = async () => {
  const r = await Promise.all(PCS.map(pc => deck(`action=board_reset&pc=${pc}`)));
  const bad = r.filter(x => x.status !== 200);
  if (bad.length) console.log("    !! board_reset failed: " + bad.map(x => x.status).join(","));
  await sleep(500);
  const b = await boards();                       // prove the slate really is clean
  const dirty = PCS.filter(pc => Object.keys(b[pc] ?? {}).length);
  if (dirty.length) console.log("    !! board not clean before press on PC " + dirty.join(","));
};
/* one press per PC, all at the same instant */
const pressAll = async () => {
  const res = await Promise.all(PCS.map(pc => deck(`action=team_toggle&team=${TEAM[pc]}&pc=${pc}`)));
  await sleep(1100);
  let b = await boards();
  let landed = PCS.filter(pc => b[pc]?.[TEAM[pc]] === true);
  let late = [];
  if (landed.length < 5) {          /* blocked behind a lock is not the same as lost */
    await sleep(3000);
    b = await boards();
    const now = PCS.filter(pc => b[pc]?.[TEAM[pc]] === true);
    late = now.filter(pc => !landed.includes(pc));
    landed = now;
  }
  const say = Object.fromEntries(PCS.map((pc, i) => [pc,
    `${res[i].status} ${res[i].body?.action ?? "-"} changed=${res[i].body?.changed}`]));
  return { landed, late, say, errored: res.filter(r => r.status !== 200) };
};
const missing = (landed) => PCS.filter(p => !landed.includes(p)).join(",");

const SNAP = Object.fromEntries(await Promise.all(PCS.map(async pc =>
  [pc, (await rest(`stream_state?id=eq.${pc}&select=data`))[0].data])));
console.log(`snapshot of every PC taken — restored at the end (${ROUNDS} rounds per race)\n`);
const made = [];

try {
  console.log("=== 1. five decks pressed simultaneously, nothing else running ===");
  await resetAll();
  const r1 = await pressAll();
  /* count from PCS, not a literal — adding PC Test made a correct run report 6/5 and fail */
  ok(`every press landed (${r1.landed.length}/${PCS.length}${r1.landed.length < PCS.length ? " — LOST on PC " + missing(r1.landed) : ""})`,
    r1.landed.length === PCS.length);
  ok(`no request errored (${r1.errored.length})`, r1.errored.length === 0);

  console.log("\n=== 2. five presses while an asset sweep rewrites every PC ===");
  console.log("    (the sweep starts first, so its read lands before the presses commit)");
  const someUrl = (await rest("assets?kind=eq.background&url=not.is.null&select=url&limit=1"))[0]?.url
    ?? (await rest("assets?url=not.is.null&select=url&limit=1"))[0].url;
  const probe = await panel({ action: "asset", asset: { kind: "background", name: "QA multipc probe",
    url: someUrl, meta: { type: "upload" } } });
  made.push(probe.body.asset.id);

  const lost2 = [];
  for (let i = 0; i < ROUNDS; i++) {
    /* selected on ALL five PCs, so the sweep has to rewrite every row */
    await Promise.all(PCS.map(pc => panel({ action: "patch", pc, patch: {
      background: { id: probe.body.asset.id, url: someUrl, name: "QA multipc probe", crop: null } } })));
    await resetAll();
    const sweep = panel({ action: "update_asset", id: probe.body.asset.id,
      meta: { crop: { x: 10 + i, y: 20, z: 150 } } });
    await sleep(40);
    const pr = await pressAll();
    await sweep;
    if (pr.late.length) console.log(`    round ${i + 1}: PC${pr.late.join(",")} landed late (waited on the lock)`);
    if (pr.landed.length < 5) console.log("    round " + (i + 1) + " deck said: " +
      missing(pr.landed).split(",").map(pc => "PC" + pc + " -> " + pr.say[pc]).join(" | "));
    if (pr.landed.length < 5) lost2.push(`r${i + 1}:PC${missing(pr.landed)}`);
  }
  ok(`no press lost to a concurrent asset sweep over ${ROUNDS} rounds` +
     (lost2.length ? ` — LOST in ${lost2.length}: ${lost2.join(" ")}` : ""), lost2.length === 0);

  await panel({ action: "delete_asset", id: probe.body.asset.id });
  await sleep(500);
  const afterDel = await rest("stream_state?select=id,data&order=id");
  ok(`the delete still did its job (background cleared on all five)`,
    afterDel.every(r => !r.data?.background));

  console.log("\n=== 3. five presses while a five-PC master board tap runs ===");
  const lost3 = [], aborted = [], slow = [];
  for (let i = 0; i < ROUNDS; i++) {
    await resetAll();
    const tap = panel({ action: "board",                       // no pc => all five, one transaction
      boardAction: i % 2 ? "highlight" : "unhighlight", team: "gb" });
    await sleep(25);
    const pr = await pressAll();
    const t = await tap;
    if (pr.landed.length < 5) console.log("    round " + (i + 1) + " deck said: " +
      missing(pr.landed).split(",").map(pc => "PC" + pc + " -> " + pr.say[pc]).join(" | "));
    if (pr.landed.length < 5) lost3.push(`r${i + 1}:PC${missing(pr.landed)}`);
    if (t.status !== 200) aborted.push(`r${i + 1}:tap ${t.status} ${JSON.stringify(t.body).slice(0, 70)}`);
    if (pr.late.length) slow.push(`r${i + 1}:PC${pr.late.join(",")}`);
    if (pr.errored.length) aborted.push(`r${i + 1}:press ` +
      pr.errored.map(e => e.status + " " + JSON.stringify(e.body).slice(0, 140)).join(" | "));
  }
  ok(`no press lost to a five-PC master tap over ${ROUNDS} rounds` +
     (lost3.length ? ` — LOST in ${lost3.length}: ${lost3.join(" ")}` : ""), lost3.length === 0);
  if (slow.length) console.log("    (landed late, after waiting on a lock: " + slow.join(" ") + ")");
  ok(`nothing aborted or deadlocked over ${ROUNDS} rounds` +
     (aborted.length ? ` — ${aborted.join(" | ")}` : ""), aborted.length === 0);
} finally {
  for (const id of made) await panel({ action: "purge_asset", id });
  await Promise.all(PCS.map(pc => deck(`action=board_reset&pc=${pc}`)));
  await Promise.all(PCS.map(pc => deck(`action=highlight_clear&pc=${pc}`)));
  for (const pc of PCS) await panel({ action: "state", pc, data: SNAP[pc], force: true });
  const back = Object.fromEntries(await Promise.all(PCS.map(async pc =>
    [pc, (await rest(`stream_state?id=eq.${pc}&select=data`))[0].data])));
  const bare = (d) => { const { updatedAt, lastWriter, ...x } = d; return JSON.stringify(x); };
  const bad = PCS.filter(pc => bare(back[pc]) !== bare(SNAP[pc]));
  ok(`every PC restored${bad.length ? " — MISMATCH on PC " + bad.join(",") : ""}`, bad.length === 0);
}

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
