/* V2 addendum — re-check the boxed one-shot after the inset-order fix. */
import { chromium } from "playwright";
import { readFileSync } from "fs";
const HOSTED = "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ov = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
await ov.goto(`${HOSTED}/overlay/?layer=all&debug=1&pc=3`, { waitUntil: "networkidle" });
await ov.waitForTimeout(2500);
await fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&action=play&name=Spin&pc=3`);
await ov.waitForFunction(() => document.querySelector("#fxVideo").style.display === "block",
  null, { timeout: 10000 });
await ov.waitForTimeout(2500);
const box = await ov.evaluate(() => {
  const r = document.querySelector("#fxVideo").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log(`${box.x === 207 && box.y === 800 && box.w === 667 && box.h === 413 ? "PASS" : "FAIL"}  Spin 2 Pick 1 inside ANIM 667x413 @ (207,800) [got ${box.w}x${box.h} @ (${box.x},${box.y})]`);
await ov.screenshot({ path: `${QA}/v2-oneshot-boxed.png` });
await browser.close();
console.log("done");
