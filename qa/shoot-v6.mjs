/* V6 acceptance: stinger playback, sound retained, highlight-only effects + sync
   restart, highlight-restores-team, self-update poller. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const board = async (pc = 1) => (await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=data->board&id=eq.${pc}`, { headers: REST })).json())[0].board;
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ov = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
await ov.goto(`${HOSTED}/overlay/?layer=all&pc=1`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);

/* self-update poller present */
ok("overlay polls for new builds (no manual OBS cache refresh)",
  await ov.evaluate(() => /selfUpdate/.test(document.documentElement.innerHTML)));

/* --- stinger still plays, and the sound request is not aborted --- */
await ov.evaluate(() => {
  window.__played = false; window.__audio = [];
  const v = document.querySelector("#fxVideo");
  v.addEventListener("playing", () => window.__played = true);
  const OA = window.Audio;
  window.Audio = function (src) { const a = new OA(src); window.__audio.push(src); return a; };
});
await fetch(`${B}&action=board_reset`); await ov.waitForTimeout(500);
await fetch(`${B}&action=team_toggle&team=sea`);
await ov.waitForFunction(() => window.__played, null, { timeout: 15000 })
  .then(() => ok("team stinger video plays on pick", true))
  .catch(() => ok("team stinger video plays on pick", false));
const audio = await ov.evaluate(() => window.__audio);
ok(`pick sound requested (${(audio[0] ?? "none").split("/").pop()})`,
  audio.some(u => /team-pick\.wav|\/sfx\//.test(u)));

/* --- effects only on highlighted teams --- */
await fetch(`${B}&action=board_reset`);
await fetch(`${B}&action=highlight_clear`);
await ov.waitForTimeout(1200);
const noneHl = await ov.evaluate(() => {
  const cells = [...document.querySelectorAll("#board .cell")];
  /* a pseudo-element only actually exists when `content` is set */
  const hasFx = (c) => getComputedStyle(c, "::after").content !== "none" ||
                       getComputedStyle(c).animationName !== "none";
  return { hl: cells.filter(c => c.classList.contains("hl")).length,
    anyAfter: cells.some(hasFx) };
});
ok(`nothing highlighted -> no button effects anywhere (hl=${noneHl.hl})`,
  noneHl.hl === 0 && !noneHl.anyAfter);

/* --- highlighting an eliminated team brings it back --- */
await fetch(`${B}&action=team_toggle&team=kc`);
await ov.waitForTimeout(800);
const outFirst = (await board()).picked?.kc === true;
await fetch(`${B}&action=highlight&team=kc`);
await ov.waitForTimeout(1200);
const after = await board();
ok(`highlighting an eliminated team restores it and stars it (was out: ${outFirst})`,
  outFirst && !after.picked?.kc && after.highlighted?.kc === true);
const cls = await ov.evaluate(() => {
  const c = document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("kc")];
  return { on: c.classList.contains("on"), hl: c.classList.contains("hl") };
});
ok("overlay shows it back on the board and highlighted", !cls.on && cls.hl);

/* --- sync restart when the highlight set changes --- */
await fetch(`${B}&action=highlight&team=phi`);
await ov.waitForTimeout(1500);
const sync = await ov.evaluate(() => {
  const hl = [...document.querySelectorAll("#board .cell.hl")];
  return { count: hl.length,
    times: hl.map(c => { const a = c.getAnimations({ subtree: true })[0];
      return a ? Math.round(a.currentTime ?? 0) : null; }) };
});
console.log(`   highlighted: ${sync.count}, animation clocks: ${JSON.stringify(sync.times)}`);
ok("all highlighted buttons animate on one shared clock",
  sync.count === 2 && new Set(sync.times.filter(t => t !== null)).size <= 1);

await fetch(`${B}&action=highlight_clear`);
await fetch(`${B}&action=board_reset`);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
