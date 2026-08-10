/* Recover API Ninja's action UUID(s) from the plugin binary (its manifest is encrypted).
   .NET stores literals as UTF-16; scan for both encodings. */
import { readFileSync } from "fs";

const files = process.argv.slice(2);
const hits = new Set();
for (const f of files) {
  const buf = readFileSync(f);
  const ascii = buf.toString("latin1");
  for (const m of ascii.matchAll(/com\.barraider\.[A-Za-z0-9._-]+/g)) hits.add(m[0] + "   [ascii " + f.split(/[\\/]/).pop() + "]");
  const utf16 = buf.toString("utf16le");
  for (const m of utf16.matchAll(/com\.barraider\.[A-Za-z0-9._-]+/g)) hits.add(m[0] + "   [utf16 " + f.split(/[\\/]/).pop() + "]");
}
[...hits].sort().forEach(h => console.log(h));
