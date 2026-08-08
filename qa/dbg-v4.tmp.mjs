import { chromium } from "playwright";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport:{width:1280,height:1000} })).newPage();
p.on("pageerror", e => console.log("PAGE ERROR:", e.message));
p.on("console", m => { if (m.type()==="error") console.log("console error:", m.text()); });
await p.goto("https://lordner-visual.github.io/ACBreakz/control/", { waitUntil:"domcontentloaded" });
await p.evaluate((k)=>{localStorage.setItem("acbz-panel-key",k);localStorage.setItem("acbz-pc","2");}, env.PANEL_KEY);
await p.reload({ waitUntil:"networkidle" });
await p.waitForTimeout(2500);
await p.click('nav button[data-tab="style"]');
await p.waitForTimeout(800);
console.log(await p.evaluate(() => ({
  cards: document.querySelectorAll("#gridStyleGrid .asset").length,
  btns: document.querySelectorAll("#gridStyleGrid [data-grid]").length,
  hasHandler: !!document.querySelector('[data-grid="checker"]')?.onclick,
})));
p.on("response", r => { if (r.url().includes("/functions/v1/panel")) console.log("panel call ->", r.status()); });
await p.evaluate(() => document.querySelector('[data-grid="checker"]').click());
await p.waitForTimeout(3000);
console.log("toast:", await p.evaluate(() => document.querySelector("#toast").textContent));
await browser.close();
