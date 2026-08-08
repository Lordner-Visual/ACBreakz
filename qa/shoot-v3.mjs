/* V3 acceptance — hosted site.
   1 tabs: AI Generate gone, SoundFX added, generator strip on every media tab
   2 banners: upload at top, no quick-text banner
   3 SoundFX tab owns Team Pick Sound; it's gone from Animations
   4 Link SoundFX popup: "No SoundFX" first, preview + link, persists on the asset
   5 delete: two-step "Are you sure?" confirm, then the asset is really gone
   6 board style: three independent pickers, mix and match, per-PC
   7 button animation: ambient effect classes on the board; trigger effect on a hit cell
   8 AI sound generation (one paid sound ~$0.05) */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const DECK = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });

const panel = await ctx.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "domcontentloaded" });
await panel.evaluate((k) => { localStorage.setItem("acbz-panel-key", k); localStorage.setItem("acbz-pc", "2"); }, env.PANEL_KEY);
await panel.reload({ waitUntil: "networkidle" });
await panel.waitForTimeout(2500);

/* ---- 1: tab structure + generator strips ---- */
const tabs = await panel.evaluate(() => [...document.querySelectorAll("nav button")].map(b => b.textContent.trim()));
ok(`AI Generate tab removed, SoundFX added (${tabs.join(" | ")})`,
  !tabs.includes("AI Generate") && tabs.includes("SoundFX"));
const bars = await panel.evaluate(() =>
  ["anims","sfx","banners","bgs","style"].map(t => ({
    tab: t, bar: !!document.querySelector(`#tab-${t} .aibar`),
    sel: !!document.querySelector(`#tab-${t} .aibar select`) })));
ok("every media tab has an AI generator strip",
  bars.every(b => b.bar));
ok(`type dropdown only on multi-type tabs (${bars.filter(b=>b.sel).map(b=>b.tab).join(", ")})`,
  bars.find(b=>b.tab==="anims").sel && bars.find(b=>b.tab==="bgs").sel &&
  bars.find(b=>b.tab==="style").sel && !bars.find(b=>b.tab==="sfx").sel &&
  !bars.find(b=>b.tab==="banners").sel);
const styleOpts = await panel.evaluate(() =>
  [...document.querySelectorAll("#styleGenKind option")].map(o => o.textContent.trim()));
ok(`board-style generator offers the 4 requested options (${styleOpts.join(", ")})`,
  ["Background image","Background animation","Button style","Button animation"]
    .every(o => styleOpts.includes(o)));

/* ---- 2: banners tab order + no quick text ---- */
await panel.click('nav button[data-tab="banners"]');
const ban = await panel.evaluate(() => {
  const sec = document.querySelector("#tab-banners");
  const heads = [...sec.querySelectorAll("h2")].map(h => h.textContent.trim());
  return { first: heads[0], quick: !!document.querySelector("#txtBanner"),
    uploadTop: sec.querySelector("label.up") === sec.querySelector("h2 + .row label.up") };
});
ok(`upload banner is the first section ("${ban.first}")`, /upload banner/i.test(ban.first));
ok("quick text banner removed", !ban.quick);

/* ---- 3: SoundFX tab owns the pick sound ---- */
await panel.click('nav button[data-tab="sfx"]');
await panel.waitForTimeout(500);
const sfxTab = await panel.evaluate(() => ({
  sounds: [...document.querySelectorAll("#sfxGrid .name")].map(n => n.textContent),
  inAnims: [...document.querySelectorAll("#oneshotGrid .name")].map(n => n.textContent),
}));
ok(`Team Pick Sound lives in SoundFX (${sfxTab.sounds.join(", ")})`,
  sfxTab.sounds.some(n => /Team Pick Sound/.test(n)));
ok("sounds no longer listed in Animations", !sfxTab.inAnims.some(n => /Team Pick Sound/.test(n)));

/* ---- 8: AI-generated sound in the library.
   The generation round-trip itself was run once against the deployed function
   (fal stable-audio takes 1-4 min, too slow to re-spend on every QA pass). ---- */
const madeSound = await panel.evaluate(() =>
  [...document.querySelectorAll("#sfxGrid .name")].some(n => n.textContent.startsWith("AI:")));
ok("AI sound effect generated and listed", madeSound);
const soundUrl = await panel.evaluate(() => {
  const cards = [...document.querySelectorAll("#sfxGrid .asset")];
  const c = cards.find(x => x.querySelector(".name").textContent.startsWith("AI:"));
  return c?.querySelector("[data-prevsfx]")?.dataset.prevsfx ?? null;
});
if (soundUrl) {
  const head = await fetch(soundUrl, { method: "GET", headers: { range: "bytes=0-63" } });
  ok(`generated sound is real audio in our storage (${head.headers.get("content-type")})`,
    head.ok && /audio/.test(head.headers.get("content-type") ?? ""));
}
await panel.screenshot({ path: `${QA}/v3-soundfx-tab.png`, clip: { x: 0, y: 0, width: 1280, height: 700 } });

