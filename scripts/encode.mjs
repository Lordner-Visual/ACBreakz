/* M3 asset prep — reads C:/ACBreakz OBS/Graphics (READ-ONLY), writes compressed
   copies to media-staging/. Originals are never modified. */
import { spawn } from "child_process";
import { copyFileSync, existsSync, statSync } from "fs";

const FF = "C:/Users/Brandon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const SRC = "C:/ACBreakz OBS/Graphics";
const OUT = "C:/ACBreakz-Cloud/media-staging";

export const TEAM_MAP = {
  "49ers":"sf", Bears:"chi", Bengals:"cin", Bills:"buf", Broncos:"den", Browns:"cle",
  Buccaneers:"tb", Cardinals:"ari", Chargers:"lac", Chiefs:"kc", Colts:"ind",
  Commanders:"wsh", Cowboys:"dal", Dolphins:"mia", Eagles:"phi", Falcons:"atl",
  Giants:"nyg", Jaguars:"jax", Jets:"nyj", Lions:"det", Packers:"gb", Panthers:"car",
  Patriots:"ne", Raiders:"lv", Rams:"lar", Ravens:"bal", Saints:"no", Seahawks:"sea",
  Steelers:"pit", Texans:"hou", Titans:"ten", Vikings:"min",
};

const jobs = [];
const ff = (args, label) => jobs.push({ args, label });

/* 32 team stingers: strip audio (default .wav sfx plays instead), VP9 CRF 34 */
for (const [name, abbr] of Object.entries(TEAM_MAP)) {
  const dst = `${OUT}/animations/${abbr}.webm`;
  if (existsSync(dst)) continue; // sea.webm done during calibration
  ff(["-y","-v","error","-i",`${SRC}/NFL Teams/Logos/NFL Team Logo Animation/${name}.webm`,
      "-an","-c:v","libvpx-vp9","-crf","34","-b:v","0","-deadline","good","-cpu-used","5",
      "-row-mt","1","-pix_fmt","yuv420p", dst], `stinger ${abbr}`);
}

/* game animations: keep their own audio */
ff(["-y","-v","error","-i",`${SRC}/Stash or Pass/ACBreakz - Stash or Pass.webm`,
    "-c:v","libvpx-vp9","-crf","33","-b:v","0","-deadline","good","-cpu-used","5",
    "-row-mt","1","-pix_fmt","yuv420p","-c:a","libopus","-b:a","96k",
    `${OUT}/games/stash-or-pass.webm`], "game stash-or-pass");
ff(["-y","-v","error","-i",`${SRC}/Spin 2 Pick 1/ACBreakz - Spin 2 Pick 1.webm`,
    "-c:v","libvpx-vp9","-crf","33","-b:v","0","-deadline","good","-cpu-used","5",
    "-row-mt","1","-pix_fmt","yuv420p","-c:a","libopus","-b:a","96k",
    `${OUT}/games/spin-2-pick-1.webm`], "game spin-2-pick-1");

/* TV background loop: center-crop to the 1080x480 band, silent */
ff(["-y","-v","error","-i",`${SRC}/TV Background/AC Breakz - TV Background.webm`,
    "-an","-vf","scale=1080:-2,crop=1080:480:0:(ih-480)/2",
    "-c:v","libvpx-vp9","-crf","38","-b:v","0","-deadline","good","-cpu-used","5",
    "-row-mt","1","-pix_fmt","yuv420p",
    `${OUT}/backgrounds/tv-background.webm`], "bg tv-background.webm");

/* background stills (1080x480) */
ff(["-y","-v","error","-i",`${SRC}/TV Background/AC Breakz - TV Background.png`,
    "-vf","scale=1080:-2,crop=1080:480:0:(ih-480)/2",
    `${OUT}/backgrounds/tv-glow.png`], "bg tv-glow.png");
ff(["-y","-v","error","-i",`${SRC}/Blank Scene/ACBreakz - Blank Scene.png`,
    "-vf","crop=1080:480:0:0",
    `${OUT}/backgrounds/stadium-lights.png`], "bg stadium-lights.png");
ff(["-y","-v","error","-i",`${SRC}/Old Scene/empty-american-football-field-night-stadium-lights-creating-dramatic-atmosphere-game-banner-empty-american-329623131.webp`,
    "-vf","scale=1080:-2,crop=1080:480:0:'max(0,(ih-480)/2)'",
    `${OUT}/backgrounds/football-field.png`], "bg football-field.png");

/* the four 1080x97 banner strips */
ff(["-y","-v","error","-i",`${SRC}/NFL Teams/Team Board/ACBreakz - NFL Teams Board - Banner.png`,
    "-vf","crop=1080:97:0:504", `${OUT}/banners/band-navy-steel.png`], "banner band-navy-steel");
ff(["-y","-v","error","-i",`${SRC}/Old Scene/nfl team/banner.png`,
    "-vf","crop=6580:591:0:241,scale=1080:97", `${OUT}/banners/nfl-mosaic.png`], "banner nfl-mosaic");
ff(["-y","-v","error","-i",`${SRC}/NFL Teams/Assets/Banner 1.png`,
    "-vf","crop=1024:92:0:466,scale=1080:97", `${OUT}/banners/gold-frame.png`], "banner gold-frame");
ff(["-y","-v","error","-i",`${SRC}/Blank Scene/ACBreakz - Blank Scene.png`,
    "-vf","crop=1080:97:0:60", `${OUT}/banners/stadium-strip.png`], "banner stadium-strip");

/* board logos: rename to <abbr>.png (copy only, originals untouched) */
const logoDir = `${SRC}/NFL Teams/Logos/Teams`;
const logoFile = (team) => {
  for (const cand of [team, team.toLowerCase()]) {
    if (existsSync(`${logoDir}/${cand}.png`)) return `${logoDir}/${cand}.png`;
  }
  throw new Error(`logo not found for ${team}`);
};
for (const [team, abbr] of Object.entries(TEAM_MAP))
  copyFileSync(logoFile(team), `${OUT}/logos/${abbr}.png`);
console.log("logos copied: 32");

/* run ffmpeg jobs, 4 at a time */
let active = 0, i = 0, failed = 0;
await new Promise((resolve) => {
  const pump = () => {
    if (i >= jobs.length && active === 0) return resolve();
    while (active < 4 && i < jobs.length) {
      const job = jobs[i++]; active++;
      const t0 = Date.now();
      const p = spawn(FF, job.args, { stdio: ["ignore", "inherit", "inherit"] });
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
