/* Cheap static checks for the two control pages and the overlay.

   Exists because a shell-mangled edit turned `$$("[data-part]")` into `$(...)` in BOTH
   panels — and since `$` is querySelector, `.forEach` threw inside render(), silently
   killing every piece of wiring that ran after it. Nothing in the browser suites caught
   it because they never clicked that button.

     node qa/lint-pages.mjs                                                             */
import { readFileSync } from "fs";

let fails = 0;
const bad = (f, line, msg) => { console.log(`FAIL  ${f}:${line}  ${msg}`); fails++; };
/* staging/ is where changes are written now, so it is where a syntax error would land first —
   and PC Test would be the rig that discovers it. Lint both copies. */
const FILES = ["control/index.html", "control/pc.html", "overlay/index.html",
               "staging/control/index.html", "staging/control/pc.html", "staging/overlay/index.html"];

for (const f of FILES) {
  const src = readFileSync(`C:/ACBreakz-Cloud/${f}`, "utf8");
  const lines = src.split(/\r?\n/);

  lines.forEach((l, i) => {
    /* querySelector returns ONE node; iterating it is always a mistake */
    if (/(^|[^$\w])\$\([^)]*\)\s*\.\s*(forEach|map|filter)\b/.test(l))
      bad(f, i + 1, "single-$ selector used as a list — did you mean $$ ?");
    /* the mirror image: querySelectorAll has no .value / .onclick */
    if (/\$\$\([^)]*\)\s*\.\s*(value|onclick|onchange|oninput|textContent)\s*=/.test(l))
      bad(f, i + 1, "$$ returns an array — assigning .value/.onclick to it does nothing");
  });

  /* every id referenced through $("#x") should exist in the markup of the same file */
  const ids = new Set([...src.matchAll(/\bid="([\w-]+)"/g)].map(m => m[1]));
  const refs = new Set([...src.matchAll(/\$\("#([\w-]+)"\)/g)].map(m => m[1]));
  for (const r of refs)
    if (!ids.has(r)) bad(f, 0, `$("#${r}") has no matching element in this file`);

  /* script blocks must parse */
  for (const m of src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    try { new Function(m[1]); } catch (e) { bad(f, 0, "script does not parse: " + e.message); }
  }
  console.log(`  checked ${f}  (${ids.size} ids, ${refs.size} lookups)`);
}
console.log(fails ? `\nDONE with ${fails} PROBLEM(S)` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
