/* Board-background and button-style crop, plus negative button spacing.
   Offline harness (overlay/ served on :8777 with a blank SUPABASE_URL + still.png),
   driven over BroadcastChannel — production is not touched. */
import { chromium } from "playwright";

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const br = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await (await br.newContext({ viewport: { width: 1080, height: 900 } })).newPage();
await p.goto("http://localhost:8777/index.html?layer=hud&pc=1", { waitUntil: "load" });
await p.waitForTimeout(300);

await p.evaluate(() => {
  const bus = new BroadcastChannel("acbz-bus");
  const base = { background: null, banners: { rotation: [] },
    board: { picked: {}, highlighted: {} }, animStyle: null,
    boardButtons: null, boardBg: null, buttonAnims: [],
    boardGrid: "buttons", boardGap: 0, boardSize: 100, logoSize: 100, fxIntensity: 100 };
  window.__push = o => bus.postMessage({ kind: "state",
    data: Object.assign({}, base, o, { updatedAt: Date.now() }) });
});
const set = async (o) => { await p.evaluate(x => window.__push(x), o); await p.waitForTimeout(500); };

console.log("=== board background (still image) ===");
await set({ boardBg: { id: "b", name: "bg", url: "http://localhost:8777/still.png", meta: {} } });
let r = await p.evaluate(() => {
  const w = document.querySelector("#board .looper"), im = w?.querySelector("img");
  return w ? { has: true, tag: im?.tagName, overflow: getComputedStyle(w).overflow,
    tr: getComputedStyle(im).transform, pos: getComputedStyle(im).objectPosition,
    cssBg: document.getElementById("board").style.backgroundImage } : { has: false };
});
console.log(`  element=${r.tag} overflow=${r.overflow} transform=${r.tr} cssBackground="${r.cssBg}"`);
ok("  a still board background is a real <img> in a clipping wrapper", r.has && r.tag === "IMG" && r.overflow === "hidden");
ok("  it is no longer a CSS background-image (nothing to transform)", r.cssBg === "");

await set({ boardBg: { id: "b", name: "bg", url: "http://localhost:8777/still.png",
  meta: { crop: { x: 30, y: 70, z: 240 } } } });
r = await p.evaluate(() => { const im = document.querySelector("#board .looper img");
  return { tr: getComputedStyle(im).transform, pos: getComputedStyle(im).objectPosition }; });
console.log(`  with crop: transform=${r.tr} objectPosition=${r.pos}`);
ok("  240% zoom applied", /matrix\(2\.4,/.test(r.tr));
ok("  pan applied", r.pos.startsWith("30% 70%"));

console.log("\n=== button style texture: cover-fitted, never stretched ===");
/* still.png is 640x360, deliberately NOT square, so a stretch to a square cell is
   obvious: background-size:100% 100% warped it, object-fit:cover crops it instead. */
await set({ boardButtons: { id: "s", name: "btn", url: "http://localhost:8777/still.png", meta: {} } });
r = await p.evaluate(() => {
  const c = document.querySelector("#board .cell");
  const t = c.querySelector("img.tex");
  if (!t) return { none: true };
  const cb = c.getBoundingClientRect(), tb = t.getBoundingClientRect();
  const cs = getComputedStyle(t);
  return { fit: cs.objectFit, pos: cs.objectPosition, tr: cs.transform,
    natural: `${t.naturalWidth}x${t.naturalHeight}`,
    fillsCell: Math.abs(tb.width - cb.width) < 1.5 && Math.abs(tb.height - cb.height) < 1.5 };
});
console.log(`  no crop: element=${r.none ? "MISSING" : "img.tex"} fit=${r.fit} natural=${r.natural}`);
ok("  the texture is a real element, not a stretched background", !r.none);
ok("  it is cover-fitted, so a non-square source crops instead of warping",
  r.fit === "cover");
ok("  and it fills the cell exactly", r.fillsCell === true);

await set({ boardButtons: { id: "s", name: "btn", url: "http://localhost:8777/still.png",
  meta: { crop: { x: 10, y: 90, z: 300 } } } });
r = await p.evaluate(() => { const t = document.querySelector("#board .cell img.tex");
  return { tr: getComputedStyle(t).transform, pos: getComputedStyle(t).objectPosition }; });
console.log(`  300% crop: transform=${r.tr} objectPosition=${r.pos}`);
ok("  zoom is a scale on the element", r.tr.startsWith("matrix(3"));
ok("  pan is objectPosition 10% 90%", r.pos.startsWith("10% 90%"));

console.log("\n=== button frame: a separate layer above the texture ===");
await set({ boardButtons: { id: "s", name: "btn", url: "http://localhost:8777/still.png", meta: {} },
            boardFrame: { id: "f", name: "frame", url: "http://localhost:8777/frame.png", meta: {} } });
r = await p.evaluate(() => {
  const c = document.querySelector("#board .cell");
  const t = c.querySelector("img.tex"), f = c.querySelector("div.frm");
  if (!t || !f) return { none: true };
  const fs_ = getComputedStyle(f);
  return { slice: fs_.borderImageSlice, bw: fs_.borderTopWidth, src: fs_.borderImageSource.slice(0,20),
    texZ: +getComputedStyle(t).zIndex, frmZ: +getComputedStyle(f).zIndex,
    logoZ: +getComputedStyle(c.querySelector("img.logo")).zIndex };
});
console.log(`  z-order: tex=${r.texZ} frame=${r.frmZ} logo=${r.logoZ}  slice=${r.slice} borderWidth=${r.bw}`);
ok("  both layers exist together", !r.none);
ok("  the frame is 9-sliced, so every edge survives any cell shape",
  /%/.test(r.slice) && r.bw !== "0px" && r.src.includes("url"));
ok("  frame sits ABOVE the texture and BELOW the logo",
  r.texZ < r.frmZ && r.frmZ < r.logoZ);
await set({ boardFrame: null });

console.log("\n=== button spacing, including negative ===");
await set({ boardButtons: null, boardBg: null });
const span = () => p.evaluate(() => {
  const cells = [...document.querySelectorAll("#board .cell")];
  const a = cells[0].getBoundingClientRect(), b = cells[1].getBoundingClientRect();
  const last = cells[15].getBoundingClientRect();
  const cs = getComputedStyle(document.getElementById("board"));
  return { pitch: Math.round(b.left - a.left), w: Math.round(a.width),
    left: Math.round(a.left), right: Math.round(last.right),
    track: cs.getPropertyValue("--track").trim(), gap: cs.getPropertyValue("--gap").trim() };
});
for (const g of [10, 0, -10, -20]) {
  await set({ boardGap: g });
  const s = await span();
  const overlap = s.w - s.pitch;
  console.log(`  gap ${String(g).padStart(3)}  tile=${s.w}px pitch=${s.pitch}px overlap=${overlap}px  track=${s.track} css-gap=${s.gap}  row x${s.left}..x${s.right}`);
  if (g >= 0) ok(`  gap ${g}: tiles are ${g}px apart`, s.pitch - s.w === g);
  else ok(`  gap ${g}: tiles overlap by ${-g}px`, overlap === -g);
  ok(`  gap ${g}: row still fits the canvas`, s.left >= 0 && s.right <= 1080);
}

await br.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