/* ---- 4: Link SoundFX popup ---- */
await panel.click('nav button[data-tab="anims"]');
await panel.waitForTimeout(600);
await panel.evaluate(() => document.querySelector("#styleGrid [data-sfx]").click());
await panel.waitForTimeout(600);
const pick = await panel.evaluate(() => ({
  open: document.querySelector("#sfxPick").classList.contains("on"),
  first: document.querySelector("#sfxList .sfxrow .nm")?.textContent.trim(),
  rows: document.querySelectorAll("#sfxList .sfxrow").length,
  previews: document.querySelectorAll("#sfxList [data-prev]").length,
}));
ok("Link SoundFX opens a picker popup", pick.open);
ok(`"No SoundFX" is the first option (${pick.rows} rows, ${pick.previews} previewable)`,
  pick.first === "No SoundFX" && pick.previews >= 1);
await panel.screenshot({ path: `${QA}/v3-link-soundfx.png`, clip: { x: 240, y: 40, width: 800, height: 560 } });
/* link the AI sound to the Classic Stingers style */
await panel.evaluate(() => {
  const rows = [...document.querySelectorAll("#sfxList .sfxrow")];
  const r = rows.find(x => x.querySelector(".nm").textContent.startsWith("AI:"));
  (r ?? rows[1]).querySelector("[data-link]").click();
});
await panel.waitForTimeout(2500);
const linked = await panel.evaluate(() => {
  document.querySelector("#sfxClose").click();
  const card = document.querySelector("#styleGrid .asset");
  return card.querySelector(".link")?.textContent ?? null;
});
ok(`link persists on the style card (${linked})`, /🔊/.test(linked ?? ""));
/* and the deck sends that sound on a pick */
const ovPc2 = await ctx.newPage();
await ovPc2.setViewportSize({ width: 1080, height: 1920 });
await ovPc2.goto(`${HOSTED}/overlay/?layer=all&pc=2`, { waitUntil: "networkidle" });
await ovPc2.waitForTimeout(2500);
await fetch(`${DECK}&action=team_pick&team=gb&pc=2`);
await ovPc2.waitForTimeout(2000);
const ev = await (await fetch(`${env.SUPABASE_URL}/rest/v1/events?select=payload&order=created_at.desc&limit=1`,
  { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } })).json();
ok(`deck pick uses the linked sound (${(ev[0]?.payload?.sfxUrl ?? "none").split("/").pop()})`,
  !!ev[0]?.payload?.sfxUrl?.includes("/sfx/ai-"));

/* ---- 6+7: board style parts, mix and match, per-PC ---- */
await panel.click('nav button[data-tab="style"]');
await panel.waitForTimeout(800);
const grids = await panel.evaluate(() => ({
  buttons: [...document.querySelectorAll("#btnStyleGrid .name")].map(n=>n.textContent),
  bgs: [...document.querySelectorAll("#bgStyleGrid .name")].map(n=>n.textContent),
  anims: [...document.querySelectorAll("#btnAnimGrid .name")].map(n=>n.textContent),
}));
ok(`buttons and background are separate pickers (${grids.buttons.length} button styles, ${grids.bgs.length} backgrounds)`,
  grids.buttons.length >= 1 && grids.bgs.length >= 1);
ok(`button animations available (${grids.anims.join(", ")})`,
  grids.anims.some(n=>/Edge Glow/.test(n)) && grids.anims.some(n=>/Pop & Slam/.test(n)));

/* mix: gunmetal buttons (from V2) + builtin board background */
await panel.evaluate(() => {
  const cards = [...document.querySelectorAll("#btnStyleGrid .asset")];
  const c = cards.find(x => /gunmetal|Buttons:/i.test(x.querySelector(".name").textContent)) ?? cards[0];
  c.querySelector("[data-part]").click();
});
await panel.waitForTimeout(1500);
/* ambient button animation */
await panel.evaluate(() => {
  const cards = [...document.querySelectorAll("#btnAnimGrid .asset")];
  cards.find(x => /Edge Glow/.test(x.querySelector(".name").textContent)).querySelector("[data-part]").click();
});
const glowOn = await ovPc2.waitForFunction(() =>
  document.querySelector("#board").classList.contains("anim-glow"),
  null, { timeout: 15000 }).then(() => true).catch(() => false);
ok("ambient button animation (Edge Glow) applied to every button on PC2", glowOn);
await ovPc2.waitForTimeout(1400);
await ovPc2.screenshot({ path: `${QA}/v3-board-mixed.png`, clip: { x: 0, y: 460, width: 1080, height: 220 } });

