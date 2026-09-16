/* The FX source must heal itself — every way it has been seen to go quiet, forced on purpose.

   Runs the real page against the real project as PC Test (row 6). Every event it inserts is
   addressed to pc 6, so no live rig can hear it (V17 filters pc=in.(0,N) server-side), and the
   test types it invents are ignored by handleEvent. Clip bodies other than the one clip it
   plays are aborted, so a run does not pull the whole FX set.

     1. a dropped socket: rebuild once, and realtime DELIVERS again (not merely "joined")
     2. a deaf channel (joined, delivering nothing): the backstop plays the missed event and
        the rebuild restores realtime delivery
     3. a clip that stalls mid-play: the FX lane reopens and the next stinger plays
     4. a job that never ends at all: the 45s gate forces the lane open
     5. maintenance reload (?maint shortens the clock): reloads when quiet, and does NOT
        re-download the FX set afterwards
     6. circuit breaker: repeated drops trip a health reload

     node qa/shoot-fx-selfheal.mjs [base-url]      base defaults to the deployed staging overlay */
import { readFileSync } from "fs";
import { chromium } from "playwright";

const BASE = process.argv[2] || "https://lordner-visual.github.io/ACBreakz/staging/overlay/";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
let fails = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${extra ? "   " + extra : ""}`); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sql = async (q) => {
  const r = await fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) throw new Error(`SQL ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(1).padStart(6);
const inserted = [];
async function send(type, payload) {
  const [row] = await sql(`insert into public.events(type, payload) values ('${type}',
    '${JSON.stringify({ pc: 6, ...payload }).replace(/'/g, "''")}'::jsonb) returning id`);
  inserted.push(row.id);
  return row.id;
}
async function until(page, fn, arg, ms) {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }); return true; }
  catch (e) { return false; }
}

/* one real Classic team clip (well under the cache-size cliff) to actually play */
const [clip] = await sql(`select url from public.assets where kind='animation' and url is not null
  and meta->>'group'='team' and meta->>'set' is null
  and coalesce((meta->>'deleted')::bool,false)=false order by created_at limit 1`);
console.log(`  playing ${clip.url.split("/").pop()}`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function open(query) {
  const page = await browser.newPage();
  const media = { total: 0 };
  /* A faithful "joined but delivers nothing": the realtime socket passes through untouched
     except that postgres_changes frames for a DEAF topic are dropped. Stripping
     channel.bindings.postgres_changes does NOT do this on supabase-js 2.116 — the event still
     arrived, so the first version of step 2 tested nothing. */
  page.deaf = new Set();
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (typeof m === "string" && page.deaf.size) {
        try {
          const a = JSON.parse(m);
          const [topic, event] = Array.isArray(a) ? [a[2], a[3]] : [a.topic, a.event];
          if (event === "postgres_changes" && page.deaf.has(topic)) return;
        } catch (e) {}
      }
      ws.send(m);
    });
    ws.onClose((code, reason) => server.close({ code, reason }));
    server.onClose((code, reason) => ws.close({ code, reason }));
  });
  await page.route(/\/storage\/v1\/object\/.*\.(webm|mp4|mp3|wav|ogg)(\?|$)/i, (r) => {
    media.total++;
    return r.request().url() === clip.url ? r.continue() : r.abort();
  });
  page.on("console", (m) => { const t = m.text();
    if (t.includes("[acbz]") && !t.includes("warming")) console.log(`    ${stamp()}s  ${t.slice(0, 150)}`); });
  await page.goto(`${BASE}?layer=fx&pc=6${query}`, { waitUntil: "load" });
  await until(page, () => window.__acbzDiag && window.__acbzDiag().db === "joined", null, 30000);
  return { page, media };
}
const diag = (page) => page.evaluate(() => window.__acbzDiag());
const fx = (page) => page.evaluate(() => window.__acbzFx());

