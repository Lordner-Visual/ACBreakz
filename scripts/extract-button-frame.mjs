/* Split a button artwork into a FRAME (border, transparent centre) and a BACKGROUND
   (the interior fill), so the two can be layered independently on a tile.

   The interior boundary is a rounded rect with a bevel, so a square crop cannot find it.
   Instead the interior is flood-filled from the centre, using the bright inner border as
   the wall — that follows whatever curve the artwork actually has.

   The drop shadow is excluded by taking the bbox at near-full alpha: the shadow is
   feathered, the button is not. That is what "scale the button to the canvas edge" means
   here — the shadow would otherwise sit inside the tile and look wrong once tiles abut.

     node scripts/extract-button-frame.mjs "GRAPHICS/Button 2.png" "Button 2"          */
import { readRGBA, writeRGBA, probe, alphaBBox, at, lum, FFDIR } from "./lib/pixels.mjs";
import { execFileSync } from "child_process";
import { mkdirSync, existsSync, writeFileSync } from "fs";

const SRC = process.argv[2] || "C:/ACBreakz-Cloud/GRAPHICS/Button 2.png";
const LABEL = process.argv[3] || "Button 2";
const OUT = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/" +
  "1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/btnwork";
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const { w, h } = probe(SRC);
const src = readRGBA(SRC);
const idx = (x, y) => (y * w + x) * 4;

/* ---- 1. the button itself, without its feathered drop shadow ---- */
const raw = alphaBBox(src, w, h, 240);
/* Square it around the centre: the bbox comes out slightly non-square (antialiasing on
   one side), and scaling a 804x812 crop to 1024x1024 would stretch the frame ~1%. */
const side = Math.max(raw.w, raw.h);
const cx = (raw.x0 + raw.x1) >> 1, cy = (raw.y0 + raw.y1) >> 1;
const btn = {
  x0: Math.max(0, Math.min(w - side, cx - (side >> 1))),
  y0: Math.max(0, Math.min(h - side, cy - (side >> 1))),
  w: Math.min(side, w), h: Math.min(side, h),
};
btn.x1 = btn.x0 + btn.w - 1; btn.y1 = btn.y0 + btn.h - 1;
console.log(`button (alpha>240): ${raw.w}x${raw.h} -> squared ${btn.w}x${btn.h} at (${btn.x0},${btn.y0})`);

/* ---- 2. flood-fill the interior from the centre, walled off by the bright border ---- */
const WALL_LUM = 165;            // the inner border reads ~190+, the teal interior well below
const inside = new Uint8Array(w * h);
{
  const cx = (btn.x0 + btn.x1) >> 1, cy = (btn.y0 + btn.y1) >> 1;
  const stack = [cx, cy];
  const seen = new Uint8Array(w * h);
  seen[cy * w + cx] = 1;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    const p = at(src, w, x, y);
    if (p[3] < 128 || lum(p) > WALL_LUM) continue;      // transparent or the border: stop
    inside[y * w + x] = 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (seen[ny * w + nx]) continue;
      seen[ny * w + nx] = 1;
      stack.push(nx, ny);
    }
  }
}
let n = 0; for (let i = 0; i < inside.length; i++) n += inside[i];
const ib = (() => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
})();
console.log(`interior: ${n} px (${(100 * n / (w * h)).toFixed(1)}% of canvas), ` +
  `bbox x ${ib.x0}..${ib.x1} y ${ib.y0}..${ib.y1} (${ib.w}x${ib.h})`);

/* ---- 3. FRAME: the artwork with the interior punched out ---- */
{
  const frame = Buffer.from(src);
  /* feather the cut by one pixel so the hole edge is not aliased against the bevel */
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside[y * w + x]) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (!inside[(y + dy) * w + (x + dx)]) edge = true;
    frame[idx(x, y) + 3] = edge ? 90 : 0;
  }
  writeRGBA(frame, w, h, `${OUT}/_frame-full.png`);
  execFileSync(`${FFDIR}/ffmpeg`, ["-v", "error", "-y", "-i", `${OUT}/_frame-full.png`,
    "-vf", `crop=${btn.w}:${btn.h}:${btn.x0}:${btn.y0},scale=1024:1024:flags=lanczos`,
    `${OUT}/frame.png`]);
  console.log(`frame  -> frame.png   (cropped to the button, scaled to 1024)`);
}

/* ---- 4. BACKGROUND: the largest square that lies wholly inside the interior ---- */
{
  let x0 = ib.x0, y0 = ib.y0, x1 = ib.x1, y1 = ib.y1;
  const allInside = () => {
    for (let x = x0; x <= x1; x += 2)
      if (!inside[y0 * w + x] || !inside[y1 * w + x]) return false;
    for (let y = y0; y <= y1; y += 2)
      if (!inside[y * w + x0] || !inside[y * w + x1]) return false;
    return true;
  };
  let guard = 0;
  while (!allInside() && guard++ < 600) { x0 += 2; x1 -= 2; y0 += 2; y1 -= 2; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  console.log(`background: inset ${guard * 2}px to clear the rounded corners -> ` +
    `${cw}x${ch} at (${x0},${y0})`);
  execFileSync(`${FFDIR}/ffmpeg`, ["-v", "error", "-y", "-i", SRC,
    "-vf", `crop=${cw}:${ch}:${x0}:${y0},scale=1024:1024:flags=lanczos`,
    `${OUT}/background.png`]);
  console.log(`background -> background.png (interior only, scaled to 1024)`);
}

/* ---- 4b. how far in the border reaches, as a fraction of the output ----
   This is the 9-slice value the overlay needs: border-image-slice as a percentage, and
   the border width as the same fraction of the cell. Measured, not assumed, so every
   frame carries its own thickness. */
{
  const k = 1024 / btn.w;
  const left = Math.round((ib.x0 - btn.x0) * k), right = Math.round((btn.x1 - ib.x1) * k);
  const top = Math.round((ib.y0 - btn.y0) * k), bot = Math.round((btn.y1 - ib.y1) * k);
  const sliceFrac = +(Math.min(left, right, top, bot) / 1024).toFixed(4);
  console.log(`slice: left ${left} right ${right} top ${top} bottom ${bot} of 1024 -> sliceFrac ${sliceFrac}`);
  writeFileSync(`${OUT}/meta.json`, JSON.stringify({ label: LABEL, sliceFrac }, null, 1));
}

/* ---- 5. a preview sheet: frame over a magenta card, and the background ---- */
execFileSync(`${FFDIR}/ffmpeg`, ["-v", "error", "-y",
  "-f", "lavfi", "-i", "color=c=#FF00AA:s=1024x1024",
  "-i", `${OUT}/frame.png`, "-i", `${OUT}/background.png`, "-i", `${OUT}/frame.png`,
  "-filter_complex",
  "[0][1]overlay[a];[2][3]overlay[b];[a]scale=300:300[l];[b]scale=300:300[r];[l][r]hstack",
  "-frames:v", "1", `${OUT}/preview.png`]);   // lavfi color is infinite without this
console.log(`preview -> preview.png  (left: frame over magenta — magenta = the hole; ` +
  `right: frame over its own extracted background)`);
