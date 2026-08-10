/* Per-PC dashboard: works with no login, drives only its own PC, and the
   operator key cannot be used to delete/upload/generate. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const boards = async () => Object.fromEntries((await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=id,data->board&order=id`, { headers: REST })).json())
  .map(r => [r.id, r.board]));
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: { ...REST, "content-type": "application/json" }, body: JSON.stringify(body) })
  .then(r => r.json());
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));

/* opens straight from the Stream Deck key — no password anywhere */
await page.goto(`${HOSTED}/control/pc.html?pc=2`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
ok("dashboard opens with no login prompt",
  await page.isVisible("#ctlBoard") && !(await page.isVisible("#lock")));
ok("no JS errors on load", errs.length === 0);
const tabs = await page.evaluate(() => [...document.querySelectorAll("nav button")].map(b => b.textContent.trim()));
ok(`only the five operator tabs (${tabs.join(" | ")})`,
  tabs.join("|") === "Team Board|SoundFX|Banners|Backgrounds|Board Style");
ok("no upload / AI / delete controls anywhere",
  await page.evaluate(() => !document.querySelector("input[type=file], .aibar, [data-del]")));
ok("it is pinned to PC 2", (await page.textContent("#pcTag")).trim() === "PC 2");

/* a board tap drives only PC2 */
await page.click('#ctlBoard .team[data-abbr="lar"]');
await page.waitForTimeout(2500);
const b = await boards();
ok("tapping a team changes only PC2",
  b[2].picked?.lar === true && [1,3,4,5].every(n => !b[n].picked?.lar));
await page.click('#ctlBoard .team[data-abbr="lar"]');
await page.waitForTimeout(2000);
ok("tapping again restores it", !(await boards())[2].picked?.lar);
await page.screenshot({ path: "C:/ACBreakz-Cloud/qa/pc-dashboard.png", clip: { x:0, y:0, width:1280, height:820 } });

/* the operator key must not be able to do anything else */
const op = env.OP_KEY;
const del = await panel({ op, pc: 2, action: "delete_asset", id: "00000000-0000-0000-0000-000000000000" });
ok(`operator key cannot delete (${del.error})`, /operator scope/.test(del.error ?? ""));
const gen = await fetch(`${env.SUPABASE_URL}/functions/v1/generate-asset`, { method: "POST",
  headers: { ...REST, "content-type": "application/json" },
  body: JSON.stringify({ key: op, kind: "banner", prompt: "x" }) }).then(r => r.json());
ok(`operator key cannot spend on AI (${gen.error})`, !gen.ok && !!gen.error);
const other = await panel({ op, pc: 9, action: "state", data: {} });
ok(`operator key cannot address a bogus PC (${other.error})`, /must name one PC/.test(other.error ?? ""));
const upl = await panel({ op, pc: 2, action: "sign_upload", path: "animations/evil.webm" });
ok(`operator key cannot upload outside composed banners (${upl.error})`, /operator scope/.test(upl.error ?? ""));

await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
