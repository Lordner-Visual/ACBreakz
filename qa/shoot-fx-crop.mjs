/* Reframe crop on the FX layer — a zoom must crop INSIDE the animation frame, not
   move or grow the frame, and a still image's pop must multiply with the zoom
   rather than override it (a running keyframe animation outranks inline transform).

   Offline harness: serve overlay/ with a config whose SUPABASE_URL is blank, plus a
   short clip.webm and a still.png, then drive it over BroadcastChannel. Nothing in
   production is touched.
     node qa/serve-overlay.mjs &   # or any static server on :8777
     node qa/shoot-fx-crop.mjs */
import { chromium } from "playwright";
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const br = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await (await br.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
await p.goto("http://localhost:8777/index.html?layer=fx&pc=1", { waitUntil: "load" });
await p.waitForTimeout(300);
await p.evaluate(() => {
  const bus = new BroadcastChannel("acbz-bus");
  window.__ev = (payload) => bus.postMessage({ kind: "event",
    data: { id: "e" + Math.random(), type: "play_animation", created_at: new Date().toISOString(), payload } });
});
/* one job renders at a time (fxBusy), so wait for the lane to clear before firing again */
const idle = async () => { for (let i=0;i<200;i++){
  const busy = await p.evaluate(() => ["fxVidBox","fxImgBox"].some(id => getComputedStyle(document.getElementById(id)).display !== "none"));
  if (!busy) return true; await p.waitForTimeout(100); } return false; };
const shown = async (id) => { for (let i=0;i<100;i++){
  const on = await p.evaluate(x => getComputedStyle(document.getElementById(x)).display !== "none", id);
  if (on) return true; await p.waitForTimeout(50); } return false; };
const box = () => p.evaluate(() => {
  const b = document.getElementById("fxVidBox"), v = document.getElementById("fxVideo");
  const r = b.getBoundingClientRect();
  return { display: getComputedStyle(b).display, overflow: getComputedStyle(b).overflow,
    left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    fit: getComputedStyle(v).objectFit, pos: getComputedStyle(v).objectPosition,
    transform: getComputedStyle(v).transform };
});

console.log("=== boxed one-shot, no crop ===");
await idle(); await p.evaluate(() => window.__ev({ url: "http://localhost:8777/clip.webm", boxed: true }));
await shown("fxVidBox");
let b = await box();
console.log(`  box ${b.w}x${b.h} @(${b.left},${b.top})  fit=${b.fit} overflow=${b.overflow} transform=${b.transform}`);
ok("  sits in the 667x413 animation box and clips", b.w === 667 && b.h === 413 && b.left === 207 && b.top === 800 && b.overflow === "hidden");
ok("  no zoom applied when there is no crop", b.transform === "none" && b.fit === "contain");

console.log("\n=== same clip with a 250% zoom + off-centre pan ===");
await idle(); await p.evaluate(() => window.__ev({ url: "http://localhost:8777/clip.webm", boxed: true,
  crop: { x: 20, y: 80, z: 250 } }));
await shown("fxVidBox");
b = await box();
console.log(`  box ${b.w}x${b.h} @(${b.left},${b.top})  pos=${b.pos} transform=${b.transform}`);
ok("  the frame itself did NOT move or grow", b.w === 667 && b.h === 413 && b.left === 207 && b.top === 800);
ok("  zoom is applied to the media (scale 2.5)", /matrix\(2\.5,/.test(b.transform));
ok("  pan is applied", b.pos.startsWith("20% 80%"));

console.log("\n=== 600% must not be clamped to 400% any more ===");
await idle(); await p.evaluate(() => window.__ev({ url: "http://localhost:8777/clip.webm", boxed: true,
  crop: { x: 50, y: 50, z: 600 } }));
await shown("fxVidBox");
b = await box();
ok(`  600% zoom reaches scale 6 (${b.transform})`, /matrix\(6,/.test(b.transform));

console.log("\n=== fill-the-section still covers the lower camera region ===");
await idle(); await p.evaluate(() => window.__ev({ url: "http://localhost:8777/clip.webm", fit: "full" }));
await shown("fxVidBox");
b = await box();
console.log(`  box ${b.w}x${b.h} @(${b.left},${b.top}) fit=${b.fit}`);
ok("  1080x1275 at y645, cover", b.w === 1080 && b.h === 1275 && b.left === 0 && b.top === 645 && b.fit === "cover");

console.log("\n=== a still image: the pop must compose with the zoom, not replace it ===");
await idle(); await p.evaluate(() => window.__ev({ url: "http://localhost:8777/still.png", image: true,
  crop: { x: 50, y: 50, z: 200 } }));
await shown("fxImgBox");
await p.waitForTimeout(250);
const im = await p.evaluate(() => {
  const i = document.getElementById("fxImg");
  const m = getComputedStyle(i).transform.match(/matrix\(([\d.]+)/);
  return { rfz: i.style.getPropertyValue("--rfz"), scale: m ? +m[1] : null,
    boxW: Math.round(document.getElementById("fxImgBox").getBoundingClientRect().width) };
});
console.log(`  --rfz=${im.rfz} live scale=${im.scale} box=${im.boxW}px`);
ok("  the zoom reached the keyframes (scale is ~2x the pop's own value)", im.scale !== null && im.scale > 1.6);
await br.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
