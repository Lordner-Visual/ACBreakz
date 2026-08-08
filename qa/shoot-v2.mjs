/* V2 acceptance — hosted site.
   1 alpha: served sea.webm has real transparency mid-clip + faded alpha at the end
   2 per-PC isolation: deck &pc=2 changes PC2's overlay, PC1 untouched
   3 board v2: no mode/visibility buttons, eliminated teams dim (no X), single soft sweep
   4 rotation: only Band–Navy Steel; templates out of the grid but in the composer picker
   5 one-shot boxed: Spin 2 Pick 1 plays inside ANIM 667x413
   6 reframe: crop saves to asset meta and reaches the overlay's object-position
   7 panel: no autoplay video thumbnails (phone crash fix); Animations tab naming
   8 board style: AI-generate (2 images, ~$0.06), apply to PC2 only */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const DECK = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });

/* overlays for PC1 and PC2 */
const ov1 = await ctx.newPage();
await ov1.goto(`${HOSTED}/overlay/?layer=all&pc=1`, { waitUntil: "networkidle" });
const ov2 = await ctx.newPage();
await ov2.goto(`${HOSTED}/overlay/?layer=all&pc=2`, { waitUntil: "networkidle" });
await ov1.waitForTimeout(3000);

/* ---- 1: alpha + end fade in the served v2 stinger ---- */
const alpha = await ov1.evaluate(async () => {
  const url = "https://jqowngdkgnfhaworyppo.supabase.co/storage/v1/object/public/media/animations/v2/sea.webm";
  const v = document.createElement("video");
  v.crossOrigin = "anonymous"; v.muted = true; v.src = url;
  await new Promise((r) => { v.onloadeddata = r; v.load(); });
  const cv = document.createElement("canvas"); cv.width = 1080; cv.height = 1920;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const sample = async (t) => {
    v.currentTime = t; await new Promise((r) => { v.onseeked = r; });
    cx.clearRect(0, 0, 1080, 1920); cx.drawImage(v, 0, 0);
    const corner = cx.getImageData(8, 8, 4, 4).data;
    const center = cx.getImageData(538, 958, 4, 4).data;
    const avgA = (d) => { let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };
    return { corner: avgA(corner), center: avgA(center) };
  };
  const mid = await sample(1.5);
  const late = await sample(2.93);
  return { mid, late };
});
ok(`stinger has real transparency mid-clip (corner alpha ${alpha.mid.corner.toFixed(0)}/255, center ${alpha.mid.center.toFixed(0)}/255)`,
  alpha.mid.corner < 245 && alpha.mid.center > 200);
ok(`stinger fades out at the end (late center alpha ${alpha.late.center.toFixed(0)}/255)`,
  alpha.late.center < 60);

/* ---- 3: board v2 look ---- */
const board = await ov1.evaluate(() => {
  const cs = getComputedStyle(document.querySelector("#board"), "::after");
  return { sweepAnim: cs.animationName, sweepW: cs.width,
    xNodes: document.querySelectorAll("#board .x").length,
    logosVisible: [...document.querySelectorAll("#board .cell img")]
      .every(i => getComputedStyle(i).opacity === "1") };
});
ok(`single feathered sweep on the whole board (animation "${board.sweepAnim}", ${board.sweepW} wide)`,
  board.sweepAnim === "sweep" && parseInt(board.sweepW) > 400);
ok("all 32 logos visible up front (eliminate-style board)", board.logosVisible);
ok("no X markers exist anywhere", board.xNodes === 0);

/* ---- 2: per-PC isolation via deck ---- */
await fetch(`${DECK}&action=team_pick&team=dal&pc=2`);
await ov2.waitForFunction(() =>
  document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("dal")].classList.contains("on"),
  null, { timeout: 10000 });
await ov1.waitForTimeout(1500);
const iso = {
  pc1dal: await ov1.evaluate(() =>
    document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("dal")].classList.contains("on")),
  pc1fx: await ov1.evaluate(() => document.querySelector("#fxVideo").style.display === "block"),
};
ok("deck pc=2 eliminated Cowboys on PC2 only (PC1 board untouched, no FX on PC1)",
  !iso.pc1dal && !iso.pc1fx);
