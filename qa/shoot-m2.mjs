/* M2 acceptance — hosted on GitHub Pages, cloud mode.
   Two ISOLATED browser contexts (no shared storage = two devices):
   "phone" opens /control/, "laptop" opens /overlay/. Fire a Seahawks pick
   from the phone, measure how long until the laptop overlay slot fills. */
import { chromium } from "playwright";

const HOSTED = process.env.HOSTED_URL || "https://lordner-visual.github.io/ACBreakz";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const browser = await chromium.launch();

/* "laptop" — overlay */
const laptop = await browser.newContext({ viewport: { width: 1080, height: 1920 } });
const overlay = await laptop.newPage();
const sockets = [];
overlay.on("websocket", (ws) => sockets.push(ws.url()));
await overlay.goto(`${HOSTED}/overlay/?layer=all&debug=1&pc=2`, { waitUntil: "networkidle" });

/* "phone" — control panel */
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
});
const panel = await phone.newPage();
await panel.goto(`${HOSTED}/control/`, { waitUntil: "networkidle" });

await overlay.waitForTimeout(3500); // let realtime subscriptions settle
const presence = await panel.textContent("#presence");
console.log(`control presence: "${presence.trim()}"`);
console.log(`overlay websockets: ${sockets.filter(u => u.includes("realtime")).join(", ") || sockets.join(", ") || "NONE"}`);

const seaIdx = await overlay.evaluate(() => window.ACBZ.ORDER.indexOf("sea"));
const off = await overlay.evaluate((i) =>
  !document.querySelectorAll("#board .cell")[i].classList.contains("on"), seaIdx);
console.log(`sea slot empty before pick: ${off}`);
await overlay.screenshot({ path: `${QA}/m2-overlay-before.png` });

/* pick from the phone, time until the laptop overlay fills the slot */
const t0 = Date.now();
await panel.tap('#ctlBoard .team[data-abbr="sea"]');
await overlay.waitForFunction(
  (i) => document.querySelectorAll("#board .cell")[i].classList.contains("on"),
  seaIdx, { timeout: 10000 });
const ms = Date.now() - t0;
console.log(`${ms < 1000 ? "PASS" : "FAIL"}  phone pick -> laptop overlay slot filled in ${ms} ms`);

await panel.screenshot({ path: `${QA}/m2-phone-panel.png` });
await overlay.waitForTimeout(1200); // catch the burst FX mid-flight
await overlay.screenshot({ path: `${QA}/m2-overlay-after-pick.png` });

/* leave a clean board: restore the pick from the phone */
await panel.tap('#ctlBoard .team[data-abbr="sea"]');
await overlay.waitForFunction(
  (i) => !document.querySelectorAll("#board .cell")[i].classList.contains("on"),
  seaIdx, { timeout: 10000 });
console.log("board restored to empty");

await browser.close();
console.log("done");
