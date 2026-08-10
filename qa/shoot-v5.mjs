/* V5 acceptance — board tiles must match the ORIGINAL art geometry:
   square tiles, inside the WhatNot-safe area x111..968, never wider. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const DECK = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const SAFE_L = 111, SAFE_R = 969;      // measured from the original board art
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
const ov = await ctx.newPage();
await ov.goto(`${HOSTED}/overlay/?layer=all&pc=4`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);

const measure = () => ov.evaluate(() => {
  const cells = [...document.querySelectorAll("#board .cell")];
  const r = cells.map(c => c.getBoundingClientRect());
  return {
    n: cells.length,
    w: +r[0].width.toFixed(1), h: +r[0].height.toFixed(1),
    left: +Math.min(...r.map(x => x.left)).toFixed(1),
    right: +Math.max(...r.map(x => x.right)).toFixed(1),
    top: +Math.min(...r.map(x => x.top)).toFixed(1),
    bottom: +Math.max(...r.map(x => x.bottom)).toFixed(1),
    rows: new Set(r.map(x => Math.round(x.top))).size,
  };
});

/* baseline grid = the classic buttons layout at 0 spacing */
await fetch(`${DECK}&action=board_reset&pc=4`);
await ov.waitForTimeout(600);
const base = await measure();
console.log(`   tiles ${base.w}x${base.h}, span x ${base.left}..${base.right}, y ${base.top}..${base.bottom}`);
ok(`tiles are perfect squares (${base.w} x ${base.h})`, Math.abs(base.w - base.h) < 0.6);
ok(`tile size matches the original 53x53 (got ${base.w})`, Math.abs(base.w - 53) <= 1);
ok(`tiles inside the safe area x${SAFE_L}..${SAFE_R} (got ${base.left}..${base.right})`,
  base.left >= SAFE_L - 1 && base.right <= SAFE_R + 1);
ok(`board is 16 x 2 (${base.n} tiles, ${base.rows} rows)`, base.n === 32 && base.rows === 2);
ok(`tiles sit inside the 1080x165 band (y ${base.top}..${base.bottom})`,
  base.top >= 480 && base.bottom <= 645);
await ov.screenshot({ path: `${QA}/v5-board-squares.png`, clip: { x: 0, y: 480, width: 1080, height: 165 } });

/* every grid style, at min and max spacing, must stay inside the safe area */
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 1280, height: 1000 });
await panel.goto(`${HOSTED}/control/`, { waitUntil: "domcontentloaded" });
await panel.evaluate((k) => { localStorage.setItem("acbz-panel-key", k); localStorage.setItem("acbz-pc", "4"); }, env.PANEL_KEY);
await panel.reload({ waitUntil: "networkidle" });
await panel.waitForTimeout(2500);
await panel.click('nav button[data-tab="style"]');
await panel.waitForTimeout(700);

for (const g of ["buttons","checker","checkerbare","honeycomb","logos","rect84","slant"]) {
  for (const gap of [0, 20]) {
    await panel.waitForTimeout(600);
    await panel.evaluate((id) => document.querySelector(`[data-grid="${id}"]`).click(), g);
    await panel.waitForTimeout(900);
    await panel.evaluate((gp) => {
      const r = document.querySelector("#gapRange");
      r.value = gp; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change"));
    }, gap);
    await ov.waitForFunction(([id, gp]) =>
      document.querySelector("#board").classList.contains("grid-" + id) &&
      getComputedStyle(document.querySelector("#board")).gap.startsWith(String(gp)),
      [g, gap], { timeout: 25000 });
    await ov.waitForTimeout(400);
    const m = await measure();
    const square = g === "rect84" ? true : Math.abs(m.w - m.h) < 0.6;
    ok(`${g.padEnd(11)} gap ${String(gap).padStart(2)}: ${String(m.w).padStart(5)}x${String(m.h).padEnd(5)} ` +
       `x ${m.left}..${m.right} — inside safe area${g === "rect84" ? "" : " and square"}`,
      m.left >= SAFE_L - 1 && m.right <= SAFE_R + 1 && m.top >= 480 && m.bottom <= 645 && square);
    if (gap === 0 && ["buttons","honeycomb","rect84"].includes(g))
      await ov.screenshot({ path: `${QA}/v5-grid-${g}.png`, clip: { x: 0, y: 480, width: 1080, height: 165 } });
  }
}

/* restore the classic look */
await panel.evaluate(() => {
  document.querySelector('[data-grid="buttons"]').click();
  const r = document.querySelector("#gapRange");
  r.value = 0; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change"));
});
await panel.waitForTimeout(1200);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
