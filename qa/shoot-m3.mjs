/* M3 acceptance — real assets over the wire on the HOSTED overlay:
   deck team_pick plays the real Seahawks webm + real .wav, storage logos render,
   and the four banners rotate on the 7-12s rules (10s each for uploads). */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(
  readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const DECK = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const ok = (n, c) => console.log(`${c ? "PASS" : "FAIL"}  ${n}`);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
const overlay = await ctx.newPage();
await overlay.goto(`${HOSTED}/overlay/?layer=all&debug=1&pc=3`, { waitUntil: "networkidle" });
await overlay.waitForTimeout(3000);

/* storage logos on the control panel (all 32 from the media bucket) */
const panel = await ctx.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await panel.waitForTimeout(1500);
const logoStats = await panel.evaluate(() => {
  const imgs = [...document.querySelectorAll("#ctlBoard .team img")];
  return { total: imgs.length,
    fromStorage: imgs.filter(i => i.src.includes("/storage/v1/object/public/media/logos/")).length,
    loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length };
});
ok(`panel logos from storage bucket (${logoStats.fromStorage}/32) all loaded (${logoStats.loaded}/32)`,
  logoStats.fromStorage === 32 && logoStats.loaded === 32);
await panel.screenshot({ path: `${QA}/m3-panel-storage-logos.png` });
await panel.close();

/* background + banner live state */
const live = await overlay.evaluate(() => ({
  bg: document.querySelector("#bgFrame video")?.src ?? null,
  banner: (document.querySelector("#banners .b.live img") ?? {}).src ?? null,
}));
ok("TV background webm playing from storage", !!live.bg?.includes("/media/backgrounds/tv-background.webm"));
ok("a storage banner is live", !!live.banner?.includes("/media/banners/"));

/* deck pick -> real stinger + real sound */
const t0 = Date.now();
const res = await (await fetch(`${DECK}&action=team_pick&team=sea`)).json();
ok("deck team_pick sea -> ok:true", res.ok === true);
await overlay.waitForFunction(() =>
  document.querySelector("#fxVideo").style.display === "block" &&
  document.querySelector("#fxVideo").src.includes("/media/animations/sea.webm"), null, { timeout: 8000 });
console.log(`stinger started ${Date.now() - t0} ms after deck call`);
const sfxPayload = await overlay.evaluate(() => window.__lastSfx ?? null); // not instrumented; assert via event row below
await overlay.waitForTimeout(1200);
await overlay.screenshot({ path: `${QA}/m3-stinger-playing.png` });
const playing = await overlay.evaluate(() => {
  const v = document.querySelector("#fxVideo");
  return { visible: v.style.display === "block", time: v.currentTime, src: v.src };
});
ok(`real Seahawks webm is mid-play (t=${playing.time.toFixed(2)}s)`, playing.visible && playing.time > 0);

/* the event payload carried the real sfx wav */
const evs = await (await fetch(`${env.SUPABASE_URL}/rest/v1/events?select=type,payload&order=created_at.desc&limit=1`,
  { headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } })).json();
ok("event payload sfxUrl is the real team-pick.wav",
  evs[0]?.payload?.sfxUrl?.includes("/media/sfx/team-pick.wav") === true);
ok("event payload animUrl is the storage stinger",
  evs[0]?.payload?.animUrl?.includes("/media/animations/sea.webm") === true);

await overlay.waitForFunction(() => document.querySelector("#fxVideo").style.display === "none",
  null, { timeout: 10000 });
const seaOn = await overlay.evaluate(() =>
  document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("sea")].classList.contains("on"));
ok("board slot filled after stinger", seaOn);
await overlay.screenshot({ path: `${QA}/m3-after-stinger.png` });

/* banner rotation: collect distinct banners over 42s (4 uploads x 10s each) */
const seen = new Set();
const rotT0 = Date.now();
while (Date.now() - rotT0 < 42000) {
  const src = await overlay.evaluate(() =>
    (document.querySelector("#banners .b.live img") ?? {}).src ?? null);
  if (src) seen.add(src.split("/").pop());
  await overlay.waitForTimeout(1500);
}
console.log("banners seen in 42s:", [...seen].join(", "));
ok("all four banners rotated within 42s (10s each per upload rule)", seen.size === 4);
await overlay.screenshot({ path: `${QA}/m3-banner-rotation.png` });

/* cleanup */
await fetch(`${DECK}&action=team_restore&team=sea`);
await browser.close();
console.log("done");
