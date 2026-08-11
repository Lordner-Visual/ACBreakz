/* V10 acceptance — button effects restart on EVERY change and only ever stop when a
   team is unhighlighted or eliminated.

   Covers what v9-sync missed: the AI VIDEO CLIP button animation (fxClips/paintClips).
   v9 only exercised the CSS built-ins, where a restart is free; clips were being torn
   down and refetched on every change, so they went blank and looked dead.

   Runs against PC 1 and restores PC 1's exact starting state when it finishes. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const PC = 1;
const CLIP_NAME = /Button edge blue electricity/;      // an ai .mp4 button animation
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = async (a) => {
  const r = await fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${a}&pc=${PC}`);
  const t = await r.text();
  if (!r.ok) console.log(`      deck ${a} -> ${r.status} ${t}`);
  return t;
};
/* the panel function sits behind the Supabase gateway, so it needs the anon key header
   as well as the body key — without it every call is rejected before it reaches Deno */
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const readState = () =>
  fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.${PC}&select=data`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
    .then(r => r.json()).then(rows => rows[0].data);

const ORIGINAL = await readState();
console.log(`snapshot of PC${PC} taken (${JSON.stringify(ORIGINAL).length} bytes) — restored at the end`);

/* the clip's real URL, so we can count refetches — the deterministic tell that the
   <video> elements were torn down rather than re-synced */
const CLIP_URL = await fetch(
  `${env.SUPABASE_URL}/rest/v1/assets?kind=eq.style&select=name,url`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
  .then(r => r.json()).then(rows => rows.find(a => CLIP_NAME.test(a.name))?.url);
if (!CLIP_URL) { console.log("no clip asset matches " + CLIP_NAME); process.exit(1); }
console.log(`clip under test: ${CLIP_URL.split("/").pop()}\n`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });

const page = await ctx.newPage();
await page.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await page.fill("#lockPw", env.PANEL_PASSWORD);
await page.click("#lockGo");
await page.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await page.selectOption("#pcSel", String(PC));
await page.waitForTimeout(1500);
await page.click('nav button[data-tab="style"]');
await page.waitForTimeout(800);

const ov = await ctx.newPage();
let clipFetches = 0;
ov.on("request", (rq) => { if (rq.url() === CLIP_URL) clipFetches++; });
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=hud&pc=${PC}`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);

/* ---- probes ---- */
const probe = () => ov.evaluate(() => {
  const cells = [...document.querySelectorAll("#board .cell.hl")];
  const b = document.getElementById("board");
  return {
    hl: cells.length,
    board: b.className,
    fxi: getComputedStyle(b).getPropertyValue("--fxi").trim(),
    css: cells.flatMap(c => c.getAnimations({ subtree: true })
      .filter(a => a.animationName && a.animationName !== "sweep")
      .map(a => ({ n: a.animationName, t: Math.round(Number(a.currentTime)), s: a.playState }))),
    vid: cells.map(c => { const v = c.querySelector("video.vfx");
      return v ? { tag: v.dataset.qa ?? null, vw: v.videoWidth, paused: v.paused,
                   t: +v.currentTime.toFixed(2) } : null; })
      .filter(Boolean),
  };
});
/* stamp the live clip elements so a rebuild is detectable with certainty, rather than
   hoping a poll lands inside the blank gap */
const tagClips = () => ov.evaluate(() =>
  [...document.querySelectorAll("#board .cell.hl video.vfx")]
    .forEach((v, i) => { v.dataset.qa = "q" + i; }));
const until = async (pred, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await probe();
    if (pred(p)) return { p, took: Date.now() - t0 };
    await ov.waitForTimeout(80);
  }
  return { p: await probe(), took: -1 };
};
const clipsPlaying = (p) => p.vid.length > 0 && p.vid.every(v => v.vw > 0 && !v.paused);
const cssRunning = (n) => (p) => p.css.length > 0 && p.css.every(a => a.n === n && a.s === "running");
const spread = (xs) => xs.length ? Math.max(...xs) - Math.min(...xs) : 0;

/* Drive a change, then judge it on signals that cannot race: did the existing <video>
   elements survive (tag intact), and did the clip get refetched? The frame sampling is
   kept as supporting evidence but is not what the assertions hang on. */
const watchChange = async (label, fire, landed, newClips = 0) => {
  const before = await probe();
  await tagClips();
  clipFetches = 0;
  const t0 = Date.now();
  await fire();
  let minVw = 1e9, everPaused = false, sawReset = false, landedAt = -1;
  while (Date.now() - t0 < 6000) {
    const p = await probe();
    if (landedAt < 0 && landed(p)) landedAt = Date.now() - t0;
    for (const v of p.vid) {
      minVw = Math.min(minVw, v.vw);
      if (v.paused) everPaused = true;
      if (v.t < 0.6) sawReset = true;
    }
    await ov.waitForTimeout(80);
  }
  const p = await probe();
  const kept = p.vid.filter(v => v.tag).length;
  ok(`${label}: landed on the overlay (${landedAt}ms)`, landedAt >= 0);
  ok(`${label}: existing clips reused, not rebuilt (${kept}/${before.vid.length} kept their element)`,
    kept === before.vid.length);
  if (newClips !== null)                    // a newly highlighted team may legitimately fetch
    ok(`${label}: no clip refetch (${clipFetches} requests, expected ${newClips})`,
      clipFetches === newClips);
  ok(`${label}: clips kept their picture throughout ` +
     `(min videoWidth ${minVw === 1e9 ? "n/a" : minVw + "px"}, ever paused ${everPaused})`,
    minVw > 0 && !everPaused);
  ok(`${label}: clips restarted from the top`, sawReset);
  ok(`${label}: clips in sync (spread ${(spread(p.vid.map(v => v.t)) * 1000).toFixed(0)}ms)`,
    spread(p.vid.map(v => v.t)) <= 0.25);
};

