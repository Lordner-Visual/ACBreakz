/* The realtime rebuild must SETTLE after a socket drop, not loop forever.

   Found in the platform logs, 2026-09-16: every live PC was making 8,000-13,000 full
   stream_state reads an hour, all day, including overnight with nobody streaming — about
   1.2 million a day against an expected ~1,500. The subscribe status handler reacted to
   CLOSED by scheduling a rebuild, and a rebuild calls removeChannel() on the old channel,
   which fires that old channel's handler with CLOSED — so every rebuild scheduled the next
   one, ~once a second per source, until OBS reloaded the page. The channel spent its life
   leaving and re-joining, so postgres_changes events (stingers and their sound) were
   mostly missed while the state row, re-read on every join, kept the board looking fine.
   That is "the FX source stops working every day and a cache reset fixes it".

   This drives the real page against the real project as PC Test (row 6, staging), drops
   the websocket the way a network blip would, and counts what follows.

     node qa/shoot-rebuild-loop.mjs [url]                                                   */
import { chromium } from "playwright";

const URL = process.argv[2] ||
  "https://lordner-visual.github.io/ACBreakz/staging/overlay/?layer=fx&pc=6";
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
/* only the counters matter here — do not pay for the FX warm's clip bodies */
await page.route(/\/storage\/v1\/object\/.*\.(webm|mp4|mp3|wav|ogg)(\?|$)/i, r => r.abort());
let reads = 0, rebuilds = 0;
page.on("request", (r) => { if (/stream_state\?select=data&/.test(r.url())) reads++; });
const T0 = Date.now();
page.on("console", (m) => { const t = m.text(); if (t.includes("[acbz]") && !t.includes("warming")) console.log(`    ${((Date.now() - T0) / 1000).toFixed(1)}s  ${t.slice(0, 140)}`);
  if (/rebuilding|resubscribing/.test(t)) rebuilds++; });

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__acbzDiag && window.__acbzDiag().db === "joined",
  null, { timeout: 30000 });
await sleep(20000);
const base = reads;
console.log(`  steady state: ${base} full read(s) in the first ~20s`);
ok("a healthy page does not re-read the row on its own", base <= 3);

/* a network blip: kill the socket underneath the client, let it reconnect itself */
reads = 0; rebuilds = 0;
await page.evaluate(() => window.__sb.realtime.socketAdapter.socket.conn.close());
await sleep(15000);
const afterDrop = reads;
await page.waitForFunction(() => window.__acbzDiag().db === "joined", null, { timeout: 60000 })
  .catch(() => {});
reads = 0; rebuilds = 0;
await sleep(45000);
const settled = reads, settledRebuilds = rebuilds;
const diag = await page.evaluate(() => window.__acbzDiag());
console.log(`  after the drop: ${afterDrop} read(s) in 15s, then ${settled} read(s) and ` +
            `${settledRebuilds} rebuild message(s) over the next 45s; db=${diag.db}`);
ok("recovers: the data channel is joined again", diag.db === "joined");
ok("settles: no more than 3 full reads in the 45s after recovery", settled <= 3);
ok("settles: no rebuild churn after recovery", settledRebuilds === 0);

/* a SECOND drop must behave the same — the first rebuild must not leave a stale handler */
reads = 0; rebuilds = 0;
await page.evaluate(() => window.__sb.realtime.socketAdapter.socket.conn.close());
await sleep(15000);
reads = 0; rebuilds = 0;
await sleep(45000);
const diag2 = await page.evaluate(() => window.__acbzDiag());
console.log(`  second drop: ${reads} read(s), ${rebuilds} rebuild message(s) in 45s; db=${diag2.db}`);
ok("second drop also settles", reads <= 3 && rebuilds === 0 && diag2.db === "joined");

await browser.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
