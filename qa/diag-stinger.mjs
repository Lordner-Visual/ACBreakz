/* Why isn't the stinger video playing on the overlay? Watch #fxVideo through a pick. */
import { chromium } from "playwright";
import { readFileSync } from "fs";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ov = await (await browser.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
const errs = [];
ov.on("pageerror", e => errs.push("PAGEERROR: " + e.message));
ov.on("console", m => { if (m.type() === "error") errs.push("CONSOLE: " + m.text()); });
ov.on("requestfailed", r => { if (/\.webm|\.wav/.test(r.url())) errs.push("REQFAIL: " + r.url().split("/").pop() + " " + r.failure()?.errorText); });

await ov.goto(`https://lordner-visual.github.io/ACBreakz/overlay/?layer=all&pc=1`, { waitUntil: "networkidle" });
await ov.waitForTimeout(3000);

/* instrument the fx video so we can see exactly what happens */
await ov.evaluate(() => {
  window.__fx = [];
  const v = document.querySelector("#fxVideo");
  ["loadstart","loadeddata","play","playing","error","stalled","ended","abort","emptied"]
    .forEach(ev => v.addEventListener(ev, () => window.__fx.push(
      `${ev} src=${(v.currentSrc||"").split("/").pop()} display=${v.style.display} err=${v.error?.code ?? "-"}`)));
});

await fetch(`${B}&action=team_toggle&team=sea`);
await ov.waitForTimeout(5000);

const r = await ov.evaluate(() => {
  const v = document.querySelector("#fxVideo");
  return { events: window.__fx, display: v.style.display, src: (v.currentSrc||"").split("/").pop(),
    readyState: v.readyState, networkState: v.networkState, err: v.error?.code ?? null,
    currentTime: v.currentTime, paused: v.paused,
    cellOn: document.querySelectorAll("#board .cell.on").length };
});
console.log(JSON.stringify(r, null, 1));
if (errs.length) console.log("\nerrors:\n" + errs.join("\n"));
await ov.screenshot({ path: "C:/ACBreakz-Cloud/qa/diag-stinger.png" });
await fetch(`${B}&action=board_reset`);
await browser.close();
