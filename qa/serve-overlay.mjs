/* Offline harness for the crop suites.

   Serves overlay/ on :8777 with SUPABASE_URL blanked out, which puts the overlay on its
   BroadcastChannel path ("acbz-bus") instead of realtime — so shoot-fx-crop.mjs and
   shoot-board-crop.mjs can push whole states and events without touching production.
   Also serves qa/fixtures/{clip.webm,still.png} at the root, which those suites load.

     node qa/serve-overlay.mjs &
     node qa/shoot-fx-crop.mjs
     node qa/shoot-board-crop.mjs                                                     */
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, resolve } from "path";

const ROOT = "C:/ACBreakz-Cloud/overlay";
const FIX = "C:/ACBreakz-Cloud/qa/fixtures";
const PORT = Number(process.argv[2]) || 8777;
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".png": "image/png", ".webm": "video/webm", ".mp4": "video/mp4", ".json": "application/json",
  ".webp": "image/webp", ".wav": "audio/wav", ".svg": "image/svg+xml" };

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const name = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const send = (body, type) => {
    res.writeHead(200, { "content-type": type, "cache-control": "no-store",
      "access-control-allow-origin": "*" });
    res.end(body);
  };

  /* config.js with the cloud switched off — this is what selects the test bus */
  if (name === "config.js") {
    const src = readFileSync(join(ROOT, "config.js"), "utf8")
      .replace(/SUPABASE_URL:\s*"[^"]*"/, 'SUPABASE_URL: ""');
    return send(src, TYPES[".js"]);
  }

  for (const dir of [ROOT, FIX]) {
    const base = resolve(dir), f = resolve(dir, name);   // resolve both: join() gives \ on Windows
    if (f.startsWith(base) && existsSync(f)) {
      try { return send(readFileSync(f), TYPES[extname(f).toLowerCase()] || "application/octet-stream"); }
      catch { /* a directory — fall through to 404 */ }
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not here: " + name);
}).listen(PORT, () => console.log(`overlay harness on http://localhost:${PORT} (cloud off)`));
