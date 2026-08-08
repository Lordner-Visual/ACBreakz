/* M4 addendum — AI art in the composer picker (generation already done). */
import { chromium } from "playwright";
const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ok = (n, c) => console.log(`${c ? "PASS" : "FAIL"}  ${n}`);

const browser = await chromium.launch();
const panel = await (await browser.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });
await panel.click('nav button[data-tab="banners"]');
await panel.waitForTimeout(1500);
const aiOpt = await panel.evaluate(() =>
  [...document.querySelectorAll("#compBGs [data-cbg]")].map(d => d.dataset.cbg)
    .find(u => u.includes("/ai-")) ?? null);
ok("AI art present in composer background picker", !!aiOpt);
await panel.click(`#compBGs [data-cbg="${aiOpt}"]`);
await panel.fill("#compText", "AC BREAKZ LIVE NOW BIG BREAKS ALL NIGHT LONG");
await panel.waitForTimeout(1800);
await panel.screenshot({ path: `${QA}/m4-composer-ai-bg.png`, clip: { x: 0, y: 0, width: 1280, height: 560 } });
await browser.close();
console.log("done");
