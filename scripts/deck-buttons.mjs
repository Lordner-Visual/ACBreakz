/* Generate a paste-ready Stream Deck button list with the REAL deck key.
   Output is gitignored — the repo is public, the key must never land in it. */
import { readFileSync, writeFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const BASE = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const TEAMS = { ari:"Cardinals", atl:"Falcons", bal:"Ravens", buf:"Bills", car:"Panthers",
  chi:"Bears", cin:"Bengals", cle:"Browns", dal:"Cowboys", den:"Broncos", det:"Lions",
  gb:"Packers", hou:"Texans", ind:"Colts", jax:"Jaguars", kc:"Chiefs", lac:"Chargers",
  lar:"Rams", lv:"Raiders", mia:"Dolphins", min:"Vikings", ne:"Patriots", no:"Saints",
  nyg:"Giants", nyj:"Jets", phi:"Eagles", pit:"Steelers", sf:"49ers", sea:"Seahawks",
  tb:"Buccaneers", ten:"Titans", wsh:"Commanders" };

const rows = [["Page","Button","Method","URL"]];
for (const [abbr, name] of Object.entries(TEAMS))
  rows.push(["Teams — remove", name, "GET", `${BASE}&action=team_pick&team=${abbr}`]);
for (const [abbr, name] of Object.entries(TEAMS))
  rows.push(["Teams — put back", name, "GET", `${BASE}&action=team_restore&team=${abbr}`]);
for (const [abbr, name] of Object.entries(TEAMS))
  rows.push(["Teams — highlight", name, "GET", `${BASE}&action=highlight_toggle&team=${abbr}`]);
for (const [label, q] of [
  ["Reset board", "action=board_reset"],
  ["Clear highlights", "action=highlight_clear"],
  ["Stash or Pass", "action=play&name=Stash"],
  ["Spin 2 Pick 1", "action=play&name=Spin"],
  ["Skip banner", "action=banner_skip"],
  ["Background: TV loop", "action=set_background&name=TV Background"],
  ["Background: Stadium", "action=set_background&name=Stadium"],
]) rows.push(["Controls", label, "GET", `${BASE}&${q}`]);

const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\r\n");
writeFileSync("C:/ACBreakz-Cloud/streamdeck/buttons.local.csv", csv, "utf8");

const txt = [
  "ACBreakz — Stream Deck button URLs (contains your real DECK_KEY — do not share)",
  "Plugin: install 'Web Requests' (BarRaider) from the Stream Deck store.",
  "Each button = one action: Method GET, paste the URL. No delays, no source names.",
  "Add &pc=2 to any URL to target ONE stream PC; leave it off to hit all five.",
  "",
  ...rows.slice(1).map(r => `[${r[0]}] ${r[1]}\n  ${r[3]}`),
].join("\n");
writeFileSync("C:/ACBreakz-Cloud/streamdeck/buttons.local.txt", txt, "utf8");
console.log(`wrote ${rows.length - 1} button URLs to streamdeck/buttons.local.csv and .txt`);
