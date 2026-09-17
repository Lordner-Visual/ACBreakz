/* Status tab: when is an OFFLINE PC a problem?

   Reported 2026-09-17: PC Test showed "nothing is running in OBS, but it had a press 11m ago" after
   the streamer had simply finished and closed OBS. Offline is normal; it is a failure only when the
   deck was pressed AFTER the overlays went away, which needs a sighting of the sources shortly
   before the press. Drives the real evaluate() through window.__acbzStatus on a pc no source uses.

     node qa/shoot-status-offline.mjs [base]      base defaults to the deployed site root */
import { readFileSync } from "fs"; import { chromium } from "playwright";
const BASE = (process.argv[2] || "https://lordner-visual.github.io/ACBreakz/").replace(/\/?$/, "/");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#")).map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
await p.goto(`${BASE}dev/control/`, { waitUntil: "load" });
if (await p.isVisible("#lock.on")) { await p.fill("#lockPw", env.PANEL_PASSWORD); await p.click("#lockGo");
  await p.waitForFunction(() => !document.querySelector("#lock").classList.contains("on"), null, { timeout: 15000 }); }
await p.waitForFunction(() => window.__acbzStatus, null, { timeout: 15000 });
await p.waitForTimeout(6000);
const r = await p.evaluate(() => {
  const S = window.__acbzStatus._S, ev = (pc) => window.__acbzStatus.evaluate(pc);
  const PC = 99;                                   // a pc no source reports as, so it is always offline
  const now = Date.now(), out = {};
  const probe = (label, seen, pressAgo) => {
    S.seenOnline[PC] = seen; S.act[PC] = pressAgo == null ? undefined : { at: now - pressAgo, how: "Stream Deck" };
    const e = ev(PC); out[label] = { live: e.live, sev: e.sev, probs: e.probs.map(p => p.text) };
  };
  probe("pressed, then the stream ended and OBS closed (the PC Test report)", now - 2 * 60e3, 11 * 60e3);
  probe("pressed 3 min AFTER the overlays were last seen", now - 8 * 60e3, 5 * 60e3);
  probe("sighting is days old (panel was closed during the show)", now - 2 * 86400e3, 5 * 60e3);
  probe("never seen in this browser", 0, 1 * 60e3);
  probe("press long ago", now - 60 * 60e3, 40 * 60e3);
  delete S.seenOnline[PC]; delete S.act[PC];
  return out;
});
const expect = { "pressed, then the stream ended and OBS closed (the PC Test report)": "off", "pressed 3 min AFTER the overlays were last seen": "fail",
  "sighting is days old (panel was closed during the show)": "off", "never seen in this browser": "off", "press long ago": "off" };
let bad = 0;
for (const [k, v] of Object.entries(r)) { const pass = v.sev === expect[k]; if (!pass) bad++; console.log(`${pass ? "PASS" : "FAIL"}  ${k}: ${v.sev}${v.probs.length ? " — " + v.probs[0] : ""}`); }
console.log("page errors:", errs.length ? errs : "none"); await b.close(); process.exit(bad ? 1 : 0);