/* trigger animation on a hit */
await panel.evaluate(() => {
  const cards = [...document.querySelectorAll("#btnAnimGrid .asset")];
  cards.find(x => /Pop & Slam/.test(x.querySelector(".name").textContent)).querySelector("[data-part]").click();
});
await panel.waitForTimeout(1500);
await fetch(`${DECK}&action=team_pick&team=chi&pc=2`);
const popped = await ovPc2.waitForFunction(() =>
  document.querySelector("#board .cell.fx-pop") !== null || document.querySelectorAll("#board .dust").length > 0,
  null, { timeout: 12000 }).then(() => true).catch(() => false);
ok("trigger button animation (Pop & Slam + dust) fires on the hit team", popped);
await ovPc2.screenshot({ path: `${QA}/v3-button-pop.png`, clip: { x: 0, y: 460, width: 1080, height: 220 } });

/* PC1 unaffected */
const ovPc1 = await ctx.newPage();
await ovPc1.setViewportSize({ width: 1080, height: 1920 });
await ovPc1.goto(`${HOSTED}/overlay/?layer=all&pc=1`, { waitUntil: "networkidle" });
await ovPc1.waitForTimeout(2500);
const pc1 = await ovPc1.evaluate(() => ({
  cls: document.querySelector("#board").className,
  btn: document.querySelector("#board .cell").style.backgroundImage }));
ok("PC1 board style untouched by PC2 changes", !/anim-/.test(pc1.cls) && pc1.btn === "");

/* ---- 5: delete with confirm ---- */
await panel.click('nav button[data-tab="banners"]');
await panel.waitForTimeout(600);
/* make a throwaway banner to delete */
await panel.fill("#compText", "V3 DELETE TEST BANNER");
await panel.click("#compSave");
await panel.waitForFunction(() =>
  [...document.querySelectorAll("#bannerGrid .name")].some(n => n.textContent.startsWith("V3 DELETE TEST")),
  null, { timeout: 20000 });
const delId = await panel.evaluate(() => {
  const c = [...document.querySelectorAll("#bannerGrid .asset")]
    .find(x => x.querySelector(".name").textContent.startsWith("V3 DELETE TEST"));
  return c.querySelector("[data-del]").dataset.del;
});
await panel.click(`#bannerGrid [data-del="${delId}"]`);
await panel.waitForTimeout(300);
const armed = await panel.evaluate((id) =>
  document.querySelector(`[data-del="${id}"]`).textContent.trim(), delId);
ok(`first click asks for confirmation ("${armed}")`, /are you sure/i.test(armed));
const stillThere = await panel.evaluate(() =>
  [...document.querySelectorAll("#bannerGrid .name")].some(n => n.textContent.startsWith("V3 DELETE TEST")));
ok("asset still present before confirming", stillThere);
await panel.click(`#bannerGrid [data-del="${delId}"]`);
const gone = await panel.waitForFunction(() =>
  ![...document.querySelectorAll("#bannerGrid .name")].some(n => n.textContent.startsWith("V3 DELETE TEST")),
  null, { timeout: 20000 }).then(() => true).catch(() => false);
ok("second click deletes the asset", gone);
const row = await (await fetch(`${env.SUPABASE_URL}/rest/v1/assets?select=id&id=eq.${delId}`,
  { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } })).json();
ok("asset row removed from the database", Array.isArray(row) && row.length === 0);
/* built-ins are protected */
const protectedOk = await panel.evaluate(() => {
  document.querySelector('nav button[data-tab="style"]').click();
  const cards = [...document.querySelectorAll("#btnAnimGrid .asset")];
  const c = cards.find(x => /Pop & Slam/.test(x.querySelector(".name").textContent));
  return !c.querySelector("[data-del]");
});
ok("built-in styles have no Delete button", protectedOk);
await panel.screenshot({ path: `${QA}/v3-board-style-tab.png`, clip: { x: 0, y: 0, width: 1280, height: 900 } });

/* ---- cleanup: restore PC2 ---- */
await fetch(`${DECK}&action=team_restore&team=gb&pc=2`);
await fetch(`${DECK}&action=team_restore&team=chi&pc=2`);
await panel.evaluate(() => {
  const un = (grid, re) => { const c = [...document.querySelectorAll(`${grid} .asset`)]
    .find(x => re.test(x.querySelector(".name").textContent)); c?.querySelector("[data-part]")?.click(); };
  un("#btnAnimGrid", /No Button Animation/);
});
await panel.waitForTimeout(800);
await panel.evaluate(() => {
  const c = [...document.querySelectorAll("#btnStyleGrid .asset")]
    .find(x => /Gold Buttons/.test(x.querySelector(".name").textContent));
  c?.querySelector("[data-part]")?.click();
});
await panel.waitForTimeout(1200);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
