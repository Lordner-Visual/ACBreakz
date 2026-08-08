/* M5 vision-QA shoot — six screenshots of the HOSTED overlay at 1080x1920,
   asserted against docs/LAYOUT_KEY.md geometry:
     1 baseline   2 team-pick FX (CSS burst: core inside ANIM box, rays overscan)
     3 pick settled (logo centered in its cell)   4 board reset
     5 banner rotation   6 background swap
   Uses the deck endpoint for real actions; the burst shot uses a direct events
   insert (animUrl:null) so the layout-key focus-box rule is photographable. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(
  readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const DECK = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  "content-type": "application/json" };
const deck = async (q) => (await fetch(`${DECK}&${q}`)).json();
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const overlay = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
await overlay.goto(`${HOSTED}/overlay/?layer=all&pc=5`, { waitUntil: "networkidle" });

/* known clean starting state */
await deck("action=board_reset");
await deck("action=set_background&name=TV Background");
await overlay.waitForTimeout(4000);

/* geometry (layout key: board 1080x165@y480, banners 1080x97@y645..742, ANIM 667x413@207,800) */
const g = await overlay.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom }; };
  return { board: r("#board"), banners: r("#banners"), bg: r("#bgFrame") };
});
ok("bg band 1080x480 @ y0", g.bg.y === 0 && g.bg.w === 1080 && g.bg.h === 480);
ok("board band 1080x165 @ y480", g.board.y === 480 && g.board.h === 165 && g.board.w === 1080);
ok("banner band 1080x97 @ y645, bottom 742", g.banners.y === 645 && g.banners.h === 97 && g.banners.bottom === 742);

/* 1 — baseline */
await overlay.screenshot({ path: `${QA}/m5-1-baseline.png` });

/* 2 — team-pick FX via direct event (no animUrl -> CSS burst honors the focus box) */
await fetch(`${env.SUPABASE_URL}/rest/v1/events`, { method: "POST", headers: REST,
  body: JSON.stringify({ type: "team_pick", payload: { team: "sea", animUrl: null, sfxUrl: null } }) });
await overlay.waitForFunction(() => document.querySelector("#burst .core"), null, { timeout: 8000 });
/* sample the core's bounds across the WHOLE pop animation — worst-case containment */
const fx = await overlay.evaluate(async () => {
  const inBoxBy = (r) => Math.max(207 - r.left, 800 - r.top, r.right - 874, r.bottom - 1213);
  let worst = -1e9, partOut = false, shot = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 2400) {
    const core = document.querySelector("#burst .core");
    if (core) {
      worst = Math.max(worst, inBoxBy(core.getBoundingClientRect()));
      partOut ||= [...document.querySelectorAll("#burst .p")]
        .some(p => inBoxBy(p.getBoundingClientRect()) > 0);
    }
    await new Promise(r => setTimeout(r, 60));
  }
  return { worst, partOut };
});
ok(`FX core inside ANIM 667x413 for the full pop (worst excursion ${fx.worst.toFixed(1)}px)`, fx.worst <= 0);
ok("FX accents overscan the box", fx.partOut);
/* re-fire for the actual screenshot frame (the sampling loop consumed the first burst) */
await overlay.waitForTimeout(1200);
await fetch(`${env.SUPABASE_URL}/rest/v1/events`, { method: "POST", headers: REST,
  body: JSON.stringify({ type: "team_pick", payload: { team: "sea", animUrl: null, sfxUrl: null } }) });
await overlay.waitForFunction(() => document.querySelector("#burst .core"), null, { timeout: 8000 });
await overlay.waitForTimeout(700);
await overlay.screenshot({ path: `${QA}/m5-2-team-pick-fx.png` });

/* 3 — pick settled: slot filled, logo centered in its cell */
await overlay.waitForTimeout(2600);
const cell = await overlay.evaluate(() => {
  const i = window.ACBZ.ORDER.indexOf("sea");
  const c = document.querySelectorAll("#board .cell")[i];
  const cr = c.getBoundingClientRect(), ir = c.querySelector("img").getBoundingClientRect();
  return { on: c.classList.contains("on"),
    dx: Math.abs((cr.x + cr.width/2) - (ir.x + ir.width/2)),
    dy: Math.abs((cr.y + cr.height/2) - (ir.y + ir.height/2)) };
});
ok("sea slot filled", cell.on);
ok(`logo centered in cell (off by ${cell.dx.toFixed(2)},${cell.dy.toFixed(2)}px)`, cell.dx < 1 && cell.dy < 1);
await overlay.screenshot({ path: `${QA}/m5-3-pick-settled.png` });

/* 4 — board reset */
await deck("action=board_reset");
await overlay.waitForFunction(() => !document.querySelector("#board .cell.on"), null, { timeout: 8000 });
await overlay.waitForTimeout(600);
ok("board reset cleared every slot", true);
await overlay.screenshot({ path: `${QA}/m5-4-board-reset.png` });

/* 5 — banner rotation: wait for the live banner to change */
const bannerA = await overlay.evaluate(() =>
  (document.querySelector("#banners .b.live img") ?? {}).src ?? "");
await overlay.waitForFunction((a) =>
  (((document.querySelector("#banners .b.live img") ?? {}).src ?? "") !== a),
  bannerA, { timeout: 15000, polling: 200 });
await overlay.waitForTimeout(800);              // let the crossfade finish
const bannerB = await overlay.evaluate(() =>
  (document.querySelector("#banners .b.live img") ?? {}).src ?? "");
ok(`banner rotated (${bannerA.split("/").pop()} -> ${bannerB.split("/").pop()})`, bannerA !== bannerB && !!bannerB);
await overlay.screenshot({ path: `${QA}/m5-5-banner-rotation.png` });

/* 6 — background swap via deck */
const sw = await deck("action=set_background&name=Stadium");
await overlay.waitForFunction(() =>
  (document.querySelector("#bgFrame img") ?? {}).src?.includes("stadium-lights"), null, { timeout: 8000 });
await overlay.waitForTimeout(400);
ok(`background swapped to "${sw.name}"`, sw.ok === true);
await overlay.screenshot({ path: `${QA}/m5-6-background-swap.png` });

/* restore live defaults */
await deck("action=set_background&name=TV Background");
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
