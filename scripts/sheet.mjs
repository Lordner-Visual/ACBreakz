/* Contact sheet of icon files: node sheet.mjs <out.png> <file...> */
import { spawnSync } from "child_process";
const BIN = "C:/Users/Brandon/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0-full_build/bin/ffmpeg.exe";
const [out, ...files] = process.argv.slice(2);
const args = ["-y", "-v", "error"];
files.forEach(f => args.push("-i", f));
const chains = files.map((_, i) => `[${i}:v]scale=140:140,pad=150:172:5:5:color=0x202020[v${i}]`);
const stack = files.map((_, i) => `[v${i}]`).join("") + `hstack=${files.length}`;
args.push("-filter_complex", chains.join(";") + ";" + stack, "-frames:v", "1", out);
const r = spawnSync(BIN, args, { encoding: "utf8" });
console.log(r.status === 0 ? "ok " + out : "FAIL\n" + r.stderr.slice(0, 400));
