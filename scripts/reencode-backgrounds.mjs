/* Re-encode the streamer backgrounds at the resolution the overlay actually renders.

   The background band is 1080x480 (`GEOM.BG` in overlay/config.js; `#bgFrame` is
   width:1080px height:480px overflow:hidden, and the video is object-fit:cover). Every
   file in background/ is 1920x1080 or larger, so three-quarters or more of every byte is
   discarded before it reaches the screen — which is exactly why shrinking these files
   looked bad: the bitrate was being spread over pixels that get thrown away.

   Target: scale so the frame still COVERS 1080x480 with nothing upscaled, keeping the
   full frame so the Reframe pan (object-position) still has something to pan over.
   Drop audio — the bg layer never plays sound, only layer=fx does.

   VP9 alpha is side-channel: ffprobe reports yuv420p even when alpha is present, so
   detect it from the container's alpha_mode tag and re-encode with yuva420p +
   -auto-alt-ref 0, decoding with -c:v libvpx-vp9 as an INPUT option. Getting this wrong
   silently produces a black background.

     node scripts/reencode-backgrounds.mjs            # download, probe, encode, report
     node scripts/reencode-backgrounds.mjs --probe    # probe only, no encoding          */
import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { globSync } from "fs";

const SCRATCH = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/" +
  "1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/bgwork";
const IN = `${SCRATCH}/orig`, OUT = `${SCRATCH}/new`;
for (const d of [SCRATCH, IN, OUT]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" };

const FFDIR = (() => {
  const base = process.env.LOCALAPPDATA + "/Microsoft/WinGet/Packages";
  for (const p of globSync(`${base.replace(/\\/g, "/")}/Gyan.FFmpeg_*/ffmpeg-*-full_build/bin`))
    return p.replace(/\\/g, "/");
  throw new Error("ffmpeg not found");
})();
const ffprobe = (args) => execFileSync(`${FFDIR}/ffprobe`, args, { encoding: "utf8" }).trim();
const ffmpeg = (args) => execFileSync(`${FFDIR}/ffmpeg`, args, { stdio: ["ignore", "ignore", "pipe"] });
const MB = (n) => (n / 1048576).toFixed(2);

/* ---- what is in background/ ---- */
const objects = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/media`, {
  method: "POST", headers: H, body: JSON.stringify({ prefix: "background", limit: 1000 }) })
  .then(r => r.json());
const files = objects.filter(o => o.id).sort((a, b) => (b.metadata?.size || 0) - (a.metadata?.size || 0));

console.log(`background/ holds ${files.length} objects\n`);
const report = [];

for (const o of files) {
  const local = `${IN}/${o.name}`;
  if (!existsSync(local)) {
    const url = `${env.SUPABASE_URL}/storage/v1/object/public/media/background/` +
      encodeURIComponent(o.name);
    const buf = Buffer.from(await fetch(url).then(r => r.arrayBuffer()));
    writeFileSync(local, buf);
  }
  const isVideo = /\.(webm|mp4)$/i.test(o.name);
  const probe = (entries) => ffprobe(["-v", "error", "-select_streams", "v:0",
    "-show_entries", entries, "-of", "default=noprint_wrappers=1:nokey=1", local]).split("\n");

  if (!isVideo) {
    const [w, h] = probe("stream=width,height");
    report.push({ name: o.name, kind: "image", w: +w, h: +h,
      alpha: false, dur: 0, before: statSync(local).size });
    continue;
  }
  const [w, h] = probe("stream=width,height");
  const dur = Number(ffprobe(["-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", local]));
  /* alpha_mode lives on the container, not the pixel format */
  const alpha = ffprobe(["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream_tags=alpha_mode", "-of", "default=noprint_wrappers=1:nokey=1", local]) === "1";
  report.push({ name: o.name, kind: "video", w: +w, h: +h, alpha, dur,
    before: statSync(local).size });
}

console.log("=== current files, against the 1080x480 band they render into ===");
for (const r of report) {
  const shown = r.kind === "image" ? 1080 * 480 : 1080 * 480;
  const waste = ((r.w * r.h) / shown).toFixed(1);
  console.log(`  ${MB(r.before).padStart(7)} MB  ${String(r.w) + "x" + String(r.h)}`.padEnd(28) +
    `${r.alpha ? " ALPHA" : "      "}  ${waste}x the displayed pixels   ${r.name}`);
}
if (process.argv.includes("--probe")) process.exit(0);

/* ---- re-encode ---- */
const CRF = 20;
console.log(`\n=== re-encoding at native geometry (VP9 crf ${CRF}, no audio) ===`);
for (const r of report) {
  const src = `${IN}/${r.name}`;
  if (r.kind === "image") {
    /* a still background only ever fills 1080x480; keep PNG so nothing else changes */
    const dst = `${OUT}/${r.name}`;
    ffmpeg(["-v", "error", "-y", "-i", src,
      "-vf", "scale=1080:480:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos",
      dst]);
    r.after = statSync(dst).size; r.out = r.name;
    console.log(`  ${MB(r.before).padStart(7)} -> ${MB(r.after).padStart(7)} MB   ${r.name}`);
    continue;
  }
  const outName = r.name.replace(/\.(webm|mp4)$/i, ".webm");
  const dst = `${OUT}/${outName}`;
  const args = ["-v", "error", "-y"];
  if (/\.webm$/i.test(r.name)) args.push("-c:v", "libvpx-vp9");   // INPUT opt: decode alpha
  args.push("-i", src,
    "-vf", "scale=1080:480:force_original_aspect_ratio=increase:force_divisible_by=2:flags=lanczos",
    "-c:v", "libvpx-vp9", "-crf", String(CRF), "-b:v", "0",
    "-row-mt", "1", "-cpu-used", "3", "-an");
  if (r.alpha) args.push("-pix_fmt", "yuva420p", "-auto-alt-ref", "0");
  else args.push("-pix_fmt", "yuv420p");
  args.push(dst);
  process.stdout.write(`  encoding ${r.name} …`);
  ffmpeg(args);
  r.after = statSync(dst).size; r.out = outName;
  console.log(`\r  ${MB(r.before).padStart(7)} -> ${MB(r.after).padStart(7)} MB   ` +
    `${r.alpha ? "(alpha kept) " : ""}${r.name}`);
}

const before = report.reduce((s, r) => s + r.before, 0);
const after = report.reduce((s, r) => s + (r.after ?? r.before), 0);
console.log(`\n  TOTAL  ${MB(before)} MB -> ${MB(after)} MB  ` +
  `(${Math.round(100 - 100 * after / before)}% smaller)`);
console.log(`  over the ~13 MB browser cache cliff, before: ` +
  `${report.filter(r => r.before > 13 * 1048576).length}, after: ` +
  `${report.filter(r => (r.after ?? r.before) > 13 * 1048576).length}`);
writeFileSync(`${SCRATCH}/report.json`, JSON.stringify(report, null, 1));
console.log(`\n  encoded files in ${OUT}`);
console.log("  nothing uploaded — review, then run scripts/publish-backgrounds.mjs");
