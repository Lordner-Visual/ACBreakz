/* The banner band slides left-to-right instead of crossfading, and does it smoothly.

   - the incoming banner enters from off-canvas LEFT, the outgoing leaves RIGHT, and the
     pair tiles edge to edge while travelling: no overlap, no sliver of empty band
   - nothing fades
   - motion is EVEN. The first cut used an ease-out that launched at 83px/frame and then
     crawled the last 150px at 1-2px/frame; that reads as a jerk followed by a creep.
   - a banner whose file is dead must never enter the band. It used to slide in blank and
     then restart the whole transition when onerror fired — measured on the live rig as
     the band snapping back to the left edge mid-travel.

   Offline harness (production untouched):
     node qa/serve-overlay.mjs &
     node qa/shoot-banner-slide.mjs                                                   */
import { chromium } from "playwright";

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const br = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await (await br.newContext({ viewport: { width: 1080, height: 900 } })).newPage();
await p.goto("http://localhost:8777/index.html?layer=hud&pc=1", { waitUntil: "load" });
await p.waitForTimeout(300);

await p.evaluate(() => {
  const bus = new BroadcastChannel("acbz-bus");
  const base = { background: null, board: { picked: {}, highlighted: {} }, animStyle: null,
    boardButtons: null, boardBg: null, buttonAnims: [], boardGrid: "buttons",
    boardGap: 0, boardSize: 100, logoSize: 100, fxIntensity: 100 };
  window.__push = (rotation) => bus.postMessage({ kind: "state",
    data: Object.assign({}, base, { banners: { rotation } }, { updatedAt: Date.now() }) });
  /* text banners need no media, so the geometry cases depend on nothing external */
  window.__banner = (id, text, secs) =>
    ({ id, name: text, url: null, kind: "banner", meta: { type: "text", text, durationSec: secs } });
  window.__image = (id, url, secs) =>
    ({ id, name: id, url, kind: "banner", meta: { durationSec: secs } });
});

/* every .b in the band: its x offset relative to the band, and whether it is faded */
const strip = () => p.evaluate(() => {
  const band = document.getElementById("banners").getBoundingClientRect();
  return [...document.querySelectorAll("#banners .b")].map(n => {
    const r = n.getBoundingClientRect(), m = n.querySelector("img,video");
    return { text: n.textContent.trim(), src: m?.getAttribute("src") || "",
      x: Math.round(r.left - band.left), w: Math.round(r.width),
      opacity: Number(getComputedStyle(n).opacity).toFixed(2),
      live: n.classList.contains("live"), out: n.classList.contains("out") };
  });
});

console.log("=== a single banner settles flush in the band ===");
await p.evaluate(() => window.__push([window.__banner("a", "ONE", 3)]));
await p.waitForTimeout(1400);
let s = await strip();
console.log("  " + JSON.stringify(s.map(n => ({ text: n.text, x: n.x }))));
ok(`one banner, seated at x=0 (${s.length} element(s), x=${s[0]?.x})`,
  s.length === 1 && s[0].x === 0 && s[0].live);
ok(`it is fully opaque — the slide replaced the fade, it did not add to it (${s[0]?.opacity})`,
  s[0]?.opacity === "1.00");

console.log("\n=== a lone banner must NOT re-slide every cycle ===");
/* durationSec 3 means the rotator fires again at ~3s; with one banner it must hold */
const before = await strip();
await p.waitForTimeout(4200);
const after = await strip();
console.log(`  after a full cycle: ${JSON.stringify(after.map(n => ({ text: n.text, x: n.x })))}`);
ok(`still exactly one element, still seated (was ${before.length}, now ${after.length})`,
  after.length === 1 && after[0].x === 0);

console.log("\n=== two banners: catch a real rotation step mid-flight ===");
await p.evaluate(() => window.__push(
  [window.__banner("a", "ONE", 2), window.__banner("b", "TWO", 2)]));
/* Let the list-change re-render finish first — that one goes ONE -> ONE and proves
   nothing about a rotation step. */
await p.waitForTimeout(1700);

/* A frame is IN FLIGHT only while the incoming banner is still LEFT of the band.
   .live/.out both persist after the transition ends, so testing for the classes alone
   matches the settled state too — and .live names the OLD banner in the frame before
   the slide starts, which reads as a jump backwards. Position is the honest signal. */
