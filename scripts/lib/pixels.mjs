/* Tiny raw-RGBA helpers built on ffmpeg, so image work needs no native image deps. */
import { execFileSync } from "child_process";
import { globSync } from "fs";

export const FFDIR = (() => {
  const base = (process.env.LOCALAPPDATA + "/Microsoft/WinGet/Packages").replace(/\\/g, "/");
  const hit = globSync(`${base}/Gyan.FFmpeg_*/ffmpeg-*-full_build/bin`)[0];
  if (!hit) throw new Error("ffmpeg not found");
  return hit.replace(/\\/g, "/");
})();

export const probe = (file) => {
  const out = execFileSync(`${FFDIR}/ffprobe`, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,pix_fmt", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" }).trim().split("\n");
  return { w: +out[0], h: +out[1], pix: out[2] };
};

/** Decode any image to a flat RGBA buffer. */
export const readRGBA = (file, w, h) => {
  const args = ["-v", "error", "-i", file];
  if (w && h) args.push("-vf", `scale=${w}:${h}:flags=lanczos`);
  args.push("-f", "rawvideo", "-pix_fmt", "rgba", "-");
  return execFileSync(`${FFDIR}/ffmpeg`, args, { maxBuffer: 1 << 30 });
};

/** Write a flat RGBA buffer back out as a PNG. */
export const writeRGBA = (buf, w, h, file) => {
  execFileSync(`${FFDIR}/ffmpeg`, ["-v", "error", "-y",
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${w}x${h}`, "-i", "pipe:0",
    "-frames:v", "1", file], { input: buf, maxBuffer: 1 << 30 });
};

export const at = (buf, w, x, y) => {
  const i = (y * w + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
};
export const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Tightest box containing every pixel with alpha above the threshold. */
export const alphaBBox = (buf, w, h, min = 8) => {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (buf[(y * w + x) * 4 + 3] > min) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