const clickAnim = (re) => page.evaluate((r) => {
  const c = [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(x => new RegExp(r).test(x.querySelector(".name").textContent));
  if (!c) throw new Error("no button animation card matching " + r);
  c.querySelector("[data-anim]").click();
}, re.source);
const setSlider = (id, v) => page.evaluate(([i, val]) => {
  const r = document.querySelector(i); r.value = val;
  r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change"));
}, [id, v]);

/* ---- clean slate: nothing eliminated, three teams highlighted ----
   Panel writes FIRST, deck writes AFTER: the panel page pushes its whole state copy,
   so a deck clear issued just before a panel click gets resurrected by the panel's
   stale copy (the realtime adoption hasn't landed yet). Order + settling time. */
await clickAnim(/No Button Animation/); await page.waitForTimeout(1500);
await setSlider("#fxRange", 100); await page.waitForTimeout(1200);
await page.evaluate(() => document.querySelector('[data-grid="buttons"]').click());
await page.waitForTimeout(1500);
await deck("action=board_reset");
await deck("action=highlight_clear");
await page.waitForTimeout(1500);            // let the panel page adopt the deck writes
/* pin the baseline down: the panel page holds its own copy of state, so confirm the
   board is genuinely empty before adding highlights rather than assuming it */
let r = await until(p => p.hl === 0, 20000);
if (r.took < 0) console.log(`      still highlighted after clear: ` +
  JSON.stringify(await ov.evaluate(() => window.ACBZ.ORDER
    .filter((_, i) => document.querySelectorAll("#board .cell")[i].classList.contains("hl")))));
ok(`clean slate: nothing highlighted (${r.took}ms)`, r.took >= 0);
for (const t of ["kc", "phi", "sea"]) await deck(`action=highlight&team=${t}`);
r = await until(p => p.hl === 3);
if (r.took < 0) console.log(`      highlighted instead: ` +
  JSON.stringify(await ov.evaluate(() => window.ACBZ.ORDER
    .filter((_, i) => document.querySelectorAll("#board .cell")[i].classList.contains("hl")))));
ok(`clean slate: 3 teams highlighted (${r.took}ms)`, r.took >= 0);

console.log("\n=== A. AI VIDEO CLIP button animation ===");
await clickAnim(CLIP_NAME);
r = await until(p => p.vid.length === 3 && clipsPlaying(p));
ok(`clip starts on all 3 highlighted teams (${r.took}ms)`, r.took >= 0);
await ov.waitForTimeout(1500);

await watchChange("intensity 100->170",
  () => setSlider("#fxRange", 170), p => p.fxi === "1.7");
await watchChange("grid -> checker",
  () => page.evaluate(() => document.querySelector('[data-grid="checker"]').click()),
  p => /grid-checker(?!bare)/.test(p.board));
await watchChange("highlight a 4th team",
  () => deck("action=highlight&team=dal"), p => p.hl === 4, null);

console.log("\n=== B. CSS built-in effect still fine ===");
await clickAnim(CLIP_NAME);                     // deselect the clip
await page.waitForTimeout(1500);                // let the push land before the next click
await clickAnim(/Edge Glow/);
r = await until(cssRunning("bglow"));
ok(`Edge Glow starts on all ${r.p.hl} highlighted (${r.took}ms)`, r.took >= 0);
await setSlider("#fxRange", 220);
r = await until(p => p.fxi === "2.2" && cssRunning("bglow")(p));
ok(`intensity change: glow restarted together, spread ${spread(r.p.css.map(a => a.t))}ms`,
  r.took >= 0 && spread(r.p.css.map(a => a.t)) <= 120);

console.log("\n=== C. None means zero effects, not a dead board ===");
await page.waitForTimeout(1200);
await clickAnim(/No Button Animation/);
r = await until(p => !/anim-/.test(p.board) && p.vid.length === 0);
ok("No Button Animation shows zero effects", r.took >= 0);
await page.waitForTimeout(1200);
await clickAnim(CLIP_NAME);
r = await until(p => p.vid.length === 4 && clipsPlaying(p));
ok(`reselecting starts the clip on every highlighted team again (${r.took}ms)`, r.took >= 0);

console.log("\n=== D. Only unhighlight / eliminate stops an effect ===");
await deck("action=team_toggle&team=phi");
r = await until(p => p.hl === 3);
ok(`eliminating PHI stops only PHI (${r.p.hl} left, all playing)`,
  r.took >= 0 && clipsPlaying(r.p));
await deck("action=unhighlight&team=dal");
r = await until(p => p.hl === 2);
ok(`unhighlighting DAL stops only DAL (${r.p.hl} left, all playing)`,
  r.took >= 0 && clipsPlaying(r.p));

/* ---- restore PC1 exactly as we found it ---- */
await browser.close();
const res = await panel({ action: "state", pc: PC, data: ORIGINAL });
const back = await readState();
const restored = JSON.stringify(back) === JSON.stringify(ORIGINAL);
ok(`PC${PC} restored byte-identical to the snapshot (${res.ok ? "written" : JSON.stringify(res)})`, restored);

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
