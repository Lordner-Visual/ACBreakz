/* Looping animation acceptance — the deck key is a toggle, the loop lives in state
   so it survives an overlay reload, it plays on repeat, and it fades out on stop.

   Runs on one idle PC and restores it. */
import { chromium } from "playwright";
import { readFileSync } from "fs";
/* refuses to run while a live PC looks busy — these suites mutate the production rows */
import { assertIdle } from "./lib/live-guard.mjs";
await assertIdle();

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const PC = Number(process.argv[2]) || 5;
const CLIP = process.argv[3] || "Stash or Pass";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}&pc=${PC}`)
  .then(async r => ({ status: r.status, body: await r.text() }));
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const readState = () =>
  fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.${PC}&select=data`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
    .then(r => r.json()).then(rows => rows[0].data);

const ORIGINAL = await readState();
console.log(`snapshot of PC${PC} taken — restored at the end\n`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
const ov = await ctx.newPage();
await ov.goto(`${HOSTED}/overlay/?layer=fx&pc=${PC}`, { waitUntil: "networkidle" });
await ov.waitForTimeout(1500);

const loop = () => ov.evaluate(() => {
  const w = document.querySelector("#layer-fx .fxloop");
  if (!w) return null;
  const vs = [...w.querySelectorAll("video")];
  const im = w.querySelector("img");
  return { present: true, opacity: getComputedStyle(w).opacity,
    box: { left: w.style.left || "0px", width: w.style.width || "1080px" },
    playing: vs.some(v => !v.paused && v.readyState >= 2) || !!im,
    t: Math.max(0, ...vs.map(v => v.currentTime)),
    copies: vs.length };
});
const until = async (pred, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const l = await loop(); if (pred(l)) return { l, took: Date.now() - t0 };
    await ov.waitForTimeout(120); }
  return { l: await loop(), took: -1 };
};

/* make sure nothing is looping to start with */
await panel({ action: "patch", pc: PC, patch: { loopFx: null } });
await ov.waitForTimeout(800);
ok("nothing looping at the start", (await loop()) === null);

console.log("=== press once: starts looping ===");
let r = await deck(`action=play_loop&name=${encodeURIComponent(CLIP)}`);
if (r.status !== 200) { console.log("  deck said:", r.status, r.body); }
const first = JSON.parse(r.body || "{}");
ok(`deck reports it started (looping=${first.looping}, state=${first.state})`,
  first.looping === true && first.state === "on");
let s = await readState();
ok(`state carries loopFx for "${s.loopFx?.name}"`, !!s.loopFx?.url);
let w = await until(l => l?.present && l.playing);
ok(`overlay is playing the clip (${w.took}ms, ${w.l?.copies} crossfade copies)`, w.took >= 0);
/* Geometry comes from the ASSET, not from play_loop: meta.fit==="full" fills the frame,
   anything else sits in the animation box. Whichever clip this PC is pinned to, the
   render must match its own fit — hard-coding "boxed" broke the day a full-frame
   variant was pinned here. */
const wantFull = s.loopFx?.fit === "full";
ok(`${wantFull ? "fills the frame" : "is boxed to the animation box"} as its asset asks ` +
   `(fit=${s.loopFx?.fit ?? "box"} left=${w.l?.box.left} width=${w.l?.box.width})`,
  wantFull ? (w.l?.box.left === "0px" && w.l?.box.width === "1080px")
           : (w.l?.box.left === "207px" && w.l?.box.width === "667px"));

console.log("\n=== it keeps looping past the end of the clip ===");
const t1 = (await loop()).t;
await ov.waitForTimeout(6000);
const l2 = await loop();
ok(`still playing 6s later (t went ${t1.toFixed(1)}s -> ${l2?.t.toFixed(1)}s, never stopped)`,
  !!l2?.present && l2.playing);

console.log("\n=== an unrelated state change must not restart it ===");
await panel({ action: "patch", pc: PC, patch: { boardGap: 5 } });
await ov.waitForTimeout(1500);
const l3 = await loop();
ok(`survived a boardGap patch without being rebuilt (${l3?.copies} copies, still playing)`,
  !!l3?.present && l3.playing);

console.log("\n=== survives an overlay reload (this is why it lives in state) ===");
await ov.reload({ waitUntil: "networkidle" });
w = await until(l => l?.present && l.playing);
ok(`still looping after a full overlay reload (${w.took}ms)`, w.took >= 0);

console.log("\n=== press again: stops, with a fade ===");
r = await deck(`action=play_loop&name=${encodeURIComponent(CLIP)}`);
const second = JSON.parse(r.body || "{}");
ok(`deck reports it stopped (looping=${second.looping}, state=${second.state})`,
  second.looping === false && second.state === "off");
/* Catch it mid-fade: present but no longer fully opaque. The window has to cover
   realtime delivery (~200-400ms) AND the 350ms fade, so sample until the element
   actually goes away rather than for a fixed slice. */
let sawFade = false, minOpacity = 1;
for (let i = 0; i < 60; i++) {
  const l = await loop();
  if (!l) break;                                   // gone — fade finished
  minOpacity = Math.min(minOpacity, Number(l.opacity));
  if (Number(l.opacity) < 0.95) sawFade = true;
  await ov.waitForTimeout(40);
}
ok(`it faded out rather than cutting (min opacity seen ${minOpacity.toFixed(2)})`, sawFade);
w = await until(l => l === null, 5000);
ok(`the loop element is gone (${w.took}ms)`, w.took >= 0);
s = await readState();
ok("state cleared loopFx", s.loopFx === null || s.loopFx === undefined);

console.log("\n=== fmt=text returns a bare token for the deck icon matcher ===");
r = await deck(`action=play_loop&name=${encodeURIComponent(CLIP)}&fmt=text`);
ok(`on  -> "${r.body}"`, r.body === "on");
r = await deck(`action=play_loop&name=${encodeURIComponent(CLIP)}&fmt=text`);
ok(`off -> "${r.body}"`, r.body === "off");

/* ---- restore ---- */
await browser.close();
const res = await panel({ action: "state", pc: PC, data: ORIGINAL, force: true });
const back = await readState();
const bare = (d) => { const { updatedAt, lastWriter, ...rest } = d; return JSON.stringify(rest); };
ok(`PC${PC} restored (${res.ok ? "written" : JSON.stringify(res)})`, bare(back) === bare(ORIGINAL));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
