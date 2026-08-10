/* Measure the ORIGINAL team board geometry from the source art so the cloud board
   can match it exactly: content bounds, tile size, gaps, rows. */
import { execFileSync } from "child_process";

const BIN = "C:/Users/Brandon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin";
const SRC = "C:/ACBreakz OBS/Graphics/NFL Teams/Team Board/ACBreakz - NFL Teams Board - Empty Logos.png";
const W = 1080, H = 1920;

/* dump the alpha plane as raw gray8 and find where tiles actually are */
const raw = execFileSync(`${BIN}/ffmpeg.exe`,
  ["-v","error","-i",SRC,"-vf","alphaextract","-f","rawvideo","-pix_fmt","gray","-"],
  { maxBuffer: 1 << 28 });

const at = (x, y) => raw[y * W + x];
const T = Number(process.argv[2] ?? 40);   // alpha threshold
const colHas = (x) => { for (let y = 0; y < H; y++) if (at(x, y) > T) return true; return false; };
const rowHas = (y) => { for (let x = 0; x < W; x++) if (at(x, y) > T) return true; return false; };

/* runs of occupied columns / rows */
const runs = (n, has) => {
  const out = []; let s = null;
  for (let i = 0; i < n; i++) {
    if (has(i)) { if (s === null) s = i; }
    else if (s !== null) { out.push([s, i - 1]); s = null; }
  }
  if (s !== null) out.push([s, n - 1]);
  return out;
};

const cols = runs(W, colHas);
const rows = runs(H, rowHas);
console.log("column runs (tile columns):", cols.length);
console.log("  first:", cols[0], " last:", cols[cols.length - 1]);
console.log("  content spans x", cols[0][0], "->", cols[cols.length - 1][1],
            `(width ${cols[cols.length-1][1] - cols[0][0] + 1})`);
console.log("  left margin", cols[0][0], " right margin", W - 1 - cols[cols.length - 1][1]);
const colW = cols.map(([a, b]) => b - a + 1);
const colGaps = cols.slice(1).map(([a], i) => a - cols[i][1] - 1);
console.log("  tile widths:", [...new Set(colW)].join(","), " gaps:", [...new Set(colGaps)].join(","));

console.log("row runs (tile rows):", rows.length);
rows.forEach(([a, b]) => console.log(`  y ${a}..${b}  height ${b - a + 1}`));
const rowGaps = rows.slice(1).map(([a], i) => a - rows[i][1] - 1);
console.log("  row gaps:", rowGaps.join(","));

const tw = colW[0], th = rows[0][1] - rows[0][0] + 1;
console.log(`\nTILE ${tw} x ${th}  (aspect ${(tw/th).toFixed(3)})`);
console.log(`BAND y ${rows[0][0]} -> ${rows[rows.length-1][1]}  height ${rows[rows.length-1][1]-rows[0][0]+1}`);
