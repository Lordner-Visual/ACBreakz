/* The banner band slides left-to-right instead of crossfading.

   The incoming banner must enter from off-canvas LEFT and the outgoing one leave to the
   RIGHT, travelling together so the pair tiles edge to edge — no overlap, no sliver of
   empty band between them — and neither may fade.

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
  /* text banners need no media, so nothing here depends on the network */
  window.__banner = (id, text, secs) =>
    ({ id, name: text, url: null, kind: "banner", meta: { type: "text", text, durationSec: secs } });
});

/* every .b in the band: its x offset relative to the band, and whether it is faded */
const strip = () => p.evaluate(() => {
  const band = document.getElementById("banners").getBoundingClientRect();
  return [...document.querySelectorAll("#banners .b")].map(n => {
    const r = n.getBoundingClientRect();
    return { text: n.textContent.trim(),
      x: Math.round(r.left - band.left), w: Math.round(r.width),
      opacity: Number(getComputedStyle(n).opacity).toFixed(2),
      live: n.classList.contains("live"), out: n.classList.contains("out") };
  });
});

console.log("=== a single banner settles flush in the band ===");
await p.evaluate(() => window.__push([window.__banner("a", "ONE", 3)]));
await p.waitForTimeout(1200);
let s = await strip();
console.log("  " + JSON.stringify(s));
ok(`one banner, seated at x=0 (${s.length} element(s), x=${s[0]?.x})`,
  s.length === 1 && s[0].x === 0 && s[0].live);
ok(`it is fully opaque — the slide replaced the fade, it did not add to it (${s[0]?.opacity})`,
  s[0]?.opacity === "1.00");

console.log("\n=== a lone banner must NOT re-slide every cycle ===");
/* durationSec 3 means the rotator fires again at ~3s; with one banner it must hold */
const before = await strip();
await p.waitForTimeout(4200);
const after = await strip();
console.log(`  after a full cycle: ${JSON.stringify(after)}`);
ok(`still exactly one element, still seated (was ${before.length}, now ${after.length})`,
  after.length === 1 && after[0].x === 0);

console.log("\n=== two banners: catch a real rotation step mid-flight ===");
await p.evaluate(() => window.__push(
  [window.__banner("a", "ONE", 2), window.__banner("b", "TWO", 2)]));
/* Let the list-change re-render finish first — that one goes ONE -> ONE and proves
   nothing about a rotation step. */
await p.waitForTimeout(1500);

/* A frame is IN FLIGHT only while the incoming banner is still LEFT of the band.
   .live/.out both persist after the transition ends, so testing for the classes alone
   matches the settled state too — and .live names the OLD banner in the frame before
   the slide starts, which reads as a jump backwards. Position is the honest signal. */
const frames = [];
for (let i = 0; i < 200; i++) {
  const f = await strip();
  if (f.length === 2 && f.some(n => n.live && n.x < 0)) frames.push(f);
  else if (frames.length) break;                      // transition finished
  if (frames.length >= 8) break;
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
}

console.log("\n=== it settles again after the slide ===");
await p.waitForTimeout(1400);
s = await strip();
const live = s.filter(n => n.live);
console.log("  " + JSON.stringify(s));
ok(`exactly one live banner, seated at x=0`,
  live.length === 1 && live[0].x === 0);

await br.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