try {
  /* ---------------- 1. dropped socket ---------------- */
  console.log("\n1. dropped socket");
  let { page } = await open("");
  await sleep(6000);                                // let the backstop learn its cursor
  await page.evaluate(() => window.__sb.realtime.socketAdapter.socket.conn.close());
  const back = await until(page, () => {
    const d = window.__acbzDiag(); return d.db === "joined" && !d.pendingRebuild && d.rebuilds >= 1;
  }, null, 45000);
  ok("rebuilt once and joined again", back, JSON.stringify(await diag(page)));
  await sleep(2000);
  let d0 = await diag(page);
  await send("__selfheal", { k: "after-drop" });
  const heard = await until(page, (t) => window.__acbzDiag().lastEventAt > t, d0.lastEventAt, 4000);
  let d1 = await diag(page);
  ok("realtime DELIVERS after the rebuild (not just joined)", heard && d1.misses === d0.misses,
     `misses ${d0.misses}->${d1.misses}`);

  /* ---------------- 2. deaf channel ---------------- */
  console.log("\n2. joined but deaf");
  const topicBefore = d1.topic;
  page.deaf.add(topicBefore);                        // still "joined", hears nothing
  d0 = await diag(page);
  const sentAt = Date.now();
  await send("__selfheal", { k: "while-deaf" });
  const caught = await until(page, (m) => window.__acbzDiag().misses > m, d0.misses, 12000);
  const dDeaf = await diag(page);
  ok("the page really was deaf (realtime delivered nothing)", dDeaf.lastEventAt === d0.lastEventAt);
  ok("the backstop caught the event realtime never delivered", caught,
     `after ${((Date.now() - sentAt) / 1000).toFixed(1)}s`);
  const rebuilt = await until(page, (t) => {
    const d = window.__acbzDiag(); return d.topic !== t && d.db === "joined" && !d.pendingRebuild;
  }, topicBefore, 30000);
  ok("and rebuilt the deaf channel", rebuilt);
  await sleep(2000);
  d0 = await diag(page);
  await send("__selfheal", { k: "after-deaf" });
  const heard2 = await until(page, (t) => window.__acbzDiag().lastEventAt > t, d0.lastEventAt, 4000);
  d1 = await diag(page);
  ok("realtime delivers again after the deaf rebuild", heard2 && d1.misses === d0.misses);

  /* ---------------- 3. clip stalls mid-play ---------------- */
  console.log("\n3. clip stalls mid-play");
  let f0 = await fx(page);
  await send("play_animation", { url: clip.url, boxed: true });
  const started = await until(page, () => {
    const v = document.querySelector("#fxVideo"); return window.__acbzFx().busy && v.currentTime > 0.2;
  }, null, 15000);
  ok("the clip started", started);
  await page.evaluate(() => document.querySelector("#fxVideo").pause());   // no ended, no error: a dry buffer
  const t0 = Date.now();
  const freed = await until(page, () => !window.__acbzFx().busy, null, 15000);
  ok("the FX lane reopened on its own", freed, `in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  f0 = await fx(page);
  await send("play_animation", { url: clip.url, boxed: true });
  const next = await until(page, (n) => window.__acbzFx().played > n &&
    document.querySelector("#fxVideo").currentTime > 0.2, f0.played, 15000);
  ok("the next stinger plays", next);
  await until(page, () => !window.__acbzFx().busy, null, 20000);

  /* ---------------- 4. a job that never ends ---------------- */
  console.log("\n4. a job that never ends (45s gate)");
  f0 = await fx(page);
  await send("play_animation", { url: clip.url, boxed: true });
  await until(page, () => document.querySelector("#fxVideo").currentTime > 0.2, null, 15000);
  await page.evaluate(() => { document.querySelector("#fxVideo").loop = true; });   // advances forever
  const g0 = Date.now();
  const gate = await until(page, (s) => window.__acbzFx().stuck > s && !window.__acbzFx().busy,
                           f0.stuck, 75000);
  ok("the gate forced the lane open", gate, `after ${((Date.now() - g0) / 1000).toFixed(0)}s`);
  /* the loop flag was this test's doing, not the page's — take it back off the element */
  await page.evaluate(() => { document.querySelector("#fxVideo").loop = false; });
  f0 = await fx(page);
  await send("play_animation", { url: clip.url, boxed: true });
  const after = await until(page, (n) => window.__acbzFx().played > n &&
    document.querySelector("#fxVideo").currentTime > 0.2, f0.played, 15000);
  ok("a stinger plays after the forced open", after);
  await page.close();

  /* ---------------- 5. maintenance reload ---------------- */
  console.log("\n5. maintenance reload (?maint=40000)");
  let opened = await open("&maint=40000");
  page = opened.page;
  const warmBefore = opened.media.total;
  let reloaded = false;
  page.on("framenavigated", (fr) => { if (fr === page.mainFrame()) reloaded = true; });
  const m0 = Date.now();
  while (!reloaded && Date.now() - m0 < 120000) await sleep(1000);
  ok("reloaded itself once up and quiet", reloaded, `after ${((Date.now() - m0) / 1000).toFixed(0)}s`);
  opened.media.total = 0;
  await until(page, () => window.__acbzDiag && window.__acbzDiag().db === "joined", null, 30000);
  await sleep(8000);
  const rl = await page.evaluate(() => JSON.parse(localStorage.getItem("acbz-selfreload-6-fx")));
  ok("recorded why", /^maintenance/.test(rl?.why ?? ""), rl?.why);
  ok("did NOT re-download the FX set after the reload", opened.media.total === 0,
     `${warmBefore} clip request(s) on first load, ${opened.media.total} after the reload`);
  await page.close();

  /* ---------------- 6. circuit breaker ---------------- */
  console.log("\n6. circuit breaker (repeated drops)");
  opened = await open("");
  page = opened.page;
  await page.evaluate(() => localStorage.removeItem("acbz-selfreload-6-fx"));
  let tripped = false;
  page.on("framenavigated", (fr) => { if (fr === page.mainFrame()) tripped = true; });
  const b0 = Date.now();
  while (!tripped && Date.now() - b0 < 420000) {
    await page.evaluate(() => { try { window.__sb.realtime.socketAdapter.socket.conn.close(); } catch (e) {} })
      .catch(() => {});
    await sleep(6000);
  }
  ok("repeated rebuilds trip a health reload", tripped, `after ${((Date.now() - b0) / 1000).toFixed(0)}s`);
  if (tripped) {
    await sleep(3000);
    const why = await page.evaluate(() => JSON.parse(localStorage.getItem("acbz-selfreload-6-fx"))?.why);
    ok("recorded as a health reload", /^health/.test(why ?? ""), why);
    await page.evaluate(() => localStorage.removeItem("acbz-selfreload-6-fx"));
  }
  await page.close();
} finally {
  if (inserted.length)
    await sql(`delete from public.events where id in (${inserted.map(i => `'${i}'`).join(",")})`).catch(() => {});
  await browser.close();
}
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
