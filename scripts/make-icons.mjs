/* Prepare the three Stream Deck icon sets:
     normal  - the logo art from the old profile (what the deck looked like before)
     x       - the red-X version from the old profile (team removed)
     glow    - generated: the normal logo ringed in a bright volt halo (highlighted) */
import { readdirSync, mkdirSync, copyFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const BIN = "C:/Users/Brandon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const ICONS = "C:/ACBreakz-Cloud/streamdeck/icons";
const SRC_NORMAL = join(ICONS, "page0-state0");
const SRC_X      = join(ICONS, "page0-state1");
const OUT = { normal: join(ICONS, "normal"), x: join(ICONS, "x"), glow: join(ICONS, "glow") };

for (const d of Object.values(OUT)) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }

let n = 0, g = 0;
for (const f of readdirSync(SRC_NORMAL)) {
  if (!f.endsWith(".png")) continue;
  copyFileSync(join(SRC_NORMAL, f), join(OUT.normal, f));
  if (existsSync(join(SRC_X, f))) copyFileSync(join(SRC_X, f), join(OUT.x, f));
  n++;

  /* glow: shrink the logo and ring it in two tones of volt blue, then lift brightness */
  const r = spawnSync(BIN, ["-y", "-v", "error", "-i", join(SRC_NORMAL, f),
    "-vf", "scale=104:104,pad=124:124:10:10:color=0x9CD4FF,pad=144:144:10:10:color=0x35A7FF," +
           "eq=brightness=0.04:saturation=1.25",
    join(OUT.glow, f)]);
  if (r.status === 0) g++;
}
console.log(`normal: ${readdirSync(OUT.normal).length}  x: ${readdirSync(OUT.x).length}  glow: ${g}`);
