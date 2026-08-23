/* Map the band structure of a button-frame source before cutting anything.
   Walks the centre row and centre column and reports every colour transition, so the
   frame / gap / inner-border / interior boundaries are measured rather than guessed. */
import { readRGBA, probe, alphaBBox, at, lum } from "./lib/pixels.mjs";

const file = process.argv[2] || "C:/ACBreakz-Cloud/GRAPHICS/Button 2.png";
const { w, h, pix } = probe(file);
const buf = readRGBA(file);
console.log(`${file}\n  ${w}x${h} ${pix}\n`);

const bb = alphaBBox(buf, w, h);
console.log(`alpha bbox: x ${bb.x0}..${bb.x1}  y ${bb.y0}..${bb.y1}  (${bb.w}x${bb.h})`);
console.log(`  margin: left ${bb.x0}  right ${w - 1 - bb.x1}  top ${bb.y0}  bottom ${h - 1 - bb.y1}\n`);

/* how much of the frame is opaque vs feathered */
let opaque = 0, partial = 0, clear = 0;
for (let i = 3; i < buf.length; i += 4) {
  const a = buf[i];
  if (a > 250) opaque++; else if (a > 8) partial++; else clear++;
}
console.log(`alpha: ${(100 * opaque / (w * h)).toFixed(1)}% opaque, ` +
  `${(100 * partial / (w * h)).toFixed(1)}% feathered, ${(100 * clear / (w * h)).toFixed(1)}% clear\n`);

/* transitions along the centre row: this is the band structure */
const scan = (fixed, horizontal) => {
  const out = [];
  let prev = null, start = 0;
  const N = horizontal ? w : h;
  for (let i = 0; i < N; i++) {
    const px = horizontal ? at(buf, w, i, fixed) : at(buf, w, fixed, i);
    const key = px[3] < 8 ? "clear"
      : lum(px) > 190 ? "white"
      : (px[0] > px[2] + 25 ? "copper" : (px[2] > px[0] + 12 ? "teal" : "grey"));
    if (key !== prev) {
      if (prev !== null) out.push(`${prev}:${start}-${i - 1}(${i - start}px)`);
      prev = key; start = i;
    }
  }
  out.push(`${prev}:${start}-${N - 1}`);
  return out;
};
console.log(`centre row  y=${h >> 1}:`);
console.log("  " + scan(h >> 1, true).join("  "));
console.log(`centre col  x=${w >> 1}:`);
console.log("  " + scan(w >> 1, false).join("  "));

/* colour at a few landmark points */
const pts = [["centre", w >> 1, h >> 1], ["interior upper-left", 330, 330],
  ["frame left edge", bb.x0 + 20, h >> 1], ["corner of frame", bb.x0 + 60, bb.y0 + 60]];
console.log("\nlandmarks:");
for (const [name, x, y] of pts)
  console.log(`  ${name.padEnd(22)} (${x},${y}) rgba(${at(buf, w, x, y).join(",")})`);