const frames = [];
for (let i = 0; i < 200; i++) {
  const f = await strip();
  if (f.length === 2 && f.some(n => n.live && n.x < 0)) frames.push(f);
  else if (frames.length) break;                      // transition finished
  if (frames.length >= 10) break;
  await p.waitForTimeout(25);
}
console.log(`  captured ${frames.length} in-flight frames`);
ok(`a rotation step was caught in flight (${frames.length} frames)`, frames.length > 0);

if (frames.length) {
  const mid = frames[Math.floor(frames.length / 2)];
  const incoming = mid.find(n => n.live), outgoing = mid.find(n => n.out);
  console.log(`  mid-flight: incoming "${incoming?.text}" @x=${incoming?.x}, ` +
              `outgoing "${outgoing?.text}" @x=${outgoing?.x}`);
  ok(`a genuine step between two different banners ("${outgoing?.text}" -> "${incoming?.text}")`,
    !!incoming && !!outgoing && incoming.text !== outgoing.text);
  ok(`the incoming banner enters from the LEFT (x=${incoming?.x} < 0)`,
    !!incoming && incoming.x < 0);
  ok(`the outgoing banner leaves to the RIGHT (x=${outgoing?.x} > 0)`,
    !!outgoing && outgoing.x > 0);
  ok(`they tile with no gap and no overlap (incoming right edge = outgoing left edge)`,
    !!incoming && !!outgoing && Math.abs((incoming.x + incoming.w) - outgoing.x) <= 2);
  ok(`neither fades (opacities ${mid.map(n => n.opacity).join(", ")})`,
    mid.every(n => n.opacity === "1.00"));

  const xs = frames.map(f => f.find(n => n.live)?.x).filter(x => x !== undefined);
  console.log(`  incoming x over time: ${xs.join(" -> ")}`);
  ok(`motion is left-to-right throughout, never backwards`,
    xs.every((x, i) => i === 0 || x >= xs[i - 1] - 2));
  ok(`the incoming banner actually travelled (${xs[0]} -> ${xs[xs.length - 1]})`,
    xs.length > 1 && xs[xs.length - 1] > xs[0]);
  /* the old ease-out opened with an 83px jump; a gentle ease-in must not */
  const firstStep = xs.length > 1 ? xs[1] - xs[0] : 999;
  console.log(`  opening step: ${firstStep}px`);
  ok(`it eases IN rather than launching (${firstStep}px on the first step, was 83)`,
    firstStep < 40);
}

console.log("\n=== a dead file must never enter the band ===");
const DEAD = "http://localhost:8777/does-not-exist.png";
await p.evaluate((dead) => window.__push([
  window.__image("good", "http://localhost:8777/still.png", 2),
  window.__image("dead", dead, 2),
]), DEAD);

/* watch a couple of full cycles and record everything that ever appears */
const seen = [], path = [];
for (let i = 0; i < 260; i++) {
  const f = await strip();
  f.forEach(n => { if (n.src && !seen.includes(n.src)) seen.push(n.src); });
  const inc = f.find(n => n.live && n.x < 0);
  path.push(inc ? inc.x : null);          // null = nothing in flight, i.e. between transitions
  await p.waitForTimeout(25);
}
console.log(`  sources that reached the band: ${seen.map(u => u.split("/").pop()).join(", ")}`);
ok(`the dead file never made it into the band`, !seen.includes(DEAD));
ok(`the good banner did render (${seen.length} source(s))`, seen.some(u => u.endsWith("still.png")));
/* A restart is a backward jump WITHIN one continuous flight — the broken element is
   pulled and a replacement appended in the same tick, so there is never an idle frame
   between them. Comparing across separate transitions would flag every dwell instead. */
const runs = [];
path.forEach(x => { if (x === null) { runs.push([]); } else { (runs[runs.length-1] ||= []).push(x); } });
const flights = runs.filter(r => r.length > 1);
const restarts = flights.reduce((n, r) => n + r.filter((x, i) => i > 0 && x < r[i-1] - 40).length, 0);
console.log(`  ${flights.length} flight(s) sampled: ${flights.map(r => r.length + " frames").join(", ")}`);
ok(`no flight restarted mid-travel (${restarts} backward snaps inside a flight)`, restarts === 0);

await br.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
