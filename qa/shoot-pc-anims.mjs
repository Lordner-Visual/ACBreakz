/* PC dashboard: Animations tab works, sees the SAME shared library as master,
   can fire FX, and still cannot add/delete/generate. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

/* what the master library holds */
const all = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/assets?select=kind,name,meta`, { headers: REST })).json();
const live = all.filter(a => !a.meta?.deleted);
const wantOneshots = live.filter(a => a.kind === "animation" && a.meta?.group !== "team").length;
const wantStyles = live.filter(a => a.kind === "style" && a.meta?.domain === "team_anim").length;

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1050 } })).newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(`${HOSTED}/control/pc.html?pc=1`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
ok("no JS errors", errs.length === 0);

const tabs = await page.evaluate(() => [...document.querySelectorAll("nav button")].map(b => b.textContent.trim()));
ok(`Animations tab added (${tabs.join(" | ")})`, tabs[1] === "Animations");

await page.click('nav button[data-tab="anims"]');
await page.waitForTimeout(800);
const seen = await page.evaluate(() => ({
  styles: document.querySelectorAll("#styleGrid .asset").length,
  oneshots: document.querySelectorAll("#oneshotGrid .asset").length,
  names: [...document.querySelectorAll("#oneshotGrid .name")].map(n => n.textContent),
}));
ok(`sees every team style the master has (${seen.styles}/${wantStyles})`, seen.styles === wantStyles);
ok(`sees every one-shot the master has (${seen.oneshots}/${wantOneshots}: ${seen.names.join(", ")})`,
  seen.oneshots === wantOneshots);
ok("still no add / delete / AI controls",
  await page.evaluate(() => !document.querySelector("input[type=file], .aibar, [data-del], [data-purge]")));

/* firing a one-shot must now reach the events table for THIS pc */
const before = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/events?select=created_at&order=created_at.desc&limit=1`, { headers: REST })).json();
await page.evaluate(() => document.querySelector("#oneshotGrid [data-anim]")?.click());
await page.waitForTimeout(2500);
const after = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/events?select=type,payload,created_at&order=created_at.desc&limit=1`,
  { headers: REST })).json();
ok(`playing a one-shot fires an event for pc 1 (${after[0]?.type}, pc=${after[0]?.payload?.pc})`,
  after[0]?.created_at !== before[0]?.created_at &&
  after[0]?.type === "play_animation" && String(after[0]?.payload?.pc) === "1");

await page.screenshot({ path: "C:/ACBreakz-Cloud/qa/pc-animations.png", clip: { x:0, y:0, width:1280, height:820 } });
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
