/* Dump candidate JSON property names from the API Ninja DLL so the profile's
   Settings block uses the plugin's REAL keys (its manifest is encrypted). */
import { readFileSync } from "fs";

const buf = readFileSync(process.argv[2]);
const want = process.argv.slice(3);

/* .NET metadata strings are UTF-8 in the #Strings heap; user literals are UTF-16 */
const grab = (s) => {
  const out = new Set();
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_]{1,40}/g)) out.add(m[0]);
  return out;
};
const ascii = grab(buf.toString("latin1"));
const utf16 = grab(buf.toString("utf16le"));
const all = new Set([...ascii, ...utf16]);

console.log("— do the keys I used exist in the binary? —");
for (const k of want) console.log(`   ${all.has(k) ? "YES" : "no "}  ${k}`);

console.log("\n— url/request-ish strings present —");
[...all].filter(s => /^(url|uri|request|method|verb|body|payload|data|header|content)/i.test(s))
  .sort().slice(0, 40).forEach(s => console.log("   " + s));
