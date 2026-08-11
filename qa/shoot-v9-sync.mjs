/* Effects restart in sync after EVERY kind of change, and never die on the
   highlighted teams — only unhighlight/eliminate stops them. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();
await page.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await page.fill("#lockPw", env.PANEL_PASSWORD);
await page.click("#lockGo");
await page.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await page.selectOption("#pcSel", "4");
await page.waitForTimeout(2000);

const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=all&pc=4`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);

/* clean slate: Edge Glow on, KC + PHI highlighted */
await fetch(`${B}&action=board_reset&pc=4`);
await fetch(`${B}&action=highlight_clear&pc=4`);
await page.click('nav button[data-tab="style"]');
await page.waitForTimeout(800);
const clickAnim = (re) => page.evaluate((r) => {
  const c = [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(x => new RegExp(r).test(x.querySelector(".name").textContent));
  c?.querySelector("[data-anim]")?.click();
}, re.source);
await clickAnim(/No Button Animation/); await page.waitForTimeout(1200);
await clickAnim(/Edge Glow/); await page.waitForTimeout(1200);
await fetch(`${B}&action=highlight&team=kc&pc=4`);
await fetch(`${B}&action=highlight&team=phi&pc=4`);
await ov.waitForTimeout(2000);

const clocks = () => ov.evaluate(() => {
  const hl = [...document.querySelectorAll("#board .cell.hl")];
  return { running: hl.map(c => c.getAnimations({ subtree: true })
      .filter(a => a.animationName === "bglow").map(a => Math.round(a.currentTime ?? -1))[0] ?? null),
    hl: hl.length };
});
const inSync = (r) => r.hl > 0 && r.running.every(t => t !== null) &&
  Math.max(...r.running) - Math.min(...r.running) <= 34;   // within two frames

const c0 = await clocks();
ok(`baseline: ${c0.hl} highlighted, clocks ${JSON.stringify(c0.running)} in sync`, inSync(c0));

/* change 1: effect intensity — must restart, not stop */
await page.evaluate(() => { const r = document.querySelector("#fxRange");
  r.value = 180; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
await ov.waitForTimeout(1800);
const c1 = await clocks();
ok(`after intensity change: still animating and in sync ${JSON.stringify(c1.running)}`, inSync(c1));

/* change 2: grid style */
await page.evaluate(() => document.querySelector('[data-grid="checker"]').click());
await ov.waitForTimeout(1800);
const c2 = await clocks();
ok(`after grid change: still animating and in sync ${JSON.stringify(c2.running)}`, inSync(c2));

/* change 3: highlight another team — all three restart together near zero */
await fetch(`${B}&action=highlight&team=sea&pc=4`);
await ov.waitForTimeout(900);
const c3 = await clocks();
ok(`after adding a highlight: three buttons, one clock ${JSON.stringify(c3.running)}`,
  c3.hl === 3 && inSync(c3));

/* change 4: No Button Animation shows nothing, but a new selection starts right up */
await clickAnim(/No Button Animation/); await ov.waitForTimeout(1500);
const none = await ov.evaluate(() =>
  /anim-/.test(document.querySelector("#board").className));
ok("No Button Animation shows zero effects", !none);
await clickAnim(/Glitch/); await ov.waitForTimeout(1500);
const c4 = await ov.evaluate(() => {
  const hl = [...document.querySelectorAll("#board .cell.hl")];
  return { hl: hl.length, times: hl.map(c => c.getAnimations({ subtree: true })
    .filter(a => a.animationName === "bglitch").map(a => Math.round(a.currentTime ?? -1))[0] ?? null) };
});
ok(`selecting an effect after None starts immediately on all highlighted (${JSON.stringify(c4.times)})`,
  c4.hl === 3 && c4.times.every(t => t !== null) &&
  Math.max(...c4.times) - Math.min(...c4.times) <= 34);

/* change 5: eliminating one stops ONLY that one */
await fetch(`${B}&action=team_toggle&team=phi&pc=4`);
await ov.waitForTimeout(2500);
const c5 = await ov.evaluate(() => ({
  hl: document.querySelectorAll("#board .cell.hl").length,
  phiOut: document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("phi")]
    .classList.contains("on") }));
ok(`eliminating PHI stops its effect only (${c5.hl} still highlighted)`, c5.hl === 2 && c5.phiOut);

/* cleanup */
await clickAnim(/No Button Animation/);
await page.evaluate(() => { document.querySelector('[data-grid="buttons"]').click(); });
await page.waitForTimeout(600);
await page.evaluate(() => { const r = document.querySelector("#fxRange");
  r.value = 100; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
await fetch(`${B}&action=highlight_clear&pc=4`);
await fetch(`${B}&action=board_reset&pc=4`);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
