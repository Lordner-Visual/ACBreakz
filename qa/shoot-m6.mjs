/* M6 acceptance — hardened posture verified end-to-end on the hosted site:
   anon writes rejected everywhere; keyed panel flow fully works; deck unaffected;
   AI spend gated. */
import { chromium } from "playwright";
import { readFileSync } from "fs";

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(
  readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  "content-type": "application/json" };
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

/* 1 — direct anon writes are dead */
const evIns = await fetch(`${env.SUPABASE_URL}/rest/v1/events`, { method: "POST", headers: REST,
  body: JSON.stringify({ type: "team_pick", payload: { team: "kc" } }) });
ok(`anon events insert rejected (HTTP ${evIns.status})`, evIns.status === 401 || evIns.status === 403);
const stUpd = await fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.1`, { method: "PATCH",
  headers: { ...REST, prefer: "return=minimal" }, body: JSON.stringify({ data: { hacked: true } }) });
const stAfter = await (await fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?select=data&id=eq.1`,
  { headers: REST })).json();
ok(`anon state update ineffective (HTTP ${stUpd.status}, no 'hacked' field)`,
  stAfter[0]?.data?.hacked === undefined);
const upl = await fetch(`${env.SUPABASE_URL}/storage/v1/object/media/hax/evil.txt`, { method: "POST",
  headers: { ...REST, "content-type": "text/plain" }, body: "nope" });
ok(`anon storage upload rejected (HTTP ${upl.status})`, upl.status === 400 || upl.status === 401 || upl.status === 403);

/* 2 — AI spend gate */
const gen = await fetch(`${env.SUPABASE_URL}/functions/v1/generate-asset`, { method: "POST",
  headers: REST, body: JSON.stringify({ kind: "banner", prompt: "x" }) });
ok(`generate-asset without panel key rejected (HTTP ${gen.status})`, gen.status === 401);

/* 3 — deck unaffected */
const deckRes = await (await fetch(
  `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&action=board_reset`)).json();
ok("deck endpoint still works (board_reset ok)", deckRes.ok === true);

/* 4 — panel without key: watch-only */
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const noKey = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await noKey.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await noKey.click('#ctlBoard .team[data-abbr="kc"]');
await noKey.waitForTimeout(1500);
const toast = await noKey.evaluate(() => document.querySelector("#toast").textContent);
ok(`keyless tap blocked with hint ("${toast.trim()}")`, /panel key/i.test(toast));
const pickedAfter = await (await fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?select=data&id=eq.1`,
  { headers: REST })).json();
ok("cloud state unchanged by keyless tap", !pickedAfter[0]?.data?.board?.picked?.kc);
await noKey.screenshot({ path: `${QA}/m6-keyless-blocked.png`, clip: { x: 0, y: 0, width: 1280, height: 780 } });

/* 5 — panel with key: full flow via the Settings UI */
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const panel = await ctx.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await panel.click('nav button[data-tab="settings"]');
await panel.fill("#setPanelKey", env.PANEL_KEY);
await panel.click("#saveKeys");
await panel.waitForLoadState("networkidle");
await panel.waitForTimeout(1500);

const overlay = await ctx.newPage();
await overlay.setViewportSize({ width: 1080, height: 1920 });
await overlay.goto(`${HOSTED}/overlay/?layer=all&pc=2`, { waitUntil: "networkidle" });
await overlay.waitForTimeout(2500);

const t0 = Date.now();
await panel.click('#ctlBoard .team[data-abbr="kc"]');
await overlay.waitForFunction(() =>
  document.querySelectorAll("#board .cell")[window.ACBZ.ORDER.indexOf("kc")].classList.contains("on"),
  null, { timeout: 10000 });
ok(`keyed pick landed on overlay in ${Date.now() - t0} ms`, true);
await panel.screenshot({ path: `${QA}/m6-keyed-pick-works.png`, clip: { x: 0, y: 0, width: 1280, height: 780 } });

/* composer save exercises the signed-upload path */
await panel.click('nav button[data-tab="banners"]');
await panel.fill("#compText", "HARDENED PANEL SIGNED UPLOAD TEST");
await panel.click("#compSave");
const saved = await panel.waitForFunction(() =>
  [...document.querySelectorAll("#bannerGrid .name")].some(n => n.textContent.startsWith("HARDENED PANEL")),
  null, { timeout: 15000 }).then(() => true).catch(() => false);
ok("composer save via signed upload + keyed asset row", saved);

/* cleanup */
await panel.click('nav button[data-tab="board"]');
await panel.click('#ctlBoard .team[data-abbr="kc"]');   // restore
await panel.waitForTimeout(1000);
await browser.close();
console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
