/* Each PC runs THREE browser sources. Showing a layer is only `display:none`, so without
   explicit gates every source downloads every asset — measured at 14.4 MB of wasted
   background per source per load, on every reload, forever (the background is just over
   the browser's cache-size cliff, so it never caches).

   MEASUREMENT NOTE, the whole reason this file exists: `page.on("response")` reports the
   full content-length for CACHE HITS too. Measuring that way says a primed reload costs
   32 MB when it really costs zero, and it produced a wrong "384 MB per reload" figure
   during the investigation. Only CDP `Network.loadingFinished.encodedDataLength` is
   actual bytes on the wire.

     node qa/shoot-egress.mjs                                                          */
import { chromium } from "playwright";
import { rmSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz/overlay/";
const PC = Number(process.argv[2]) || 1;
const DIR = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/egress-qa";

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const MB = (n) => (n / 1048576).toFixed(1);

/* one cold profile per layer, so each number is a true first-load cost */
const measure = async (layer, settleMs = 45000) => {
  try { rmSync(DIR, { recursive: true, force: true }); } catch {}
  const ctx = await chromium.launchPersistentContext(DIR, {
    args: ["--autoplay-policy=no-user-gesture-required"], viewport: { width: 1080, height: 1920 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  const urlOf = new Map();
  const byFolder = new Map();
  let wire = 0;
  cdp.on("Network.requestWillBeSent", e => urlOf.set(e.requestId, e.request.url));
  cdp.on("Network.loadingFinished", e => {
    const u = urlOf.get(e.requestId) || "";
    if (!/supabase\.co\/storage/.test(u)) return;
    const n = Number(e.encodedDataLength || 0);
    wire += n;
    const path = decodeURIComponent(u.split("/media/")[1] || "");
    const folder = path.split("/")[0] || "?";
    byFolder.set(folder, (byFolder.get(folder) || 0) + n);
  });

  const pass = async () => {
    wire = 0; byFolder.clear();
    await page.goto(`${HOSTED}?layer=${layer}&pc=${PC}`, { waitUntil: "networkidle" });
    let last = -1;
    for (let i = 0; i < settleMs / 2000; i++) {
      await page.waitForTimeout(2000);
      if (wire === last) break;
      last = wire;
    }
    return { wire, folders: new Map(byFolder) };
  };
  const cold = await pass();
  const reload = await pass();
  await ctx.close();
  return { cold, reload };
};

console.log(`=== per-source egress, PC${PC} ===`);
const r = {};
for (const layer of ["bg", "hud", "fx"]) {
  r[layer] = await measure(layer);
  const f = [...r[layer].cold.folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k} ${MB(v)}`).join(", ");
  console.log(`  layer=${layer.padEnd(4)} cold ${MB(r[layer].cold.wire).padStart(7)} MB   ` +
              `reload ${MB(r[layer].reload.wire).padStart(6)} MB   [${f}]`);
}

const bgBytes = (m) => m.folders.get("background") || 0;

console.log("");
ok(`the HUD source pulls NO background (${MB(bgBytes(r.hud.cold))} MB)`,
  bgBytes(r.hud.cold) === 0);
ok(`the FX source pulls NO background (${MB(bgBytes(r.fx.cold))} MB)`,
  bgBytes(r.fx.cold) === 0);
/* guard against over-gating: the source that DOES show the background must still load it */
ok(`the BG source still loads its background (${MB(bgBytes(r.bg.cold))} MB)`,
  bgBytes(r.bg.cold) > 1048576);
/* the FX warm is the one genuinely large cold cost, and it must still happen */
ok(`the FX source still warms its clip set (${MB(r.fx.cold.wire)} MB cold)`,
  r.fx.cold.wire > 100 * 1048576);

const perPcReload = r.bg.reload.wire + r.hud.reload.wire + r.fx.reload.wire;
console.log(`\n  per-PC reload total: ${MB(perPcReload)} MB (was ~43 MB before gating)`);
ok(`a reload across all three sources stays under 20 MB (${MB(perPcReload)} MB)`,
  perPcReload < 20 * 1048576);

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
