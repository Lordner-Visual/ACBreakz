/* The master panel's Status tab — watch, health-check, break, fix — against PC Test only.

   Runs the three PC Test sources (bg/hud/fx, pc=6) and the master panel in one browser
   profile, the way OBS shares one profile across its sources. Then, using nothing but the
   Status tab's own buttons:

     1. all three PC Test sources show OK from presence alone
     2. a health check gets an answer from every PC Test source over the live connection
     3. make HUD deaf and FX deaf (live frames dropped at the socket): the check catches both —
        HUD does not answer, FX answers only through its backup poll
     4. "Fix PC Test" reloads exactly those sources remotely, re-checks, and reports fixed
     5. close the BG source outright: the tab says it is not running and shows the OBS steps;
        a remote fix cannot reach a closed page, and the tab says THAT too
     6. the history lists what happened

   Health checks ping every online PC. A ping is an event no overlay renders, so this is safe
   while PCs 1-5 are live — but this suite only ever presses Fix on PC Test.

     node qa/shoot-status.mjs [base]     base defaults to the deployed site root  */
import { readFileSync, mkdirSync } from "fs";
import { chromium } from "playwright";

const BASE = (process.argv[2] || "https://lordner-visual.github.io/ACBreakz/").replace(/\/?$/, "/");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
let fails = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${extra ? "   " + extra : ""}`); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(0).padStart(4) + "s";
const SHOTS = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/status-shots";
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.removeItem("acbz-status-log"); } catch (e) {} });

/* one overlay source; `deaf` drops live postgres_changes frames until the page navigates */
async function source(layer) {
  const page = await ctx.newPage();
  page.deaf = false;
  page.on("framenavigated", (fr) => { if (fr === page.mainFrame()) page.deaf = false; });
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (page.deaf && typeof m === "string") {
        try { const a = JSON.parse(m); if ((Array.isArray(a) ? a[3] : a.event) === "postgres_changes") return; } catch (e) {}
      }
      ws.send(m);
    });
    ws.onClose((code, reason) => server.close({ code, reason }));
    server.onClose((code, reason) => ws.close({ code, reason }));
  });
  /* the FX warm is irrelevant here and costs ~200 MB; the background and banners are the
     sources' real work, so they load */
  if (layer === "fx") await page.route(/\/storage\/v1\/object\/.*\.(webm|mp4|mp3|wav|ogg)(\?|$)/i, r => r.abort());
  page.on("console", (m) => { const t = m.text();
    if (t.includes("[acbz]") && !t.includes("warming")) console.log(`    ${stamp()} ${layer.padEnd(3)} ${t.slice(0, 120)}`); });
  await page.goto(`${BASE}staging/overlay/?layer=${layer}&pc=6`, { waitUntil: "load" });
  return page;
}
const src = { bg: await source("bg"), hud: await source("hud"), fx: await source("fx") };

const panel = await ctx.newPage();
panel.on("dialog", (d) => { console.log(`    ${stamp()} panel confirm: ${d.message().split("\n")[0]}`); d.accept(); });
panel.on("pageerror", (e) => { console.log("    PANEL ERROR", e.message); fails++; });
await panel.goto(`${BASE}staging/control/`, { waitUntil: "load" });
if (await panel.isVisible("#lock.on")) {
  await panel.fill("#lockPw", env.PANEL_PASSWORD);
  await panel.click("#lockGo");
  await panel.waitForFunction(() => !document.querySelector("#lock").classList.contains("on"), null, { timeout: 15000 });
}
await panel.click('nav button[data-tab="status"]');
const card = () => panel.locator(".stcard", { has: panel.locator("b", { hasText: /^PC Test$/ }) });
const cardText = async () => (await card().innerText()).replace(/\s+/g, " ");
const srcRow = (label) => card().locator(".stsrc", { hasText: label });
async function waitCard(pred, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = await cardText().catch(() => ""); if (pred(t)) return t; await sleep(1000); }
  const t = await cardText().catch(() => "");
  console.log(`    (timed out waiting for ${what}) card: ${t.slice(0, 400)}`);
  return null;
}
const rowOk = async (label) => (await srcRow(label).innerText()).includes("OK");

/* ---------------- 1. watching ---------------- */
console.log("\n1. presence alone");
const allOk = await waitCard(t => (t.match(/ OK/g) || []).length >= 3 && !/FAILING|WARNING/.test(t), 60000, "three OK rows");
ok("PC Test shows Background, Board & banners and Stingers all OK", !!allOk);
await panel.screenshot({ path: `${SHOTS}/1-watching.png`, fullPage: true });

/* ---------------- 2. health check ---------------- */
console.log("\n2. health check");
await panel.click("#stCheck");
await panel.waitForFunction(() => !document.querySelector("#stCheck").disabled, null, { timeout: 60000 });
let t = await cardText();
ok("every PC Test source answered the health check", (t.match(/answered in/g) || []).length === 3, t.slice(0, 300));
ok("no problems on PC Test after the check", !/FAILING|WARNING/.test(t));
const cloudTxt = await panel.innerText("#stCloud");
ok("cloud checks shown (database, panel function, pages, realtime)",
   /Database: database answered/.test(cloudTxt) && /Panel function: panel function answered/.test(cloudTxt), cloudTxt.replace(/\s+/g, " "));
await panel.screenshot({ path: `${SHOTS}/2-checked.png`, fullPage: true });

/* ---------------- 3. break HUD and FX ---------------- */
console.log("\n3. HUD and FX go deaf");
src.hud.deaf = true; src.fx.deaf = true;
await sleep(2000);
await panel.click("#stCheck");
await panel.waitForFunction(() => !document.querySelector("#stCheck").disabled, null, { timeout: 60000 });
t = await cardText();
ok("HUD flagged: did not answer the health check", /Board & banners: did not answer the health check|did not answer the health check/.test(
   await srcRow("Board & banners").innerText()), (await srcRow("Board & banners").innerText()).replace(/\s+/g, " "));
ok("FX flagged: live updates not reaching it, backup answered",
   /only the backup check answered/.test(await srcRow("Stingers").innerText()), (await srcRow("Stingers").innerText()).replace(/\s+/g, " "));
ok("Background still OK (untouched)", await rowOk("Background"));
ok("a Fix button is offered", await card().locator("[data-stfix]").count() === 1);
ok("the tab badge counts PC Test", /\d/.test(await panel.innerText("#statusBadge")));
await panel.screenshot({ path: `${SHOTS}/3-broken.png`, fullPage: true });

/* ---------------- 4. fix ---------------- */
console.log("\n4. Fix PC Test");
const nav = { bg: 0, hud: 0, fx: 0 };
for (const l of Object.keys(src)) src[l].on("framenavigated", (fr) => { if (fr === src[l].mainFrame()) nav[l]++; });
await card().locator("[data-stfix]").click();
const fixed = await waitCard(t => /Fixed — the remote reload cleared it|The remote reload did not fix it/i.test(t), 120000, "fix result");
ok("the fix reports success", !!fixed && /Fixed — the remote reload cleared it/.test(fixed), (fixed || "").slice(0, 300));
ok("it reloaded exactly HUD and FX, not BG", nav.hud === 1 && nav.fx === 1 && nav.bg === 0, JSON.stringify(nav));
ok("all three OK after the fix", await rowOk("Background") && await rowOk("Board & banners") && await rowOk("Stingers"));
const why = await src.fx.evaluate(() => JSON.parse(localStorage.getItem("acbz-selfreload-6-fx"))?.why);
ok("the FX source recorded a remote reload", /^remote/.test(why ?? ""), why);
await panel.screenshot({ path: `${SHOTS}/4-fixed.png`, fullPage: true });

/* ---------------- 5. a closed source ---------------- */
console.log("\n5. BG closed");
await src.bg.close();
const gone = await waitCard(t => /Background not running in OBS/.test(t), 60000, "BG missing");
ok("Background shows not running in OBS", !!gone);
t = await cardText();
ok("OBS steps name the source and the scene", /“BG” source exists/.test(t) && /ACBreakz Cloud PC Test/.test(t), t.slice(0, 500));
await card().locator("[data-stfix]").click();
const failed = await waitCard(t => /The remote reload did not fix it|Fixed —/i.test(t), 120000, "fix attempt on a closed page");
ok("a remote fix on a closed page reports that it did not work, with steps",
   !!failed && /The remote reload did not fix it/i.test(failed) && /Refresh cache of current page/.test(failed), (failed || "").slice(0, 300));
await panel.screenshot({ path: `${SHOTS}/5-closed.png`, fullPage: true });

/* ---------------- 6. history ---------------- */
console.log("\n6. history");
await card().locator("summary").click();
t = await cardText();
ok("history shows the remote reloads", /remote: fix \(from the control panel\)/.test(t) || /Remote reload sent/.test(t), "");
ok("history shows the failed fix", /Remote reload did not fix/.test(t));
await panel.screenshot({ path: `${SHOTS}/6-history.png`, fullPage: true });

await browser.close();
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
