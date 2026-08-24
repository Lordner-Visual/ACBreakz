/* Acceptance: the composer background list is identical on the master panel and every
   PC dashboard, and a master delete removes it from the PCs too.
   The list is derived from the shared assets table (hideComposer on the row), so there
   is no per-PC copy to migrate — identical predicates are the whole contract. */
import { chromium } from "playwright";
import { readFileSync } from "fs";
/* refuses to run while a live PC looks busy — these suites mutate the production rows */
import { assertIdle } from "./lib/live-guard.mjs";
await assertIdle();

const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });

/* master */
const m = await ctx.newPage();
await m.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await m.fill("#lockPw", env.PANEL_PASSWORD);
await m.click("#lockGo");
await m.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await m.click('nav button[data-tab="banners"]');
await m.waitForTimeout(2500);
const names = (page) => page.evaluate(() =>
  [...document.querySelectorAll("#compBGs .asset .name")].map(n => n.textContent.trim()));
const master = await names(m);
console.log(`master composer: ${master.length} cards — ${JSON.stringify(master)}\n`);

/* every PC dashboard must show exactly the same list */
for (const pc of [1, 2, 3, 4, 5, 6]) {
  const p = await ctx.newPage();
  await p.goto(`${HOSTED}/control/pc.html?pc=${pc}`, { waitUntil: "networkidle" });
  await p.waitForSelector("#ctlBoard .team", { timeout: 20000 });
  await p.click('nav button[data-tab="banners"]');
  await p.waitForTimeout(1800);
  const got = await names(p);
  const extra = got.filter(x => !master.includes(x));
  const missing = master.filter(x => !got.includes(x));
  ok(`PC${pc} composer matches master (${got.length} cards` +
     `${extra.length ? ", EXTRA: " + JSON.stringify(extra) : ""}` +
     `${missing.length ? ", MISSING: " + JSON.stringify(missing) : ""})`,
    extra.length === 0 && missing.length === 0);
  await p.close();
}

/* a master composer delete must disappear from the PCs as well */
const probe = await panel({ action: "asset", asset: { kind: "banner", name: "composer-sync-probe",
  url: `${env.SUPABASE_URL}/storage/v1/object/public/media/banners/_probe.png`, meta: { type: "ai" } } });
ok("probe banner created", !!probe.asset?.id);

const pcPage = await ctx.newPage();
await pcPage.goto(`${HOSTED}/control/pc.html?pc=3`, { waitUntil: "networkidle" });
await pcPage.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await pcPage.click('nav button[data-tab="banners"]');
await pcPage.waitForTimeout(2000);
ok("probe shows on PC3 before the delete", (await names(pcPage)).includes("composer-sync-probe"));

/* exactly what the master panel's composer Delete does to an art-only asset */
await panel({ action: "delete_asset", id: probe.asset.id });
await pcPage.reload({ waitUntil: "networkidle" });
await pcPage.waitForSelector("#ctlBoard .team", { timeout: 20000 });
await pcPage.click('nav button[data-tab="banners"]');
await pcPage.waitForTimeout(2000);
ok("after the master delete it is gone from PC3", !(await names(pcPage)).includes("composer-sync-probe"));

await panel({ action: "purge_asset", id: probe.asset.id });     // clean up the probe row
await browser.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
