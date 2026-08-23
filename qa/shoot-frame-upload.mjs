/* A button frame is drawn 9-sliced, so the uploaded image has to supply a see-through
   middle and a measurable border thickness. Uploading a SOLID button image produced a
   frame that covered the fill and the logo and rendered as garbage on a live board, so
   the panel now measures both from the alpha channel and refuses what cannot work.

   The function under test is pulled straight out of control/index.html, so this cannot
   drift from what actually ships.

     node qa/serve-overlay.mjs &
     node qa/shoot-frame-upload.mjs                                                     */
import { chromium } from "playwright";
import { readFileSync } from "fs";

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const page_src = readFileSync("C:/ACBreakz-Cloud/control/index.html", "utf8");
const fn = page_src.match(/async function measureFrameSlice\(file\) \{[\s\S]*?\n  \}/);
if (!fn) { console.log("FAIL  could not find measureFrameSlice in control/index.html"); process.exit(1); }

const br = await chromium.launch();
const p = await (await br.newContext()).newPage();
await p.goto("http://localhost:8777/index.html?layer=hud&pc=1", { waitUntil: "load" });
await p.evaluate(src => { window.measureFrameSlice = eval("(" + src.replace(/^async function measureFrameSlice/, "async function") + ")"); }, fn[0]);

const run = (file) => p.evaluate(async (f) => {
  const blob = await fetch(f).then(r => r.blob());
  return await window.measureFrameSlice(new File([blob], f, { type: blob.type }));
}, file);

console.log("=== a real frame: transparent middle, measurable border ===");
const good = await run("/frame.png");
console.log("  " + JSON.stringify(good));
ok("accepted", good.ok === true);
ok(`border measured in the 1-45% band (${good.ok ? (good.sliceFrac * 100).toFixed(1) + "%" : "-"})`,
  good.ok && good.sliceFrac > 0.01 && good.sliceFrac < 0.45);
/* the artwork it came from measured .0752 at full resolution */
ok(`matches the offline extraction within a point (${good.ok ? good.sliceFrac : "-"} vs .0752)`,
  good.ok && Math.abs(good.sliceFrac - 0.0752) < 0.012);

console.log("\n=== a solid button image: must be refused, not stored ===");
const solid = await run("/background.png");
console.log("  " + JSON.stringify(solid));
ok("refused", solid.ok === false);
ok(`and says why ("${solid.why ?? ""}")`, /solid|see-through/.test(solid.why || ""));

await br.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
