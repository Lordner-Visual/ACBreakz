import { chromium } from "playwright";
const browser = await chromium.launch();
const ov = await (await browser.newContext({ viewport:{width:1080,height:1920} })).newPage();
ov.on("pageerror", e => console.log("OVERLAY PAGE ERROR:", e.message));
ov.on("console", m => { if (m.type()==="error") console.log("overlay console error:", m.text()); });
await ov.goto("https://lordner-visual.github.io/ACBreakz/overlay/?layer=all&pc=2", { waitUntil:"networkidle" });
await ov.waitForTimeout(4000);
console.log(await ov.evaluate(() => ({
  boardClasses: document.querySelector("#board").className,
  gapVar: getComputedStyle(document.querySelector("#board")).gap,
  pcType: typeof window.ACBZ.DEVICE, pc: window.ACBZ.DEVICE,
})));
await browser.close();
