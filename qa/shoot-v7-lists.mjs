/* Composer backgrounds and banner rotation delete independently; Select/Deselect labels. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const assetById = async (id) => (await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/assets?select=meta&id=eq.${id}`, { headers: REST })).json())[0];
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1100 } })).newPage();
await page.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await page.fill("#lockPw", env.PANEL_PASSWORD);
await page.click("#lockGo");
await page.waitForSelector("#ctlBoard .team", { timeout: 20000 });   // unlocked = board renders
await page.waitForTimeout(2500);
await page.click('nav button[data-tab="banners"]');
await page.waitForTimeout(1200);

/* labels */
const labels = await page.evaluate(() =>
  [...document.querySelectorAll("#bannerGrid [data-rot]")].map(b => b.textContent.trim()));
ok(`rotation buttons say Select / Deselect (${[...new Set(labels)].join(", ")})`,
  labels.length > 0 && labels.every(l => l === "Select" || l === "Deselect"));

/* make a banner that lives in BOTH lists: an uploaded-style art banner */
const before = await page.evaluate(() => ({
  comp: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
  rot: [...document.querySelectorAll("#bannerGrid .name")].map(n => n.textContent),
}));
const shared = before.comp.find(n => before.rot.includes(n));
ok(`found an asset shown in both lists ("${shared ?? "none"}")`, !!shared);
if (!shared) { await browser.close(); process.exit(1); }

const id = await page.evaluate((name) => {
  const card = [...document.querySelectorAll("#bannerGrid .asset")]
    .find(c => c.querySelector(".name").textContent === name);
  return card.querySelector("[data-hide]").dataset.hide.split(":")[1];
}, shared);

/* delete it from the ROTATION list only */
await page.evaluate((name) => {
  const card = [...document.querySelectorAll("#bannerGrid .asset")]
    .find(c => c.querySelector(".name").textContent === name);
  card.querySelector("[data-hide]").click();
}, shared);
await page.waitForTimeout(400);
await page.evaluate((name) => {
  const card = [...document.querySelectorAll("#bannerGrid .asset")]
    .find(c => c.querySelector(".name").textContent === name);
  card.querySelector("[data-hide]").click();
}, shared);
await page.waitForTimeout(3000);

const after = await page.evaluate(() => ({
  comp: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
  rot: [...document.querySelectorAll("#bannerGrid .name")].map(n => n.textContent),
}));
ok("removed from the rotation list", !after.rot.includes(shared));
ok("still available as a composer background", after.comp.includes(shared));
const meta1 = await assetById(id);
ok("asset itself is NOT in the trash yet", meta1?.meta?.hideRotation === true && !meta1?.meta?.deleted);

/* now delete it from the composer too -> should land in the trash */
await page.evaluate((name) => {
  const card = [...document.querySelectorAll("#compBGs .asset")]
    .find(c => c.querySelector(".name")?.textContent === name);
  card.querySelector("[data-hide]").click();
}, shared);
await page.waitForTimeout(400);
await page.evaluate((name) => {
  const card = [...document.querySelectorAll("#compBGs .asset")]
    .find(c => c.querySelector(".name")?.textContent === name);
  card.querySelector("[data-hide]").click();
}, shared);
await page.waitForTimeout(3000);
const meta2 = await assetById(id);
ok("gone from both lists -> moved to trash", meta2?.meta?.deleted === true);

/* restore it and confirm it returns to BOTH lists */
await page.click('nav button[data-tab="settings"]');
await page.waitForTimeout(1200);
await page.evaluate((name) => {
  const card = [...document.querySelectorAll("#trashGrid .asset")]
    .find(c => c.querySelector(".name").textContent === name);
  card.querySelector("[data-restore]").click();
}, shared);
await page.waitForTimeout(3000);
const meta3 = await assetById(id);
ok("restore clears both hide flags",
  !meta3?.meta?.deleted && !meta3?.meta?.hideRotation && !meta3?.meta?.hideComposer);
await page.click('nav button[data-tab="banners"]');
await page.waitForTimeout(1500);
const back = await page.evaluate(() => ({
  comp: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
  rot: [...document.querySelectorAll("#bannerGrid .name")].map(n => n.textContent),
}));
ok("it is back in both lists", back.comp.includes(shared) && back.rot.includes(shared));

await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
