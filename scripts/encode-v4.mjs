/* V4: tight-crop the boxed one-shot animations to their visible content so they
   fill the 667x413 animation box, and keep the alpha + end fade. Originals untouched. */
import { spawn, execFileSync } from "child_process";
import { existsSync, statSync, mkdirSync } from "fs";

const BIN = "C:/Users/Brandon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin";
const SRC = "C:/ACBreakz OBS/Graphics";
const OUT = "C:/ACBreakz-Cloud/media-staging/v4";
mkdirSync(OUT, { recursive: true });

const dur = (f) => parseFloat(execFileSync(`${BIN}/ffprobe.exe`,
  ["-v","error","-c:v","libvpx-vp9","-show_entries","format=duration","-of","csv=p=0", f]).toString());

/* content bounds measured with cropdetect on the alpha plane */
const JOBS = [
  { name: "spin-2-pick-1", src: `${SRC}/Spin 2 Pick 1/ACBreakz - Spin 2 Pick 1.webm`,
    crop: "974:980:54:470" },
  { name: "stash-or-pass", src: `${SRC}/Stash or Pass/ACBreakz - Stash or Pass.webm`,
    crop: "776:816:152:552" },
];

let failed = 0;
for (const j of JOBS) {
  const d = dur(j.src);
  const out = `${OUT}/${j.name}.webm`;
  const args = ["-y","-v","error","-c:v","libvpx-vp9","-i", j.src,
    /* crop to content, pad a touch so glows aren't clipped, fade alpha at the tail */
    "-vf", `crop=${j.crop},pad=iw*1.06:ih*1.06:(ow-iw)/2:(oh-ih)/2:color=#00000000,` +
           `fade=t=out:st=${(d-0.5).toFixed(2)}:d=0.4:alpha=1`,
    "-c:v","libvpx-vp9","-crf","33","-b:v","0","-deadline","good","-cpu-used","5",
    "-row-mt","1","-pix_fmt","yuva420p","-auto-alt-ref","0",
    "-c:a","libopus","-b:a","96k", out];
  const t0 = Date.now();
  const code = await new Promise((r) =>
    spawn(`${BIN}/ffmpeg.exe`, args, { stdio: ["ignore","inherit","inherit"] }).on("exit", r));
  const mb = existsSync(out) ? (statSync(out).size / 1048576).toFixed(2) : "?";
  console.log(`${code === 0 ? "ok " : "FAIL"} ${j.name}  ${mb} MB  ${((Date.now()-t0)/1000).toFixed(1)}s`);
  if (code !== 0) failed++;
}

/* poster frame for the Classic Stingers folder card (one frame from a team video) */
const poster = `${OUT}/classic-stingers-poster.png`;
const pc = await new Promise((r) => spawn(`${BIN}/ffmpeg.exe`,
  ["-y","-v","error","-c:v","libvpx-vp9","-ss","1.4","-i",
   "C:/ACBreakz-Cloud/media-staging/v2/sea.webm","-frames:v","1", poster],
  { stdio: ["ignore","inherit","inherit"] }).on("exit", r));
console.log(`${pc === 0 ? "ok " : "FAIL"} classic-stingers poster`);
console.log(failed ? `DONE with ${failed} FAILURES` : "DONE all ok");
