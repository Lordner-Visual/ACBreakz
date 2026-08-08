/* M4 acceptance — hosted control panel composer:
   1) compose a 9-word banner -> saved as storage PNG with meta.type='text'
   2) add to rotation; measure its on-stream window = exactly 7s (min rule)
   3) AI art button -> generate-asset kind banner (ONE image, ~$0.03) -> appears in picker
   Cleans up: composed banner removed from rotation afterward (asset stays in library). */
import { chromium } from "playwright";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const TEXT = "USE CODE AUGUST50 FOR FIFTY DOLLARS OFF THIS WEEK"; // 9 words -> clamp to 7s
const ok = (n, c) => console.log(`${c ? "PASS" : "FAIL"}  ${n}`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });

const panel = await ctx.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await panel.click('nav button[data-tab="banners"]');
await panel.fill("#compText", TEXT);
await panel.waitForTimeout(600);
ok("composer duration label says 7s", (await panel.textContent("#compDur")).includes("7s"));
await panel.screenshot({ path: `${QA}/m4-composer-typed.png` });

/* save to library -> storage PNG + asset row */
await panel.click("#compSave");
await panel.waitForFunction((t) => // wait for the asset to land in the banner grid
  [...document.querySelectorAll("#bannerGrid .name")].some(n => n.textContent.startsWith(t.slice(0, 20))),
  TEXT, { timeout: 15000 });
const row = await panel.evaluate((t) => {
  const cards = [...document.querySelectorAll("#bannerGrid .asset")];
  const card = cards.find(c => c.querySelector(".name").textContent.startsWith(t.slice(0, 20)));
  return { name: card?.querySelector(".name")?.textContent ?? null,
           dur: card?.querySelector(".tag")?.textContent ?? null,
           img: card?.querySelector("img")?.src ?? null,
           rotId: card?.querySelector("[data-rot]")?.dataset.rot ?? null };
}, TEXT);
ok("composed banner saved as storage PNG", !!row.img?.includes("/media/banners/composed-"));
ok("grid shows 7s duration for it", row.dur === "7s");

/* add to rotation */
await panel.click(`#bannerGrid [data-rot="${row.rotId}"]`);
await panel.waitForTimeout(800);

/* overlay: wait for the composed banner, time its window */
const overlay = await ctx.newPage();
await overlay.setViewportSize({ width: 1080, height: 1920 });
await overlay.goto(`${HOSTED}/overlay/?layer=all&pc=4`, { waitUntil: "networkidle" });
const liveSrc = () => overlay.evaluate(() =>
  (document.querySelector("#banners .b.live img") ?? {}).src ?? "");
await overlay.waitForFunction(() =>
  ((document.querySelector("#banners .b.live img") ?? {}).src ?? "").includes("composed-"),
  null, { timeout: 70000, polling: 100 });
const t0 = Date.now();
await overlay.screenshot({ path: `${QA}/m4-banner-live.png`,
  clip: { x: 0, y: 560, width: 1080, height: 260 } });
await overlay.waitForFunction(() =>
  !(((document.querySelector("#banners .b.live img") ?? {}).src ?? "").includes("composed-")),
  null, { timeout: 15000, polling: 100 });
const windowMs = Date.now() - t0;
ok(`composed 9-word banner displayed ~7s (measured ${(windowMs/1000).toFixed(2)}s)`,
  Math.abs(windowMs - 7000) < 900);

/* AI art: ONE generation (~$0.03) */
await panel.fill("#compAiPrompt", "brushed copper and gold geometric energy strip, dark navy");
await panel.click("#compAiBtn");
const aiOk = await panel.waitForFunction(() =>
  [...document.querySelectorAll("#compBGs [data-cbg]")].some(d => d.dataset.cbg.includes("/ai-")),
  null, { timeout: 90000 }).then(() => true).catch(() => false);
/* generate-asset stores under `${kind}/ai-...` => banner/ai-<ts>.png */
const aiOpt = await panel.evaluate(() =>
  [...document.querySelectorAll("#compBGs [data-cbg]")].map(d => d.dataset.cbg)
    .find(u => u.includes("/ai-")) ?? null);
ok("AI art generated and landed in composer picker", aiOk && !!aiOpt);
if (aiOpt) {
  await panel.click(`#compBGs [data-cbg="${aiOpt}"]`);
  await panel.waitForTimeout(1500);
  await panel.screenshot({ path: `${QA}/m4-composer-ai-bg.png` });
}

/* cleanup: take composed banner out of rotation (asset stays in library) */
await panel.click('nav button[data-tab="banners"]');
const rid = await panel.evaluate((t) => {
  const cards = [...document.querySelectorAll("#bannerGrid .asset")];
  const card = cards.find(c => c.querySelector(".name").textContent.startsWith(t.slice(0, 20)));
  return card?.querySelector("[data-rot]")?.dataset.rot ?? null;
}, TEXT);
if (rid) { await panel.click(`#bannerGrid [data-rot="${rid}"]`); await panel.waitForTimeout(800); }
console.log("cleanup: composed banner removed from rotation");

await browser.close();
console.log("done");
