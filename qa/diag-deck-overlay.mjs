/* Does a deck URL actually move the live hosted overlay? Isolates
   "Stream Deck button" from "deck -> cloud -> overlay" path. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };

/* what has hit the cloud recently — did Brandon's button presses land at all? */
const evs = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/events?select=type,payload,created_at&order=created_at.desc&limit=8`,
  { headers: REST })).json();
console.log("recent events in the cloud:");
for (const e of evs) console.log(`   ${e.created_at}  ${e.type}  ${JSON.stringify(e.payload).slice(0,70)}`);

const st = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=id,updated_at,data->board&order=id`,
  { headers: REST })).json();
console.log("\nper-PC state:");
for (const s of st) console.log(`   PC${s.id}  updated ${s.updated_at}  board ${JSON.stringify(s.board)}`);

/* now drive the real overlay */
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ov = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
const errs = [];
ov.on("pageerror", e => errs.push("PAGEERROR " + e.message));
ov.on("console", m => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
await ov.goto("https://lordner-visual.github.io/ACBreakz/overlay/?layer=all&pc=1",
  { waitUntil: "networkidle" });
await ov.waitForTimeout(3500);

const before = await ov.evaluate(() => ({
  cells: document.querySelectorAll("#board .cell").length,
  on: [...document.querySelectorAll("#board .cell.on")].length,
  ws: performance.getEntriesByType("resource").filter(r => r.name.includes("realtime")).length,
}));
console.log("\noverlay loaded:", JSON.stringify(before));
if (errs.length) console.log("overlay errors:", errs.slice(0, 5));

console.log("\nfiring deck team_pick sea (no pc param = all PCs)...");
const res = await (await fetch(`${BASE}&action=team_pick&team=sea`)).json();
console.log("   deck says:", JSON.stringify(res));

const landed = await ov.waitForFunction(() =>
  document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("sea")]
    .classList.contains("on"), null, { timeout: 15000 }).then(() => true).catch(() => false);
console.log(`\n${landed ? "PASS" : "FAIL"}  overlay reacted to the deck URL`);
if (!landed) {
  const s = await ov.evaluate(() => ({
    picked: window.ACBZ && document.querySelectorAll("#board .cell.on").length,
    pc: window.ACBZ?.DEVICE,
    url: window.ACBZ?.SUPABASE_URL?.slice(0, 40),
  }));
  console.log("   overlay says:", JSON.stringify(s));
  console.log("   errors:", errs.slice(0, 8));
}
await ov.screenshot({ path: "C:/ACBreakz-Cloud/qa/diag-overlay.png",
  clip: { x: 0, y: 480, width: 1080, height: 165 } });
await fetch(`${BASE}&action=board_reset`);
await browser.close();
