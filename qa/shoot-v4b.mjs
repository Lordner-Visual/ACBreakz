/* V4b acceptance — the three follow-up requests + the boxed one-shot fill. */
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
await panel.evaluate((k) => { localStorage.setItem("acbz-panel-key", k); localStorage.setItem("acbz-pc", "3"); }, env.PANEL_KEY);
await panel.reload({ waitUntil: "networkidle" });
await panel.waitForTimeout(2500);

/* ---- 1: composed text banners are rotation-only ---- */
await panel.click('nav button[data-tab="banners"]');
await panel.waitForTimeout(800);
const before = await panel.evaluate(() => ({
  comp: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
  rot: [...document.querySelectorAll("#bannerGrid .name")].map(n => n.textContent),
}));
const marker = "V4B TEXT BANNER CHECK";
await panel.fill("#compText", marker);
await panel.click("#compSave");
await panel.waitForFunction((m) =>
  [...document.querySelectorAll("#bannerGrid .name")].some(n => n.textContent.startsWith(m.slice(0,18))),
  marker, { timeout: 20000 });
await panel.waitForTimeout(800);
const after = await panel.evaluate(() => ({
  comp: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
  rot: [...document.querySelectorAll("#bannerGrid .name")].map(n => n.textContent),
}));
ok("saved text banner appears in the rotation list",
  after.rot.some(n => n.startsWith(marker.slice(0,18))));
ok("saved text banner does NOT pollute the composer backgrounds",
  !after.comp.some(n => n.startsWith(marker.slice(0,18))) && after.comp.length === before.comp.length);
ok(`AI/uploaded art still IS in the composer picker (${after.comp.length} options)`, after.comp.length > 1);
await panel.screenshot({ path: `${QA}/v4b-banners.png`, clip: { x: 0, y: 0, width: 1280, height: 780 } });

/* clean the marker banner up */
const delId = await panel.evaluate((m) => {
  const c = [...document.querySelectorAll("#bannerGrid .asset")]
    .find(x => x.querySelector(".name").textContent.startsWith(m.slice(0,18)));
  return c?.querySelector("[data-del]")?.dataset.del ?? null; }, marker);
if (delId) { await panel.click(`[data-del="${delId}"]`); await panel.waitForTimeout(300);
  await panel.click(`[data-del="${delId}"]`); await panel.waitForTimeout(2000); }

/* ---- 2: folder poster + video thumbnails ---- */
await panel.click('nav button[data-tab="anims"]');
await panel.waitForTimeout(1200);
const thumbs = await panel.evaluate(() => {
  const style = [...document.querySelectorAll("#styleGrid .asset")]
    .find(x => /Classic Stingers/.test(x.querySelector(".name").textContent));
  const img = style?.querySelector("img");
  const vids = [...document.querySelectorAll("#oneshotGrid video")].map(v => v.getAttribute("src"));
  return { poster: img?.src ?? null,
    posterLoaded: !!img && img.complete && img.naturalWidth > 0,
    vids };
});
ok(`Classic Stingers folder shows a frame from its videos (${(thumbs.poster ?? "none").split("/").pop()})`,
  !!thumbs.poster?.includes("classic-stingers-poster") && thumbs.posterLoaded);
ok(`video thumbnails seek past the blank first frame (${thumbs.vids.filter(v=>/#t=/.test(v)).length}/${thumbs.vids.length} use #t=)`,
  thumbs.vids.length > 0 && thumbs.vids.every(v => /#t=/.test(v)));
await panel.screenshot({ path: `${QA}/v4b-thumbnails.png`, clip: { x: 0, y: 0, width: 1280, height: 760 } });

/* ---- 3: boxed one-shot now fills the animation box ---- */
const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=all&debug=1&pc=3`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);
await fetch(`${DECK}&action=play&name=Spin&pc=3`);
await ov.waitForFunction(() => document.querySelector("#fxVideo").style.display === "block",
  null, { timeout: 15000 });
await ov.waitForTimeout(2000);
const fill = await ov.evaluate(() => {
  const v = document.querySelector("#fxVideo");
  const r = v.getBoundingClientRect();
  /* how much of the 667x413 box the video's visible content actually covers */
  const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
  const shownW = v.videoWidth * scale, shownH = v.videoHeight * scale;
  return { box:[r.width, r.height], src:[v.videoWidth, v.videoHeight],
    coverage: +( (shownW*shownH) / (r.width*r.height) ).toFixed(2),
    inside: r.x >= 207 && r.y >= 800 && r.right <= 874 && r.bottom <= 1213 };
});
ok(`one-shot fills the box without leaving it (${fill.src.join("x")} source, ${Math.round(fill.coverage*100)}% of the 667x413 box)`,
  fill.inside && fill.coverage >= 0.55);
await ov.screenshot({ path: `${QA}/v4b-oneshot-fill.png` });

/* ---- 4: seamless looping background ---- */
const bgClip = await panel.evaluate(() => {
  document.querySelector('nav button[data-tab="bgs"]').click();
  const c = [...document.querySelectorAll("#bgGrid .asset")]
    .find(x => /TV Background/.test(x.querySelector(".name").textContent));
  c.querySelector("button[data-bg]").click(); return true;
});
await ov.waitForFunction(() => document.querySelectorAll("#bgFrame .looper video").length === 2,
  null, { timeout: 15000 });
const looper = await ov.evaluate(() => {
  const vs = [...document.querySelectorAll("#bgFrame .looper video")];
  return { count: vs.length, playing: vs.filter(v => !v.paused).length,
    xfade: getComputedStyle(vs[0]).transitionDuration };
});
ok(`looping background uses a crossfading pair (${looper.count} elements, ${looper.playing} playing, ${looper.xfade} fade)`,
  looper.count === 2 && looper.playing >= 1 && parseFloat(looper.xfade) > 0);

await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
