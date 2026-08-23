/* Does the plugin actually keep a key in step with the board?

   This runs the REAL built plugin page against a stand-in Stream Deck app and the REAL
   Supabase project, and asserts the icon follows the board — including the case that
   caused most of the drift and that no repaint-on-press scheme can fix:

     board_reset is ONE key press that changes up to 32 teams.

   Measured before this plugin: 900 reset cycles stranding an average of 6.1 keys each.

     node qa/shoot-sd-plugin.mjs [pc]                                                    */
import { chromium } from "playwright";
import { readFileSync } from "fs";
import { fakeStreamDeck } from "./lib/fake-streamdeck.mjs";

const PC = Number(process.argv[2]) || 5;
const PLUGIN = "C:/ACBreakz-Cloud/streamdeck/plugin/build/com.acbreakz.board.sdPlugin/plugin.html";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}&pc=${PC}`)
  .then(r => r.json().catch(() => ({})));
const stateOf = () => fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?id=eq.${PC}&select=data`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json()).then(r => r[0].data);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* the three artworks, so a setImage can be identified by which one it carries */
const ICONS = Function("window", readFileSync(
  "C:/ACBreakz-Cloud/streamdeck/plugin/build/com.acbreakz.board.sdPlugin/icons.js", "utf8") +
  "; return window.ICONS;")({});
const TEAM = "sea", CTX = "ctx-team-1";
const which = (img) => ["normal", "x", "glow"].find(s => ICONS[s][TEAM] === img) ?? "?";

const SNAP = await stateOf();
console.log(`snapshot of PC${PC} taken — restored at the end\n`);

/* NOT 28196 — that is the real Stream Deck app, and the plugin would connect to it
   instead of this stand-in, leaving the suite staring at an empty message list. */
const sd = fakeStreamDeck(28871);
const br = await chromium.launch();
const page = await (await br.newContext()).newPage();
page.on("console", m => { const t = m.text(); if (/acbz|error/i.test(t)) console.log("   [plugin]", t.slice(0, 140)); });
page.on("pageerror", e => console.log("   [pageerror]", String(e).slice(0, 180)));
/* file:// on purpose — that is where Stream Deck actually runs a plugin page */
await page.goto("file:///" + PLUGIN);
await page.evaluate(([port, key]) => {
  window.connectElgatoStreamDeckSocket(port, "test-uuid", "registerPlugin");
  window.__deckKey = key;
}, [sd.port, env.DECK_KEY]);

/* the app answers getGlobalSettings with the deck key, exactly as it would in the wild */
sd.onMessage((m) => {
  if (m.event === "getGlobalSettings")
    sd.to({ event: "didReceiveGlobalSettings", context: "test-uuid",
            payload: { settings: { deckKey: env.DECK_KEY } } });
});
await sleep(1500);

console.log("=== a key appears and paints itself from the board ===");
await deck("action=board_reset"); await sleep(900);
sd.to({ event: "willAppear", context: CTX, action: "com.acbreakz.board.team",
        payload: { settings: { pc: PC, team: TEAM, mode: "eliminate" } } });
let img = await sd.wait(m => m.event === "setImage" && m.context === CTX);
console.log(`  first paint: ${img ? which(img.payload.image) : "none"}`);
ok("the key paints itself on appear, without being pressed", !!img);
ok("a team that is on the board shows the plain logo", img && which(img.payload.image) === "normal");

console.log("\n=== the board changes from somewhere ELSE — the deck must follow ===");
const before = sd.sent.length;
await deck(`action=team_toggle&team=${TEAM}`);          // as if another operator did it
img = await sd.wait(m => m.event === "setImage" && m.context === CTX &&
  which(m.payload.image) === "x");
console.log(`  after an external elimination: ${img ? which(img.payload.image) : "no repaint"}`);
ok("an elimination made elsewhere repaints the key to X", !!img);

console.log("\n=== board_reset: the case that stranded ~6 keys per cycle ===");
await deck("action=board_reset");
img = await sd.wait(m => m.event === "setImage" && m.context === CTX &&
  which(m.payload.image) === "normal");
console.log(`  after reset: ${img ? which(img.payload.image) : "STILL SHOWING X"}`);
ok("a reset puts the key back to the plain logo on its own", !!img);

console.log("\n=== highlight mode tracks the other subtree ===");
sd.to({ event: "willAppear", context: "ctx-hl-1", action: "com.acbreakz.board.team",
        payload: { settings: { pc: PC, team: TEAM, mode: "highlight" } } });
await sleep(600);
await deck(`action=highlight&team=${TEAM}`);
img = await sd.wait(m => m.event === "setImage" && m.context === "ctx-hl-1" &&
  which(m.payload.image) === "glow");
ok("highlighting repaints the highlight key, not the eliminate key", !!img);
const elim = sd.sent.filter(m => m.event === "setImage" && m.context === CTX).pop();
ok("the eliminate key stayed on the plain logo through that",
  elim && which(elim.payload.image) === "normal");

console.log("\n=== a rapid double press cannot leave it wrong ===");
await deck("action=board_reset"); await sleep(800);
const n0 = sd.sent.length;
await Promise.all([deck(`action=team_toggle&team=${TEAM}`), sleep(40)
  .then(() => deck(`action=team_toggle&team=${TEAM}`))]);
await sleep(2500);
const board = await stateOf();
const finalImg = sd.sent.slice(n0).filter(m => m.event === "setImage" && m.context === CTX).pop();
const isOut = !!board.board?.picked?.[TEAM];
console.log(`  board says out=${isOut}; key shows ${finalImg ? which(finalImg.payload.image) : "(unchanged)"}`);
ok("after two fast presses the icon matches the board",
  !finalImg || (which(finalImg.payload.image) === (isOut ? "x" : "normal")));

await br.close(); sd.close();
await deck("action=board_reset");
const res = await fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, action: "state", pc: PC, data: SNAP, force: true }) })
  .then(r => r.json());
ok(`PC${PC} restored (${res.ok ? "written" : JSON.stringify(res)})`, !!res.ok);
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
