/* Board scale acceptance — button size past 100%, logo size past the button edge,
   and effect intensity that changes brightness WITHOUT changing speed.

   Runs against the hosted overlay on one idle PC and restores its state. */
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
const ov = await (await browser.newContext({ viewport: { width: 1080, height: 900 } })).newPage();
await ov.goto(`${HOSTED}/overlay/?layer=hud&pc=${PC}`, { waitUntil: "networkidle" });
await ov.waitForTimeout(1500);

const set = async (patch) => { await panel({ action: "patch", pc: PC, patch }); await ov.waitForTimeout(1400); };
const probe = () => ov.evaluate(() => {
  const b = document.getElementById("board"), cs = getComputedStyle(b);
  const cells = [...b.querySelectorAll(".cell")];
  const r0 = cells[0].getBoundingClientRect(), r15 = cells[15].getBoundingClientRect();
  const img = cells[0].querySelector("img").getBoundingClientRect();
  return { tile: cs.getPropertyValue("--tile").trim(), padx: cs.getPropertyValue("--padx").trim(),
    logofrac: +cs.getPropertyValue("--logofrac"), spill: b.classList.contains("logo-spill"),
    left: Math.round(r0.left), right: Math.round(r15.right),
    logoPct: Math.round(img.width / r0.width * 100),
    overflow: getComputedStyle(cells[0]).overflow };
});

await set({ boardGrid: "buttons", boardGap: 0, boardSize: 100, logoSize: 100, fxIntensity: 100,
            boardButtons: null, board: undefined });

console.log("=== button size ===");
for (const size of [100, 120, 127, 150]) {
  await set({ boardSize: size });
  const r = await probe();
  console.log(`  ${size}%  tile=${r.tile} padding=${r.padx} row spans x${r.left}..x${r.right}`);
  if (size === 100)
    ok(`  100% still inside the WhatNot-safe area x111..x968`, r.left >= 111 && r.right <= 968);
  if (size <= 127)
    ok(`  ${size}%: board gives back its padding so nothing is cropped`, r.left >= 0 && r.right <= 1080);
  else
    ok(`  ${size}%: beyond the canvas fit the outer teams crop (documented, operator's call)`, r.left < 0);
}

console.log("\n=== logo size ===");
await set({ boardSize: 100 });
for (const logo of [100, 150, 200]) {
  await set({ logoSize: logo });
  const r = await probe();
  console.log(`  ${logo}%  logofrac=${r.logofrac} spill=${r.spill} logo is ${r.logoPct}% of the button`);
  if (logo === 100) ok(`  100% is unchanged from before (logo inside the button)`, r.logoPct < 100 && !r.spill);
  if (logo === 150) ok(`  150% fills the button edge to edge`, Math.abs(r.logoPct - 100) <= 8);
  if (logo === 200) ok(`  200% spills past the button, which no longer clips it`,
    r.logoPct >= 140 && r.spill && r.overflow === "visible");
}

console.log("\n=== the logo slider works with a custom button style too ===");
const btnStyle = await fetch(
  `${env.SUPABASE_URL}/rest/v1/assets?kind=eq.style&meta->>domain=eq.board_button&url=not.is.null&limit=1`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json());
if (!btnStyle[0]) console.log("  SKIP  no uploaded button style to test with");
else {
  await set({ boardButtons: btnStyle[0], logoSize: 100 });
  const a = (await probe()).logoPct;
  await set({ logoSize: 200 });
  const b = (await probe()).logoPct;
  console.log(`  with "${btnStyle[0].name}": ${a}% -> ${b}% of the button`);
  ok(`  logo size still responds when a button style is applied (was pinned before)`, b > a + 30);
  await set({ boardButtons: null });
}

console.log("\n=== effect intensity changes brightness, not speed ===");
await set({ logoSize: 100, buttonAnims: [
  { id: "builtin-glow", name: "Edge Glow", meta: { effect: "glow", mode: "ambient", domain: "button_anim" } }] });
await panel({ action: "board", pc: PC, boardAction: "highlight", team: "kc" });
await ov.waitForTimeout(1500);
const glow = () => ov.evaluate(() => {
  const c = document.querySelector("#board .cell.hl");
  if (!c) return null;
  const a = c.getAnimations({ subtree: true }).find(x => x.animationName === "bglow");
  if (!a) return null;
  const cs = getComputedStyle(c, "::after");
  return { dur: a.effect.getTiming().duration, shadow: cs.boxShadow };
});
const g30 = await (async () => { await set({ fxIntensity: 30 }); return glow(); })();
const g250 = await (async () => { await set({ fxIntensity: 250 }); return glow(); })();
console.log(`  30%  -> ${g30?.dur}ms   250% -> ${g250?.dur}ms`);
ok(`  the glow runs at the same speed at both extremes`, !!g30 && !!g250 && g30.dur === g250.dur);
ok(`  but the glow itself is stronger at 250% (box-shadow grew)`,
  !!g30 && !!g250 && g30.shadow !== g250.shadow);

/* ---- restore ---- */
await browser.close();
await panel({ action: "board", pc: PC, boardAction: "highlight_clear" });
const res = await panel({ action: "state", pc: PC, data: ORIGINAL, force: true });
const back = await readState();
const bare = (d) => { const { updatedAt, lastWriter, ...rest } = d; return JSON.stringify(rest); };
ok(`PC${PC} restored (${res.ok ? "written" : JSON.stringify(res)})`, bare(back) === bare(ORIGINAL));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
