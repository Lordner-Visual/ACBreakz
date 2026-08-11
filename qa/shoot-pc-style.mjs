/* Acceptance: the operator dashboard (pc.html) has the full Board Style controls —
   multi-select button animations + size/gap/logo/intensity sliders — driving ONLY its
   own PC, with no delete buttons anywhere. Runs on PC 2 and restores its state. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const PC = Number(process.argv[2]) || 5;   // pick an idle PC; state is restored after
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });

const op = await ctx.newPage();
await op.goto(`${HOSTED}/control/pc.html?pc=${PC}`, { waitUntil: "networkidle" });
await op.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await op.waitForTimeout(2000);

const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=hud&pc=${PC}`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2000);

const boardVar = (v) => ov.evaluate((x) =>
  getComputedStyle(document.getElementById("board")).getPropertyValue(x).trim(), v);
const boardCls = () => ov.evaluate(() => document.getElementById("board").className);
const until = async (fn, want, ms = 12000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const got = await fn();
    if (want(got)) return { got, took: Date.now() - t0 };
    await ov.waitForTimeout(150);
  }
  return { got: await fn(), took: -1 };
};

/* ---- 1. operator page shape ---- */
await op.click('nav button[data-tab="style"]');
await op.waitForTimeout(500);
const shape = await op.evaluate(() => ({
  dels: document.querySelectorAll("[data-del]").length,
  sliders: ["#sizeRange", "#gapRange", "#logoRange", "#fxRange"].filter(s => document.querySelector(s)).length,
  animCards: document.querySelectorAll("#btnAnimGrid [data-anim]").length,
  applyOnly: document.querySelectorAll("#btnAnimGrid [data-part]").length,
}));
ok(`no delete buttons anywhere (${shape.dels})`, shape.dels === 0);
ok(`all four sliders present (${shape.sliders}/4)`, shape.sliders === 4);
ok(`button animations render as multi-select cards (${shape.animCards} cards, ${shape.applyOnly} single-select leftovers)`,
  shape.animCards > 0 && shape.applyOnly === 0);

/* ---- 2. sliders drive THIS PC's overlay ---- */
const setSlider = (id, v) => op.evaluate(([i, val]) => {
  const r = document.querySelector(i); r.value = val;
  r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change"));
}, [id, v]);

await setSlider("#fxRange", 180);
let r = await until(() => boardVar("--fxi"), (x) => x === "1.8");
ok(`effect intensity 180 -> overlay --fxi 1.8 (${r.took}ms)`, r.took >= 0);

await setSlider("#sizeRange", 70);
r = await until(() => boardVar("--tile"), (x) => x === "37px");
ok(`button size 70% -> overlay tile 37px (${r.took}ms, got ${r.got})`, r.took >= 0);

await setSlider("#logoRange", 140);
r = await until(() => boardVar("--logofrac"), (x) => x === "0.097");
ok(`logo size 140% -> overlay --logofrac 0.097 (${r.took}ms, got ${r.got})`, r.took >= 0);

/* ---- 3. multi-select button animations ---- */
const clickAnim = (re) => op.evaluate((s) => {
  const c = [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(x => new RegExp(s).test(x.querySelector(".name").textContent));
  if (!c) throw new Error("no card matching " + s);
  c.querySelector("[data-anim]").click();
}, re.source);

await clickAnim(/No Button Animation/); await op.waitForTimeout(1500);   // clear whatever was selected
await clickAnim(/Edge Glow/); await op.waitForTimeout(1500);
await clickAnim(/Glitch Pulse/); await op.waitForTimeout(1500);
r = await until(boardCls, (c) => /anim-glow/.test(c) && /anim-glitch/.test(c));
ok(`selecting two effects runs BOTH on the overlay (${r.took}ms: ${r.got.replace("abs ", "")})`, r.took >= 0);

const mid = await readState();
ok(`state carries buttonAnims[${(mid.buttonAnims ?? []).length}] and no legacy buttonAnim key`,
  Array.isArray(mid.buttonAnims) && mid.buttonAnims.length === 2 && !("buttonAnim" in mid));

await clickAnim(/No Button Animation/);
r = await until(boardCls, (c) => !/anim-/.test(c));
ok(`No Button Animation clears every effect (${r.took}ms)`, r.took >= 0);
const cleared = await readState();
ok("state buttonAnims is an empty list", Array.isArray(cleared.buttonAnims) && cleared.buttonAnims.length === 0);

/* ---- 4. scope: only PC ${PC} was touched ---- */
const others = await fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=neq.${PC}&select=id,data`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json());
const strayFx = others.filter(o => o.data?.fxIntensity === 180).map(o => o.id);
ok(`no other PC picked up the changes (${strayFx.length ? "PCs " + strayFx : "none"})`, strayFx.length === 0);

/* ---- restore ---- */
await browser.close();
const res = await panel({ action: "state", pc: PC, data: ORIGINAL });
const back = await readState();
ok(`PC${PC} restored byte-identical (${res.ok ? "written" : JSON.stringify(res)})`,
  JSON.stringify(back) === JSON.stringify(ORIGINAL));

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
