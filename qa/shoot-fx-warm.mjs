/* The FX layer must warm its clips before they are needed, so a first press is not a
   cold multi-megabyte fetch — and it must warm them on the FX source ONLY, since each
   PC runs three browser sources.

   Then: a press must render its stinger, and the board must not dim before it does.

   Read-only on assets; fires one team_pick at an idle PC and restores it. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const PC = Number(process.argv[2]) || 5;
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}&pc=${PC}`)
  .then(r => r.json().catch(() => ({})));
const panel = (b) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...b }) }).then(r => r.json());
const stateOf = () => fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.${PC}&select=data`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
  .then(r => r.json()).then(rows => rows[0].data);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SNAP = await stateOf();
console.log(`snapshot of PC${PC} taken — restored at the end\n`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const isClip = (u) => /\/media\/(animations|team_anim)\//.test(u) && /\.(webm|mp4)(\?|$)/i.test(u);

/* Count the clips each layer ASKS for, from a cold cache each time.
   The bodies are aborted: this pass only cares which URLs are requested, and letting it
   really download meant ~250 MB of the user's Supabase egress every single run. The
   playback pass below is deliberately left alone — it must fetch for real, since it
   asserts the stinger renders and plays unmuted. */
const clipsPulledBy = async (layer, settleMs = 20000) => {
  const ctx = await browser.newContext();          // fresh context = cold HTTP cache
  const page = await ctx.newPage();
  const urls = new Set();
  await page.route(u => isClip(u.href ?? String(u)), (route) => {
    urls.add(route.request().url());
    route.abort();
  });
  await page.goto(`${HOSTED}/overlay/?layer=${layer}&pc=${PC}`, { waitUntil: "networkidle" });
  /* wait for the warm queue to go quiet rather than a fixed sleep */
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < settleMs) {
    await sleep(1500);
    if (urls.size === last && urls.size > 0) break;
    last = urls.size;
  }
  await ctx.close();
  return urls;
};

console.log("=== the FX source warms its clips; the HUD source must not ===");
const fxUrls = await clipsPulledBy("fx");
console.log(`  layer=fx  pulled ${fxUrls.size} clips`);
ok(`the FX source warms the set up front (${fxUrls.size} clips)`, fxUrls.size >= 20);

const hudUrls = await clipsPulledBy("hud", 9000);
console.log(`  layer=hud pulled ${hudUrls.size} clips`);
ok(`the HUD source warms nothing — otherwise every PC would pull the set 3x (${hudUrls.size})`,
  hudUrls.size === 0);

console.log("\n=== a press renders its stinger, and the board waits for it ===");
await deck("action=board_reset");
await sleep(600);

const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1080, height: 1920 });
await page.goto(`${HOSTED}/overlay/?layer=all&pc=${PC}`, { waitUntil: "networkidle" });
await sleep(2000);
/* let the warm finish so this is the state a real rig is in at showtime */
await page.waitForFunction(() => !document.querySelector("video[preload=auto][style*='1px']"), {}, { timeout: 45000 })
  .catch(() => {});
await sleep(1500);

const TEAM = "sea";
await page.evaluate((t) => {
  window.__log = [];
  const cell = document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf(t)];
  const v = document.getElementById("fxVideo");
  window.__t0 = performance.now();
  window.__tick = setInterval(() => {
    window.__log.push({ at: Math.round(performance.now() - window.__t0),
      playing: v.videoWidth > 0 && !v.paused, dim: cell.classList.contains("on"),
      muted: v.muted });
  }, 40);
}, TEAM);

await deck(`action=team_toggle&team=${TEAM}`);
await sleep(5000);
const log = await page.evaluate(() => { clearInterval(window.__tick); return window.__log; });
const firstPlaying = log.find(x => x.playing)?.at ?? null;
const firstDim = log.find(x => x.dim)?.at ?? null;
console.log(`  stinger first rendered at ${firstPlaying ?? "never"}ms, board dimmed at ${firstDim ?? "never"}ms`);
ok(`the stinger actually rendered`, firstPlaying !== null);
ok(`the board did not dim before the stinger appeared`,
  firstPlaying !== null && firstDim !== null && firstDim >= firstPlaying);
ok(`the clip played with its audio (not the muted fallback)`,
  log.some(x => x.playing && x.muted === false));

await ctx.close();
await browser.close();

/* ---- restore ---- */
await deck("action=board_reset");
const res = await panel({ action: "state", pc: PC, data: SNAP, force: true });
const back = await stateOf();
const bare = (d) => { const { updatedAt, lastWriter, ...r } = d; return JSON.stringify(r); };
ok(`PC${PC} restored (${res.ok ? "written" : JSON.stringify(res)})`, bare(back) === bare(SNAP));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
