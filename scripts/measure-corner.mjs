/* Measure the corner radius of a rounded-rect artwork, as a fraction of its width, so
   the overlay's --radius can be set to match the art instead of guessed.

   For a rounded rect the top row of the silhouette runs from x0+r to x1-r, so the inset
   of the first opaque pixel on that row IS the radius. Sampled a few rows down from the
   very edge to skip antialiasing.

     node scripts/measure-corner.mjs "<file.png>"                                        */
import { readRGBA, probe, alphaBBox } from "./lib/pixels.mjs";

const F = process.argv[2] || "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/" +
  "1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/btnwork/frame.png";
const { w, h } = probe(F);
const buf = readRGBA(F);
const A = (x, y) => buf[((y * w + x) << 2) + 3];
const bb = alphaBBox(buf, w, h, 128);
console.log(`${F.split("/").pop()}  ${w}x${h}  silhouette ${bb.w}x${bb.h} at (${bb.x0},${bb.y0})`);

/* inset of the first solid pixel on each of the first few rows/cols */
const rowInset = (y) => { for (let x = bb.x0; x <= bb.x1; x++) if (A(x, y) > 128) return x - bb.x0; return -1; };
const colInset = (x) => { for (let y = bb.y0; y <= bb.y1; y++) if (A(x, y) > 128) return y - bb.y0; return -1; };

const rows = [2, 3, 4].map(d => rowInset(bb.y0 + d)).filter(v => v >= 0);
const cols = [2, 3, 4].map(d => colInset(bb.x0 + d)).filter(v => v >= 0);
const r = Math.round((rows.reduce((a, b) => a + b, 0) / rows.length +
                      cols.reduce((a, b) => a + b, 0) / cols.length) / 2);
const frac = r / bb.w;
console.log(`  top-row insets ${rows.join(", ")}   left-col insets ${cols.join(", ")}`);
console.log(`  corner radius ~${r}px of ${bb.w}px wide  ->  ${(frac * 100).toFixed(1)}% of the button`);
console.log(`  overlay currently uses --radius: calc(var(--tile) * .14)  = 14.0%`);
console.log(`  suggested:                --radius: calc(var(--tile) * ${frac.toFixed(3)})`);
