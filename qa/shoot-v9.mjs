/* V9: file an AI generation into a section, and "fill the section" really fills it. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  "content-type": "application/json" };
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: REST, body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await page.fill("#lockPw", env.PANEL_PASSWORD);
await page.click("#lockGo");
await page.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await page.selectOption("#pcSel", "3");
await page.waitForTimeout(2500);
ok("no JS errors", errs.length === 0);

/* --- AI tab: add-to-section --- */
await page.click('nav button[data-tab="ai"]');
await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector("#aiGrid [data-ai]").click());
await page.waitForTimeout(800);
const controls = await page.evaluate(() => ({
  open: document.querySelector("#aiRefine").classList.contains("on"),
  targets: [...document.querySelectorAll("#aiAddKind option")].map(o => o.value),
  fits: [...document.querySelectorAll("#aiAddFit option")].map(o => o.value),
}));
ok(`add-to-section offers every library (${controls.targets.length})`,
  controls.open && controls.targets.includes("team_style") &&
  controls.targets.includes("oneshot") && controls.targets.includes("background"));
ok(`fit choices are fill / keep-in-box (${controls.fits.join(", ")})`,
  controls.fits.join(",") === "full,box");

const beforeStyles = await page.evaluate(() =>
  document.querySelectorAll("#styleGrid .asset").length);
await page.selectOption("#aiAddKind", "team_style");
await page.selectOption("#aiAddFit", "full");
await page.click("#aiAddBtn");
await page.waitForTimeout(3000);
const added = await page.evaluate(() => {
  document.querySelector("#aiRefClose").click();
  document.querySelector('nav button[data-tab="anims"]').click();
  return document.querySelectorAll("#styleGrid .asset").length;
});
ok(`it lands in the Animations tab as a team style (${beforeStyles} -> ${added})`, added > beforeStyles);

/* enable it on PC3 and check the overlay fills the lower section */
await page.waitForTimeout(600);
const styleId = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("#styleGrid .asset")];
  const c = cards[0];                             // newest first — the one we just added
  c.querySelector("[data-style]").click();
  return c.querySelector("[data-style]").dataset.style;
});
await page.waitForTimeout(2000);

const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=all&pc=3`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);
await fetch(`${B}&action=board_reset&pc=3`);
await ov.waitForTimeout(600);
await fetch(`${B}&action=team_toggle&team=sea&pc=3`);
await ov.waitForTimeout(2500);

const box = await ov.evaluate(() => {
  const v = document.querySelector("#fxVideo"), i = document.querySelector("#fxImg");
  const el = v.style.display === "block" ? v : i;
  const r = el.getBoundingClientRect();
  return { which: el.id, shown: el.style.display, cls: el.className,
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
});
console.log(`   ${box.which} ${box.cls} at ${box.w}x${box.h} @ (${box.x},${box.y})`);
ok("a 'fill the section' style covers the whole lower camera region (1080x1275 @ y645)",
  box.cls.includes("full") && box.w === 1080 && box.h === 1275 && box.y === 645);
await ov.screenshot({ path: "C:/ACBreakz-Cloud/qa/v9-full-style.png" });

/* reframe zoom now reaches 600% */
await page.click('nav button[data-tab="bgs"]');
await page.waitForTimeout(800);
await page.evaluate(() => document.querySelector("#bgGrid [data-rf]").click());
await page.waitForTimeout(600);
const zoom = await page.evaluate(() => ({
  max: document.querySelector("#rfZ").max,
  hasFit: !!document.querySelector("#rfFit"),
}));
ok(`reframe zoom goes to ${zoom.max}% and has a fit selector`, zoom.max === "600" && zoom.hasFit);

/* cleanup: drop the test style and clear the board */
await panel({ action: "delete_asset", id: styleId });
await fetch(`${B}&action=board_reset&pc=3`);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
