/* The builtin split must be invisible: every PC has to look exactly as it did before.
   PC1-4 wear the full builtin (no custom texture) and must keep the copper bezel;
   PC5 has a custom texture and must NOT gain one. */
import { chromium } from "playwright";
const br = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await (await br.newContext({ viewport: { width: 1080, height: 900 } })).newPage();
await p.goto("http://localhost:8777/index.html?layer=hud&pc=1", { waitUntil: "load" });
await p.waitForTimeout(400);
await p.evaluate(() => {
  const bus = new BroadcastChannel("acbz-bus");
  window.__push = (o) => bus.postMessage({ kind: "state", data: Object.assign({
    background: null, banners: { rotation: [] }, board: { picked: {}, highlighted: {} },
    animStyle: null, boardBg: null, buttonAnims: [], boardGrid: "checkerbare",
    boardGap: 0, boardSize: 100, logoSize: 100, fxIntensity: 100 }, o, { updatedAt: Date.now() }) });
});
const look = async (label, st) => {
  await p.evaluate(o => window.__push(o), st);
  await p.waitForTimeout(900);
  const r = await p.evaluate(() => {
    const b = document.getElementById("board"), c = b.querySelector(".cell");
    const cs = getComputedStyle(c);
    return { gold: b.classList.contains("frame-gold"), teal: b.classList.contains("btn-teal"),
      border: cs.borderTopWidth, bgLayers: (cs.backgroundImage.match(/gradient|url/g) || []).length,
      tex: !!c.querySelector("img.tex"), frm: !!c.querySelector("img.frm") };
  });
  console.log(`  ${label.padEnd(34)} ${JSON.stringify(r)}`);
  return r;
};
console.log("=== no board has ever set boardFrame — today's look must survive ===");
const a = await look("PC1-4 live grid: checkerbare", { boardButtons: null });
/* checkerbare has ALWAYS removed the bezel (grid-checkerbare sets border:none), so the
   thing to prove there is that both gradient layers still paint. The bezel itself is
   only visible on the default grid. */
const a2 = await look("default grid: buttons", { boardButtons: null, boardGrid: "buttons" });
const b = await look("PC5 (custom texture)",
  { boardButtons: { id: "s", name: "t", url: "http://localhost:8777/background.png", meta: {} } });
console.log("\n=== once the operator chooses explicitly ===");
const c = await look("frame OFF (explicit null)", { boardButtons: null, boardFrame: null });
const d = await look("frame = uploaded image", { boardButtons: null,
  boardFrame: { id: "f", name: "fr", url: "http://localhost:8777/frame.png", meta: {} } });

let fails = 0;
const ok = (n, v) => { console.log(`${v ? "PASS" : "FAIL"}  ${n}`); if (!v) fails++; };
console.log("");
ok("checkerbare still paints both builtin layers, still no bezel (unchanged)",
  a.gold && a.teal && a.bgLayers === 2 && a.border === "0px");
ok("the default grid still gets the copper bezel", a2.gold && a2.teal && a2.border !== "0px");
ok("PC5 gains no bezel, and its texture is a layer", !b.gold && !b.teal && b.tex && !b.frm);
ok("an explicit null really turns the frame off", !c.gold && c.border === "0px");
ok("an uploaded frame renders as a layer, not the builtin", d.frm && !d.gold);
await br.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