const dim = await ov2.evaluate(() => {
  const c = document.querySelectorAll("#board .cell")[window.ACZ_ ?? window.ACBZ.ORDER.indexOf("dal")];
  return getComputedStyle(c).filter;
});
ok(`eliminated team is dimmed via filter (${dim.slice(0, 40)}…)`, /brightness/.test(dim));
await ov2.waitForTimeout(2200);
await ov2.screenshot({ path: `${QA}/v2-eliminated-dim.png`, clip: { x: 0, y: 460, width: 1080, height: 300 } });

/* ---- 4: rotation contents ---- */
const rot = await ov1.evaluate(async () => {
  const r = await fetch(`${window.ACBZ.SUPABASE_URL}/rest/v1/stream_state?select=data&id=eq.1`,
    { headers: { apikey: window.ACBZ.SUPABASE_ANON_KEY, authorization: "Bearer " + window.ACBZ.SUPABASE_ANON_KEY } });
  const j = await r.json();
  return (j[0]?.data?.banners?.rotation ?? []).map(b => b.name);
});
ok(`rotation is just the navy band (got: ${rot.join(", ") || "empty"})`,
  rot.length === 1 && rot[0] === "Band – Navy Steel");

/* ---- 5: one-shot boxed ---- */
const ov3 = await ctx.newPage();
await ov3.goto(`${HOSTED}/overlay/?layer=all&pc=3`, { waitUntil: "networkidle" });
await ov3.waitForTimeout(2500);
await fetch(`${DECK}&action=play&name=Spin&pc=3`);
await ov3.waitForFunction(() => document.querySelector("#fxVideo").style.display === "block",
  null, { timeout: 10000 });
await ov3.waitForTimeout(1500);
const box = await ov3.evaluate(() => {
  const r = document.querySelector("#fxVideo").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height,
    boxed: document.querySelector("#fxVideo").classList.contains("boxed") };
});
ok(`Spin 2 Pick 1 plays inside ANIM 667x413 @ (207,800) [got ${box.w}x${box.h} @ (${box.x},${box.y})]`,
  box.boxed && box.x === 207 && box.y === 800 && box.w === 667 && box.h === 413);
await ov3.screenshot({ path: `${QA}/v2-oneshot-boxed.png` });
await ov3.close();

/* ---- panel checks ---- */
const panel = await ctx.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "domcontentloaded" });
await panel.evaluate((k) => { localStorage.setItem("acbz-panel-key", k); localStorage.setItem("acbz-pc", "2"); }, env.PANEL_KEY);
await panel.reload({ waitUntil: "networkidle" });
await panel.waitForTimeout(2000);

const pv = await panel.evaluate(() => ({
  autoplayVids: document.querySelectorAll("video[autoplay]").length,
  pcSel: document.querySelector("#pcSel")?.value ?? null,
  animTab: [...document.querySelectorAll("nav button")].map(b => b.textContent.trim()),
  modeBtn: !!document.querySelector("#modeBtn"), visBtn: !!document.querySelector("#visBtn"),
  styleCards: [...document.querySelectorAll("#styleGrid .name")].map(n => n.textContent),
  boardStyleCards: [...document.querySelectorAll("#boardStyleGrid .name")].map(n => n.textContent),
  bannerGrid: [...document.querySelectorAll("#bannerGrid .name")].map(n => n.textContent),
  compBGs: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
}));
ok(`no autoplay video thumbnails in the panel (crash fix) — found ${pv.autoplayVids}`, pv.autoplayVids === 0);
ok("PC selector present and on PC 2", pv.pcSel === "2");
ok("tab renamed to Animations", pv.animTab.includes("Animations") && !pv.animTab.join().includes("Games"));
ok("Mode / Board-visibility buttons are gone", !pv.modeBtn && !pv.visBtn);
ok("Classic Stingers style card present", pv.styleCards.some(n => n.includes("Classic")));
ok("Gold Buttons board-style card present", pv.boardStyleCards.some(n => n.includes("Gold")));
ok("templates out of rotation grid", !pv.bannerGrid.some(n => /Mosaic|Gold Frame|Stadium Strip/.test(n)));
ok("templates still in composer picker", ["NFL Mosaic", "Gold Frame", "Stadium Strip"]
  .every(t => pv.compBGs.some(n => n.includes(t))));

