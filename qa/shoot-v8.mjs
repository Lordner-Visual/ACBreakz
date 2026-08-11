/* V8: sliders drive the overlay, button animations multi-select, libraries separated,
   AI tab present with refinement actions. No paid generation in this run. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", e => errs.push(e.message));
await page.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await page.fill("#lockPw", env.PANEL_PASSWORD);
await page.click("#lockGo");
await page.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await page.selectOption("#pcSel", "2");     // switch PC without reloading (reload re-locks)
await page.waitForTimeout(2500);
ok("no JS errors on the panel", errs.length === 0);

const ov = await ctx.newPage();
await ov.setViewportSize({ width: 1080, height: 1920 });
await ov.goto(`${HOSTED}/overlay/?layer=all&pc=2`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);

/* --- libraries are separate --- */
await page.click('nav button[data-tab="banners"]');
await page.waitForTimeout(1000);
const lists = await page.evaluate(() => ({
  comp: [...document.querySelectorAll("#compBGs .name")].map(n => n.textContent),
}));
const bgNames = await page.evaluate(async () => {
  document.querySelector('nav button[data-tab="bgs"]').click();
  await new Promise(r => setTimeout(r, 500));
  return [...document.querySelectorAll("#bgGrid .name")].map(n => n.textContent);
});
ok(`streamer backgrounds no longer appear as composer art (${bgNames.length} bgs, ${lists.comp.length} composer)`,
  !bgNames.some(n => lists.comp.includes(n)));

/* --- sliders reach the overlay --- */
await page.click('nav button[data-tab="style"]');
await page.waitForTimeout(800);
const setSlider = async (id, v) => {
  await page.evaluate(([sel, val]) => { const r = document.querySelector(sel);
    r.value = val; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); }, [id, v]);
  await page.waitForTimeout(1400);
};
const tile = () => ov.evaluate(() => {
  const c = document.querySelector("#board .cell").getBoundingClientRect();
  const img = document.querySelector("#board .cell img").getBoundingClientRect();
  const b = document.querySelector("#board");
  const all = [...document.querySelectorAll("#board .cell")].map(x => x.getBoundingClientRect());
  return { w: Math.round(c.width), logo: Math.round(img.width),
    fxi: getComputedStyle(b).getPropertyValue("--fxi").trim(),
    left: Math.round(Math.min(...all.map(r => r.left))),
    right: Math.round(Math.max(...all.map(r => r.right))) };
});
const base = await tile();
await setSlider("#sizeRange", 70);
const small = await tile();
ok(`button size slider shrinks the buttons (${base.w}px -> ${small.w}px)`, small.w < base.w);
ok(`still inside the safe area x111..969 (${small.left}..${small.right})`,
  small.left >= 111 && small.right <= 969);
await setSlider("#sizeRange", 100);

await setSlider("#logoRange", 150);
const bigLogo = await tile();
ok(`logo slider grows the logo without changing the button (${base.logo}->${bigLogo.logo}px, button ${bigLogo.w}px)`,
  bigLogo.logo > base.logo && bigLogo.w === base.w);
await setSlider("#logoRange", 100);

await setSlider("#fxRange", 200);
const fx = await tile();
ok(`effect intensity reaches the overlay (--fxi=${fx.fxi})`, parseFloat(fx.fxi) === 2);
await setSlider("#fxRange", 100);

/* --- multi-select button animations --- */
await page.evaluate(() => {
  const pick = (re) => [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(c => re.test(c.querySelector(".name").textContent))?.querySelector("[data-anim]");
  pick(/Edge Glow/)?.click();
});
await page.waitForTimeout(1400);
await page.evaluate(() => {
  const pick = (re) => [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(c => re.test(c.querySelector(".name").textContent))?.querySelector("[data-anim]");
  pick(/Glitch/)?.click();
});
await page.waitForTimeout(1600);
await fetch(`${B}&action=highlight&team=kc&pc=2`);
await ov.waitForTimeout(1500);
const cls = await ov.evaluate(() => document.querySelector("#board").className);
ok(`two effects run at once (${cls})`, /anim-glow/.test(cls) && /anim-glitch/.test(cls));

/* turn them off again */
await page.evaluate(() => {
  const none = [...document.querySelectorAll("#btnAnimGrid .asset")]
    .find(c => /No Button Animation/.test(c.querySelector(".name").textContent));
  none?.querySelector("[data-anim]")?.click();
});
await page.waitForTimeout(1400);
const off = await ov.evaluate(() => document.querySelector("#board").className);
ok("turning all off clears every effect", !/anim-/.test(off));

/* --- AI tab --- */
await page.click('nav button[data-tab="ai"]');
await page.waitForTimeout(1000);
const ai = await page.evaluate(() => ({
  kinds: [...document.querySelectorAll("#aiKind option")].map(o => o.value),
  made: document.querySelectorAll("#aiGrid .asset").length,
}));
ok(`AI tab lists every category (${ai.kinds.length})`, ai.kinds.length === 10);
ok(`AI gallery shows past generations (${ai.made})`, ai.made > 0);
await page.evaluate(() => document.querySelector("#aiGrid [data-ai]").click());
await page.waitForTimeout(800);
const refine = await page.evaluate(() => ({
  open: document.querySelector("#aiRefine").classList.contains("on"),
  buttons: [...document.querySelectorAll("#aiRefine .btn")].map(b => b.textContent.trim().split(" ")[0]),
}));
ok(`clicking one opens Animate / Brandify / custom (${refine.buttons.join(", ")})`,
  refine.open && refine.buttons.some(t => /Animate/.test(t)) &&
  refine.buttons.some(t => /Brandify/.test(t)));
await page.screenshot({ path: "C:/ACBreakz-Cloud/qa/v8-ai-tab.png", clip: { x:0, y:0, width:1400, height:900 } });

await fetch(`${B}&action=highlight_clear&pc=2`);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
