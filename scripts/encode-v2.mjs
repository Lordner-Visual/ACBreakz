/* V2 re-encode: preserve the VP9 side-channel ALPHA (libvpx decoder) and add an
   alpha fade-out at the end. Originals remain untouched. */
import { spawn, execFileSync } from "child_process";
import { existsSync, statSync, mkdirSync } from "fs";

const BIN = "C:/Users/Brandon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin";
const SRC = "C:/ACBreakz OBS/Graphics";
const OUT = "C:/ACBreakz-Cloud/media-staging/v2";
mkdirSync(OUT, { recursive: true });

const TEAM_MAP = { "49ers":"sf", Bears:"chi", Bengals:"cin", Bills:"buf", Broncos:"den",
  Browns:"cle", Buccaneers:"tb", Cardinals:"ari", Chargers:"lac", Chiefs:"kc", Colts:"ind",
  Commanders:"wsh", Cowboys:"dal", Dolphins:"mia", Eagles:"phi", Falcons:"atl", Giants:"nyg",
  Jaguars:"jax", Jets:"nyj", Lions:"det", Packers:"gb", Panthers:"car", Patriots:"ne",
  Raiders:"lv", Rams:"lar", Ravens:"bal", Saints:"no", Seahawks:"sea", Steelers:"pit",
  Texans:"hou", Titans:"ten", Vikings:"min" };

const dur = (f) => parseFloat(execFileSync(`${BIN}/ffprobe.exe`,
  ["-v","error","-show_entries","format=duration","-of","csv=p=0", f]).toString());

const jobs = [];
const alphaArgs = (input, fadeStart, out, extra = []) => ([
  "-y","-v","error","-c:v","libvpx-vp9","-i",input,
  "-vf",`fade=t=out:st=${fadeStart.toFixed(2)}:d=0.4:alpha=1`,
  "-c:v","libvpx-vp9","-crf","34","-b:v","0","-deadline","good","-cpu-used","5",
  "-row-mt","1","-pix_fmt","yuva420p","-auto-alt-ref","0", ...extra, out]);

for (const [name, abbr] of Object.entries(TEAM_MAP)) {
  const input = `${SRC}/NFL Teams/Logos/NFL Team Logo Animation/${name}.webm`;
  jobs.push({ label:`stinger ${abbr}`,
    args: alphaArgs(input, dur(input) - 0.45, `${OUT}/${abbr}.webm`, ["-an"]) });
}
const stash = `${SRC}/Stash or Pass/ACBreakz - Stash or Pass.webm`;
jobs.push({ label:"stash-or-pass", args: alphaArgs(stash, dur(stash) - 0.5,
  `${OUT}/stash-or-pass.webm`, ["-c:a","libopus","-b:a","96k"]) });
const spin = `${SRC}/Spin 2 Pick 1/ACBreakz - Spin 2 Pick 1.webm`;
jobs.push({ label:"spin-2-pick-1", args: alphaArgs(spin, dur(spin) - 0.5,
  `${OUT}/spin-2-pick-1.webm`, ["-c:a","libopus","-b:a","96k"]) });

let active = 0, i = 0, failed = 0;
await new Promise((resolve) => {
  const pump = () => {
    if (i >= jobs.length && active === 0) return resolve();
    while (active < 4 && i < jobs.length) {
      const job = jobs[i++]; active++;
      const t0 = Date.now();
      const p = spawn(`${BIN}/ffmpeg.exe`, job.args, { stdio: ["ignore","inherit","inherit"] });
      p.on("exit", (code) => {
        active--;
        const out = job.args[job.args.length - 1];
        const mb = existsSync(out) ? (statSync(out).size / 1048576).toFixed(2) : "?";
        console.log(`${code === 0 ? "ok " : "FAIL"} ${job.label}  ${mb} MB  ${((Date.now()-t0)/1000).toFixed(1)}s`);
        if (code !== 0) failed++;
        pump();
      });
    }
  };
  pump();
});
console.log(failed ? `DONE with ${failed} FAILURES` : "DONE all ok");