/* ---- 6: reframe a background, verify overlay applies the crop ---- */
await panel.click('nav button[data-tab="bgs"]');
const rfBtn = await panel.evaluate(() => {
  const cards = [...document.querySelectorAll("#bgGrid .asset")];
  const c = cards.find(x => x.querySelector(".name").textContent.includes("Stadium Lights"));
  const b = c?.querySelector("[data-rf]"); if (b) b.click(); return !!b;
});
ok("reframe editor opens for a background", rfBtn);
await panel.waitForTimeout(600);
await panel.fill("#rfY", "10");
await panel.click("#rfSave");
await panel.waitForTimeout(2500);
/* set that background live on PC2, then read PC2 overlay's object-position */
await panel.evaluate(() => {
  const cards = [...document.querySelectorAll("#bgGrid .asset")];
  const c = cards.find(x => x.querySelector(".name").textContent.includes("Stadium Lights"));
  c.querySelector("button[data-bg]").click();
});
await ov2.waitForFunction(() =>
  (document.querySelector("#bgFrame img") ?? {}).src?.includes("stadium-lights"), null, { timeout: 10000 });
const objPos = await ov2.evaluate(() => document.querySelector("#bgFrame img").style.objectPosition);
ok(`reframed crop reached the PC2 overlay (object-position "${objPos}")`, objPos === "50% 10%");
await panel.screenshot({ path: `${QA}/v2-panel-pc2.png`, clip: { x: 0, y: 0, width: 1080, height: 760 } });

/* PC1 background must be unaffected */
const pc1bg = await ov1.evaluate(() => {
  const n = document.querySelector("#bgFrame video, #bgFrame img");
  return n ? n.src : null;
});
ok("PC1 background unaffected by PC2 change", !!pc1bg?.includes("tv-background"));

/* ---- 8: AI board style (2 images ~$0.06), apply to PC2 ---- */
await panel.click('nav button[data-tab="style"]');
await panel.fill("#boardStylePrompt", "brushed dark gunmetal with subtle blue neon edge glow");
await panel.click("#boardStyleBtn");
const styleMade = await panel.waitForFunction(() =>
  [...document.querySelectorAll("#boardStyleGrid .name")].some(n => n.textContent.includes("gunmetal")),
  null, { timeout: 120000 }).then(() => true).catch(() => false);
ok("AI board style generated (button + board background)", styleMade);
if (styleMade) {
  await panel.evaluate(() => {
    const cards = [...document.querySelectorAll("#boardStyleGrid .asset")];
    const c = cards.find(x => x.querySelector(".name").textContent.includes("gunmetal"));
    c.querySelector("[data-bstyle]").click();
  });
  await ov2.waitForFunction(() => {
    const c = document.querySelector("#board .cell");
    return c && c.style.backgroundImage.includes("url");
  }, null, { timeout: 10000 });
  const pc1Style = await ov1.evaluate(() => document.querySelector("#board .cell").style.backgroundImage);
  ok("board style applied on PC2, PC1 keeps Gold Buttons", pc1Style === "");
  await ov2.waitForTimeout(1500);
  await ov2.screenshot({ path: `${QA}/v2-board-style-pc2.png`, clip: { x: 0, y: 460, width: 1080, height: 300 } });
}

/* ---- cleanup: restore PC2 defaults ---- */
await fetch(`${DECK}&action=team_restore&team=dal&pc=2`);
await fetch(`${DECK}&action=set_background&name=TV Background&pc=2`);
await panel.evaluate(() => {   // back to Gold Buttons on PC2
  const cards = [...document.querySelectorAll("#boardStyleGrid .asset")];
  const c = cards.find(x => x.querySelector(".name").textContent.includes("Gold"));
  c?.querySelector("[data-bstyle]")?.click();
});
await panel.waitForTimeout(1500);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
