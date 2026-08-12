/* Panel/deck race acceptance — a panel operator adjusting settings must never
   revert a Stream Deck press, and must SEE the press land.

   Pre-V11 this failed two ways: the panel pushed the whole document (so a slider
   drag shipped a stale `board`), and its echo guard compared a foreign machine's
   clock, so it dropped the deck's write and then re-pushed over the top.

   Runs on one idle PC and restores it. */
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
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}&pc=${PC}`)
  .then(r => r.json().catch(() => ({})));
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const readState = () =>
  fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.${PC}&select=data`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
    .then(r => r.json()).then(rows => rows[0].data);
const onlyTrue = (o) => Object.keys(o ?? {}).filter(k => o[k]).sort();

const ORIGINAL = await readState();
console.log(`snapshot of PC${PC} taken — restored at the end\n`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });

const master = await ctx.newPage();
await master.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await master.fill("#lockPw", env.PANEL_PASSWORD);
await master.click("#lockGo");
await master.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await master.selectOption("#pcSel", String(PC));
await master.waitForTimeout(1500);
await master.click('nav button[data-tab="style"]');
await master.waitForTimeout(600);

const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=hud&pc=${PC}`, { waitUntil: "networkidle" });
await ov.waitForTimeout(1500);

await deck("action=board_reset");
await deck("action=highlight_clear");
await master.waitForTimeout(1200);

/* ---- the race: drag a slider on master WHILE firing deck presses ---- */
console.log("=== dragging Effect intensity while 6 deck keys are pressed ===");
const TEAMS = ["atl", "phi", "mia", "dal", "wsh", "ind"];
const dragging = (async () => {
  for (let v = 110; v <= 200; v += 10) {
    await master.evaluate((val) => {
      const r = document.querySelector("#fxRange"); r.value = val;
      r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change"));
    }, v).catch(() => {});
    await master.waitForTimeout(140);
  }
})();
const pressing = (async () => {
  await new Promise(r => setTimeout(r, 200));
  for (const t of TEAMS) { await deck(`action=team_toggle&team=${t}`); await new Promise(r => setTimeout(r, 120)); }
})();
await Promise.all([dragging, pressing]);
await master.waitForTimeout(2500);

const s = await readState();
const got = onlyTrue(s.board?.picked);
ok(`every deck press survived the panel activity (${got.length}/6${
  got.length < 6 ? " — LOST: " + TEAMS.filter(t => !got.includes(t)).join(",") : ""})`,
  got.length === 6);
ok(`the panel's own slider change survived too (fxIntensity=${s.fxIntensity})`, s.fxIntensity === 200);

const onOverlay = await ov.evaluate(() => document.querySelectorAll("#board .cell.on").length);
ok(`the overlay shows all 6 eliminated (${onOverlay})`, onOverlay === 6);

/* the master panel must have ADOPTED the deck writes, not ignored them */
const onMaster = await master.evaluate(() => document.querySelectorAll("#ctlBoard .team.on").length);
ok(`the master panel adopted the deck's writes and shows 6 (${onMaster})`, onMaster === 6);

/* ---- pc.html: its own change must survive its own round trip ---- */
console.log("\n=== pc.html: in-flight change vs its own echo ===");
const op = await ctx.newPage();
await op.goto(`${HOSTED}/control/pc.html?pc=${PC}`, { waitUntil: "networkidle" });
await op.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await op.click('nav button[data-tab="style"]');
await op.waitForTimeout(1200);
await op.evaluate(() => { const r = document.querySelector("#gapRange"); r.value = 7;
  r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
await deck("action=team_toggle&team=kc");           // foreign write lands mid-flight
await op.waitForTimeout(2500);
const s2 = await readState();
ok(`pc.html's slider change survived a concurrent deck press (boardGap=${s2.boardGap})`, s2.boardGap === 7);
ok(`...and the deck press survived too (picked.kc=${!!s2.board?.picked?.kc})`, !!s2.board?.picked?.kc);
const gapShown = await op.evaluate(() => document.querySelector("#gapRange").value);
ok(`pc.html still displays its own value (${gapShown})`, String(gapShown) === "7");

/* ---- restore ---- */
await browser.close();
await deck("action=board_reset");
await deck("action=highlight_clear");
const res = await panel({ action: "state", pc: PC, data: ORIGINAL, force: true });
const back = await readState();
const bare = (d) => { const { updatedAt, lastWriter, ...rest } = d; return JSON.stringify(rest); };
ok(`PC${PC} restored (${res.ok ? "written" : JSON.stringify(res)})`, bare(back) === bare(ORIGINAL));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
