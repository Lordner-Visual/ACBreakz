/* Acceptance: highlights survive elimination and never restore a team.
   - eliminating a highlighted team keeps highlighted[team] in state (deck icons stay
     synced) while the overlay hides the animation (.hl only when not picked)
   - highlight/unhighlight/toggle work on an eliminated team WITHOUT bringing it back
   - only team_toggle/team_restore return a team; the surviving star lights right up
   Runs deck-first against one idle PC and restores its exact state. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const PC = Number(process.argv[2]) || 5;
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (a) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${a}&pc=${PC}`)
  .then(r => r.json());
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const readState = () =>
  fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.${PC}&select=data`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
    .then(r => r.json()).then(rows => rows[0].data);

const ORIGINAL = await readState();
console.log(`snapshot of PC${PC} taken — restored at the end\n`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=hud&pc=${PC}`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2000);

const cellOf = (team) => ov.evaluate((t) => {
  const cell = document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf(t)];
  return { on: cell.classList.contains("on"), hl: cell.classList.contains("hl") };
}, team);
const until = async (pred, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred(await cellOf("kc"))) return Date.now() - t0;
    await ov.waitForTimeout(120);
  }
  return -1;
};

/* clean slate */
await deck("action=board_reset");
await deck("action=highlight_clear");
await deck("action=highlight&team=kc");
await deck("action=highlight&team=phi");
let took = await until(c => c.hl && !c.on);
ok(`baseline: KC highlighted and on the board (${took}ms)`, took >= 0);

/* 1. eliminate a highlighted team — star is REMEMBERED, animation hidden */
await deck("action=team_toggle&team=kc");
took = await until(c => c.on && !c.hl);
let s = await readState();
ok(`eliminating KC hides its highlight on the overlay (${took}ms)`, took >= 0);
ok(`...but state still remembers highlighted.kc = ${s.board.highlighted?.kc}`,
  s.board.highlighted?.kc === true);

/* 2. highlight actions on an eliminated team NEVER bring it back */
await deck("action=highlight_toggle&team=kc");
await new Promise(r => setTimeout(r, 800));
s = await readState();
ok(`highlight_toggle while eliminated: star off (${s.board.highlighted?.kc ?? "gone"}), team STAYS out (picked=${s.board.picked?.kc})`,
  !s.board.highlighted?.kc && s.board.picked?.kc === true);
await deck("action=highlight&team=kc");
await new Promise(r => setTimeout(r, 800));
s = await readState();
const kcCell = await cellOf("kc");
ok(`highlight while eliminated: star back on in state, team STILL out, still no animation`,
  s.board.highlighted?.kc === true && s.board.picked?.kc === true && kcCell.on && !kcCell.hl);

/* 3. only the elimination button returns it — and the surviving star lights up */
await deck("action=team_toggle&team=kc");
took = await until(c => !c.on && c.hl);
s = await readState();
ok(`restoring KC brings the remembered highlight straight back (${took}ms)`,
  took >= 0 && s.board.highlighted?.kc === true && !s.board.picked?.kc);

/* 4. normal unhighlight still works on a live team */
await deck("action=unhighlight&team=kc");
took = await until(c => !c.on && !c.hl);
s = await readState();
ok(`unhighlight on a live team clears it normally (${took}ms)`, took >= 0 && !s.board.highlighted?.kc);

/* 5. panel render: eliminated + highlighted team shows BOTH the star and OUT */
await deck("action=highlight&team=phi");
await deck("action=team_pick&team=phi");
const op = await ctx.newPage();
await op.goto(`${HOSTED}/control/pc.html?pc=${PC}`, { waitUntil: "networkidle" });
await op.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await op.waitForTimeout(1500);
const card = await op.evaluate(() => {
  const d = [...document.querySelectorAll("#ctlBoard .team")].find(x => x.dataset.abbr === "phi");
  return { on: d.classList.contains("on"), hl: d.classList.contains("hl") };
});
ok(`pc.html shows PHI as eliminated AND starred (on=${card.on} hl=${card.hl})`, card.on && card.hl);

/* restore */
await browser.close();
const res = await panel({ action: "state", pc: PC, data: ORIGINAL });
const back = await readState();
ok(`PC${PC} restored byte-identical (${res.ok ? "written" : JSON.stringify(res)})`,
  JSON.stringify(back) === JSON.stringify(ORIGINAL));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
