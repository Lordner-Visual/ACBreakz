/* M0 acceptance proof — preview mode, same browser context (BroadcastChannel).
   Opens control panel + overlay, taps Seahawks, screenshots before/burst/after,
   and asserts the debug-guide geometry from the layout key. */
import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE = "http://localhost:8080";
const QA = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(QA, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 } });

const overlay = await ctx.newPage();
await overlay.goto(`${BASE}/overlay/?layer=all&debug=1`, { waitUntil: "networkidle" });

const control = await ctx.newPage();
await control.setViewportSize({ width: 900, height: 1400 });
await control.goto(`${BASE}/control/`, { waitUntil: "networkidle" });

/* fresh slate in case of leftover localStorage */
await control.evaluate(() => { localStorage.removeItem("acbz-state"); localStorage.removeItem("acbz-assets"); });
await control.reload({ waitUntil: "networkidle" });
await overlay.reload({ waitUntil: "networkidle" });
await overlay.waitForTimeout(1500); // let ESPN logos land

/* ---- geometry checks on the overlay ---- */
const geom = await overlay.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom }; };
  const burst = getComputedStyle(document.querySelector("#burst"));
  return {
    board: r("#board"), banners: r("#banners"),
    burstBox: { left: burst.left, top: burst.top, w: burst.width, h: burst.height },
    guides: [...document.querySelectorAll("#debug div")].map(d => d.textContent.trim()),
  };
});
const ok = (name, cond) => console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
ok("board band at y=480 (1080x165)", geom.board.y === 480 && geom.board.h === 165 && geom.board.w === 1080);
ok("banner band at y=645 (1080x97)", geom.banners.y === 645 && geom.banners.h === 97);
ok("banner band bottom edge y=742", geom.banners.bottom === 742);
ok("ANIM/burst box 667x413 @ (207,800)",
  geom.burstBox.left === "207px" && geom.burstBox.top === "800px" &&
  geom.burstBox.w === "667px" && geom.burstBox.h === "413px");
console.log("debug guides drawn:", geom.guides.join(" | "));

const overlayLogos = await overlay.evaluate(() =>
  [...document.querySelectorAll("#board .cell img")].filter(i => i.complete && i.naturalWidth > 0).length);
console.log(`overlay board logos loaded: ${overlayLogos}/32`);

await overlay.screenshot({ path: `${QA}/m0-overlay-before.png` });

/* ---- tap Seahawks on the control panel ---- */
await control.click('#ctlBoard .team[data-abbr="sea"]');
await control.screenshot({ path: `${QA}/m0-control-after-pick.png` });

await overlay.waitForTimeout(1100);           // mid-burst (burst runs ~2.6s)
await overlay.screenshot({ path: `${QA}/m0-overlay-burst.png` });

await overlay.waitForTimeout(2200);           // burst finished
const seaOn = await overlay.evaluate(() => {
  const cells = document.querySelectorAll("#board .cell");
  const order = window.ACBZ.ORDER; const i = order.indexOf("sea");
  return cells[i].classList.contains("on");
});
ok("Seahawks board slot filled (.on)", seaOn);
await overlay.screenshot({ path: `${QA}/m0-overlay-after.png` });

await browser.close();
console.log("done — screenshots in /qa/");
