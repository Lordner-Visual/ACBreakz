/* API Ninja rewrites an action's settings once it loads it. Those rewritten blobs are
   the plugin's OWN canonical shape — dump the distinct ones from installed profiles. */
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.env.APPDATA, "Elgato", "StreamDeck", "ProfilesV3");
const shapes = new Map();   // key-count -> { count, sample }

(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { return; }
      const visit = (a) => {
        if (!a || typeof a !== "object") return;
        if (a.UUID === "com.barraider.apininja") {
          const keys = Object.keys(a.Settings ?? {}).sort();
          const sig = keys.join(",");
          if (!shapes.has(sig)) shapes.set(sig, { count: 0, sample: a.Settings, keys });
          shapes.get(sig).count++;
        }
        const k = a.Actions;
        if (Array.isArray(k)) k.forEach(visit);
        else if (k && typeof k === "object") Object.values(k).forEach(visit);
      };
      (j.Controllers ?? []).forEach(c => Object.values(c.Actions ?? {}).forEach(visit));
    }
  }
})(ROOT);

const mine = ["url","urlFile","requestType","contentType","data","dataFile","headers","headersFile",
  "loadFromFiles","loadURLFromFiles","parseResponse","responseFormat","responseRegex",
  "responseRegexFetch","responseShown","responseShownFile","saveResponseToFile","showCustomImages",
  "customImageValue","matchedImage","unmatchedImage","treatResponseAsImage","treatResponseAsText",
  "responseImageField","titlePrefix","titleSuffix","autorunType","autorunMinutes","debugLogging",
  "hideSuccessIndicator"].sort();

for (const [sig, v] of [...shapes].sort((a, b) => a[1].keys.length - b[1].keys.length)) {
  console.log(`\n=== ${v.keys.length} keys, used by ${v.count} actions ===`);
  console.log(JSON.stringify(v.sample, null, 1).slice(0, 900));
  const missing = v.keys.filter(k => !mine.includes(k));
  const extra = mine.filter(k => !v.keys.includes(k));
  if (missing.length) console.log(`   keys the plugin has that I DON'T send: ${missing.join(", ")}`);
  if (extra.length && v.keys.length > 20) console.log(`   keys I send that it dropped: ${extra.join(", ")}`);
}
