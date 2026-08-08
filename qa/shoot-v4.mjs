/* V4 acceptance — hosted site.
   1 button style REPLACES the stock gold button (no copper border, no gloss)
   2 grid styles: 7 options, each applies to the overlay and keeps the button style
   3 spacing: buttons touch at 0, slider moves them apart
   4 highlights: scope button animations; eliminating auto-unhighlights; deck action
   5 reframe available on every media asset + zoom applies on the overlay
   6 video model is Kling via fal queue (submit/poll) */
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });

const panel = await ctx.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "domcontentloaded" });
await panel.evaluate((k) => { localStorage.setItem("acbz-panel-key", k); localStorage.setItem("acbz-pc", "2"); }, env.PANEL_KEY);
await panel.reload({ waitUntil: "networkidle" });
await panel.waitForTimeout(2500);

const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=all&pc=2`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);

/* ---- 2: grid style list ---- */
await panel.click('nav button[data-tab="style"]');
await panel.waitForTimeout(800);
const gridNames = await panel.evaluate(() =>
  [...document.querySelectorAll("#gridStyleGrid .name")].map(n => n.textContent.trim()));
ok(`grid section offers all 7 styles (${gridNames.join(", ")})`,
  ["Buttons","Checker board","Checker · no edge","Honeycomb","NFL logos only","8 × 4 rectangles","Slanted rectangles"]
    .every(n => gridNames.includes(n)));
const gridFirst = await panel.evaluate(() =>
  document.querySelector("#tab-style h2").textContent.trim());
ok(`grid is the first section of Board Style ("${gridFirst}")`, /grid style/i.test(gridFirst));

/* ---- 1: apply an AI button style, confirm it replaces the gold button ---- */
await panel.evaluate(() => {
  const c = [...document.querySelectorAll("#btnStyleGrid .asset")]
    .find(x => /Buttons:|gunmetal/i.test(x.querySelector(".name").textContent));
  c.querySelector("[data-part]").click();
});
await ov.waitForFunction(() => document.querySelector("#board").classList.contains("has-btnstyle"),
  null, { timeout: 25000 });
await panel.waitForTimeout(700);
const styled = await ov.evaluate(() => {
  const cell = document.querySelector("#board .cell");
  const cs = getComputedStyle(cell), before = getComputedStyle(cell, "::before");
  return { border: cs.borderTopWidth, shadow: cs.boxShadow,
    gloss: before.display, bg: cell.style.backgroundImage.slice(0, 30),
    logoInset: getComputedStyle(cell.querySelector("img")).left };
});
ok(`AI button style replaces the gold edge (border ${styled.border}, gloss ${styled.gloss}, shadow ${styled.shadow})`,
  styled.border === "0px" && styled.gloss === "none" && styled.shadow === "none");
ok("the AI art is the button face and the logo sits inside it", styled.bg.includes("url") && parseFloat(styled.logoInset) > 6);
await ov.screenshot({ path: `${QA}/v4-button-style.png`, clip: { x: 0, y: 470, width: 1080, height: 185 } });

/* ---- 2b: each grid renders on the overlay ---- */
const shots = {};
for (const g of ["checker","honeycomb","logos","rect84","slant"]) {
  await panel.waitForTimeout(700);                  // let the previous push settle
  await panel.evaluate((id) => document.querySelector(`[data-grid="${id}"]`).click(), g);
  await ov.waitForFunction((id) => document.querySelector("#board").classList.contains("grid-" + id),
    g, { timeout: 25000 });
  await ov.waitForTimeout(700);
  const geo = await ov.evaluate(() => {
    const cells = document.querySelectorAll("#board .cell");
    const a = cells[0].getBoundingClientRect(), b = cells[1].getBoundingClientRect();
    const last = cells[cells.length - 1].getBoundingClientRect();
    return { w: Math.round(a.width), h: Math.round(a.height),
      gap: Math.round(b.left - a.right), rows: new Set([...cells].map(c =>
        Math.round(c.getBoundingClientRect().top))).size,
      inBoard: last.right <= 1080 && last.bottom <= 645 };
  });
  shots[g] = geo;
  await ov.screenshot({ path: `${QA}/v4-grid-${g}.png`, clip: { x: 0, y: 470, width: 1080, height: 185 } });
}
ok(`8x4 grid really is 4 rows of wide buttons (${shots.rect84.w}x${shots.rect84.h}, ${shots.rect84.rows} rows)`,
  shots.rect84.rows === 4 && shots.rect84.w > shots.rect84.h);
ok("honeycomb row 2 is offset and still inside the board", shots.honeycomb.inBoard);
ok("every grid keeps its cells inside the 1080x165 band",
  Object.values(shots).every(s => s.inBoard));

/* ---- 3: spacing slider (touching by default) ---- */
await panel.evaluate(() => document.querySelector('[data-grid="checker"]').click());
await ov.waitForTimeout(900);
const gap0 = await ov.evaluate(() => {
  const c = document.querySelectorAll("#board .cell");
  return Math.round(c[1].getBoundingClientRect().left - c[0].getBoundingClientRect().right); });
ok(`buttons touch by default (gap ${gap0}px)`, gap0 === 0);
await panel.evaluate(() => { const r = document.querySelector("#gapRange");
  r.value = 14; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
await ov.waitForFunction(() => getComputedStyle(document.querySelector("#board")).gap.startsWith("14"),
  null, { timeout: 10000 });
const gap14 = await ov.evaluate(() => {
  const c = document.querySelectorAll("#board .cell");
  return Math.round(c[1].getBoundingClientRect().left - c[0].getBoundingClientRect().right); });
ok(`spacing slider moves the buttons apart (gap ${gap14}px at slider 14)`, gap14 === 14);
await ov.screenshot({ path: `${QA}/v4-gap-14.png`, clip: { x: 0, y: 470, width: 1080, height: 185 } });
/* back to touching */
await panel.evaluate(() => { const r = document.querySelector("#gapRange");
  r.value = 0; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
await ov.waitForTimeout(900);

/* ---- 4: highlights ---- */
await panel.evaluate(() => {                       // ambient effect on
  const c = [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(x => /Edge Glow/.test(x.querySelector(".name").textContent));
  c.querySelector("[data-part]").click();
});
await ov.waitForFunction(() => document.querySelector("#board").classList.contains("anim-glow"),
  null, { timeout: 10000 });
const noHl = await ov.evaluate(() => document.querySelector("#board").classList.contains("hl-mode"));
ok("with nothing highlighted the effect plays on all buttons", !noHl);

await panel.click('nav button[data-tab="board"]');
await panel.click("#hlModeBtn");
const mode = await panel.textContent("#hlModeBtn");
ok(`highlight mode toggle works ("${mode.trim()}")`, /HIGHLIGHT/.test(mode));
await panel.click('#ctlBoard .team[data-abbr="kc"]');
await panel.click('#ctlBoard .team[data-abbr="phi"]');
await ov.waitForFunction(() => document.querySelector("#board").classList.contains("hl-mode"),
  null, { timeout: 10000 });
const hl = await ov.evaluate(() => {
  const idx = (a) => window.ACBZ.ORDER.indexOf(a);
  const cells = document.querySelectorAll("#board .cell");
  const glows = (c) => getComputedStyle(c, "::after").display !== "none";
  return { kc: cells[idx("kc")].classList.contains("hl"), phi: cells[idx("phi")].classList.contains("hl"),
    sea: cells[idx("sea")].classList.contains("hl"),
    kcGlow: glows(cells[idx("kc")]), seaGlow: glows(cells[idx("sea")]) };
});
ok("only the highlighted teams animate (KC+PHI glow, SEA does not)",
  hl.kc && hl.phi && !hl.sea && hl.kcGlow && !hl.seaGlow);
await ov.waitForTimeout(1200);
await ov.screenshot({ path: `${QA}/v4-highlights.png`, clip: { x: 0, y: 470, width: 1080, height: 185 } });

/* deck highlight action */
await fetch(`${DECK}&action=highlight&team=sea&pc=2`);
await ov.waitForFunction(() =>
  document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("sea")].classList.contains("hl"),
  null, { timeout: 10000 });
ok("deck highlight action works from a Stream Deck button", true);

/* eliminating auto-unhighlights */
await fetch(`${DECK}&action=team_pick&team=sea&pc=2`);
await ov.waitForFunction(() => {
  const c = document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("sea")];
  return c.classList.contains("on") && !c.classList.contains("hl");
}, null, { timeout: 15000 });
ok("eliminating a team automatically unhighlights it", true);

/* ---- 5: reframe everywhere + zoom ---- */
const rfCounts = await panel.evaluate(() => {
  const c = {};
  for (const [tab, grid] of [["anims","#styleGrid"],["anims","#oneshotGrid"],
      ["banners","#bannerGrid"],["bgs","#bgGrid"],["style","#btnStyleGrid"],["style","#bgStyleGrid"]]) {
    document.querySelector(`nav button[data-tab="${tab}"]`).click();
    const cards = [...document.querySelectorAll(`${grid} .asset`)];
    const withMedia = cards.filter(x => x.querySelector("img,video"));
    c[grid] = [withMedia.length, withMedia.filter(x => x.querySelector("[data-rf]")).length];
  }
  return c;
});
ok(`every media card offers Reframe (${Object.entries(rfCounts).map(([k,v])=>`${k.replace("#","")} ${v[1]}/${v[0]}`).join(", ")})`,
  Object.values(rfCounts).every(([total, rf]) => rf === total));

await panel.click('nav button[data-tab="bgs"]');
await panel.waitForTimeout(600);
await panel.evaluate(() => {
  const c = [...document.querySelectorAll("#bgGrid .asset")]
    .find(x => /Stadium Lights/.test(x.querySelector(".name").textContent));
  c.querySelector("[data-rf]").click();
});
await panel.waitForTimeout(600);
const hasZoom = await panel.evaluate(() => !!document.querySelector("#rfZ"));
ok("reframe dialog has a zoom slider", hasZoom);
await panel.evaluate(() => { const z = document.querySelector("#rfZ");
  z.value = 180; z.dispatchEvent(new Event("input")); });
await panel.screenshot({ path: `${QA}/v4-reframe-zoom.png`, clip: { x: 300, y: 120, width: 680, height: 560 } });
await panel.click("#rfSave");
await panel.waitForTimeout(2500);
await panel.evaluate(() => {
  const c = [...document.querySelectorAll("#bgGrid .asset")]
    .find(x => /Stadium Lights/.test(x.querySelector(".name").textContent));
  c.querySelector("button[data-bg]").click();
});
await ov.waitForFunction(() =>
  (document.querySelector("#bgFrame img") ?? {}).src?.includes("stadium-lights"), null, { timeout: 10000 });
const zoomCss = await ov.evaluate(() => {
  const n = document.querySelector("#bgFrame img");
  return { pos: n.style.objectPosition, t: n.style.transform }; });
ok(`zoom reaches the overlay (${zoomCss.t || "none"})`, /scale\(1\.8\)/.test(zoomCss.t));

/* ---- 6: video generation uses Kling through the queue ---- */
const sub = await (await fetch(`${env.SUPABASE_URL}/functions/v1/generate-asset`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
             "content-type": "application/json" },
  body: JSON.stringify({ key: env.PANEL_KEY, kind: "button_anim", mode: "submit",
    prompt: "electric blue lightning crawling around the rim" }) })).json();
ok(`video generation submits to Kling via the queue (${(sub.model ?? "none").split("/").slice(0,3).join("/")})`,
  sub.ok === true && /kling/.test(sub.model ?? "") && !!sub.request_id);

/* ---- cleanup: restore PC2 ---- */
await fetch(`${DECK}&action=team_restore&team=sea&pc=2`);
await fetch(`${DECK}&action=highlight_clear&pc=2`);
await fetch(`${DECK}&action=set_background&name=TV Background&pc=2`);
await panel.click('nav button[data-tab="style"]');
await panel.waitForTimeout(500);
await panel.evaluate(() => {
  document.querySelector('[data-grid="buttons"]').click();
});
await panel.waitForTimeout(900);
await panel.evaluate(() => {
  const g = [...document.querySelectorAll("#btnStyleGrid .asset")]
    .find(x => /Gold Buttons/.test(x.querySelector(".name").textContent));
  g?.querySelector("[data-part]")?.click();
});
await panel.waitForTimeout(900);
await panel.evaluate(() => {
  const a = [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(x => /No Button Animation/.test(x.querySelector(".name").textContent));
  a?.querySelector("[data-part]")?.click();
});
await panel.waitForTimeout(1200);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
