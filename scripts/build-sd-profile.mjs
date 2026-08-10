/* Build an importable Stream Deck profile for the ACBreakz cloud system.
   - reuses the 32 team icons from the existing profile
   - every key is ONE API Ninja HTTPS request (no OBS scene names, no sceneitemids)
     => the profile is fully portable to any PC
   Output is gitignored: the URLs embed the real DECK_KEY. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync,
         readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";

const SRC_PROFILE = process.argv[2];   // extracted existing profile (for icons)
const OUT_DIR     = "C:/ACBreakz-Cloud/streamdeck/build";
const OUT_FILE    = "C:/ACBreakz-Cloud/streamdeck/ACBreakz Cloud.local.streamDeckProfile";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;

const TEAMS = [ /* board order: left→right, top row then bottom row */
  ["atl","Falcons"],["phi","Eagles"],["mia","Dolphins"],["dal","Cowboys"],["wsh","Commanders"],
  ["ind","Colts"],["kc","Chiefs"],["lac","Chargers"],["ari","Cardinals"],["sf","49ers"],
  ["tb","Buccaneers"],["cle","Browns"],["den","Broncos"],["buf","Bills"],["cin","Bengals"],
  ["chi","Bears"],["min","Vikings"],["ten","Titans"],["hou","Texans"],["pit","Steelers"],
  ["sea","Seahawks"],["no","Saints"],["lar","Rams"],["lv","Raiders"],["ne","Patriots"],
  ["car","Panthers"],["gb","Packers"],["det","Lions"],["jax","Jaguars"],["nyj","Jets"],
  ["nyg","Giants"],["bal","Ravens"] ];

/* ---- find each team's icon in the existing profile ---- */
const pages = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e === "manifest.json") {
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (j.Controllers?.some(c => c.Actions && Object.keys(c.Actions).length))
        pages.push({ dir: dirname(p), j });
    }
  }
})(SRC_PROFILE);

const icons = new Map();
for (const { dir, j } of pages)
  for (const a of Object.values(j.Controllers[0].Actions ?? {})) {
    const img = a.States?.[0]?.Image;
    const blob = JSON.stringify(a.Settings ?? {}) + " " + (a.States?.[0]?.Title ?? "");
    for (const [, name] of TEAMS)
      if (!icons.has(name) && img && new RegExp(`\\b${name}\\b`, "i").test(blob)) {
        const abs = join(dir, img);
        if (existsSync(abs)) icons.set(name, abs);
      }
  }
console.log(`icons matched: ${icons.size}/32`);

/* ---- action builders ---- */
const apiNinja = (url, title) => ({
  ActionID: randomUUID(),
  LinkedTitle: false,
  Name: "API Ninja",
  Plugin: { Name: "API Ninja", UUID: "com.barraider.apininja", Version: "1.0" },
  Resources: null,
  Settings: {
    url, requestType: "0", contentType: "", responseShown: "",
    titlePrefix: "", titleSuffix: "",
    autorunType: "0", autorunMinutes: "5",
    parseResponse: false, loadFromFiles: false, loadURLFromFiles: false,
    saveResponseToFile: false, showCustomImages: false, treatResponseAsImage: false,
  },
  State: 0,
  States: [ { Title: title ?? "", FFamily: "", FSize: "12" } ],
  UUID: "com.barraider.apininja",
});

const pageGoto = (index, title) => ({
  ActionID: randomUUID(),
  LinkedTitle: false,
  Name: "Switch Page",
  Plugin: { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" },
  Resources: null,
  Settings: { PageIndex: index },
  State: 0,
  States: [ { Title: title, FSize: "12" } ],
  UUID: "com.elgato.streamdeck.page.goto",
});

/* team key: Multi Action Switch — press 1 removes the team, press 2 puts it back */
const teamToggle = (abbr, name, imageRel) => ({
  ActionID: randomUUID(),
  Actions: [
    { Actions: [ apiNinja(`${BASE}&action=team_pick&team=${abbr}`) ] },
    { Actions: [ apiNinja(`${BASE}&action=team_restore&team=${abbr}`) ] },
  ],
  LinkedTitle: true,
  Name: "Multi Action Switch",
  Plugin: { Name: "Multi Action", UUID: "com.elgato.streamdeck.multiactions", Version: "1.0" },
  Resources: null,
  Settings: {},
  State: 0,
  States: [ { Image: imageRel, Title: name, FSize: "10" },
            { Image: imageRel, Title: name + " ↩", FSize: "10" } ],
  UUID: "com.elgato.streamdeck.multiactions.routine2",
});

/* ---- lay out the pages (Stream Deck XL: 8 x 4) ---- */
const COLS = 8;
const pos = (i) => `${i % COLS},${Math.floor(i / COLS)}`;

const pageDirs = [];
function newPage(build) {
  const uuid = randomUUID();
  const dir = join(OUT_DIR, "Profiles", `${PROFILE_UUID}.sdProfile`, "Profiles", uuid);
  mkdirSync(join(dir, "Images"), { recursive: true });
  const Actions = build(dir);
  writeFileSync(join(dir, "manifest.json"),
    JSON.stringify({ Controllers: [ { Actions, Type: "Keypad" } ], Icon: "", Name: "" }));
  pageDirs.push(uuid);
  return uuid;
}

const PROFILE_UUID = randomUUID();
rmSync(OUT_DIR, { recursive: true, force: true });

/* page 0 — Teams: tap to remove, tap again to put back */
newPage((dir) => {
  const A = {};
  TEAMS.forEach(([abbr, name], i) => {
    let rel = "";
    const src = icons.get(name);
    if (src) { rel = `Images/${name}.png`; copyFileSync(src, join(dir, rel)); }
    A[pos(i)] = teamToggle(abbr, name, rel);
  });
  return A;
});

/* page 1 — Highlight: tap a team to star it (button animations play only on starred) */
newPage((dir) => {
  const A = {};
  TEAMS.forEach(([abbr, name], i) => {
    let rel = "";
    const src = icons.get(name);
    if (src) { rel = `Images/${name}.png`; copyFileSync(src, join(dir, rel)); }
    const a = apiNinja(`${BASE}&action=highlight_toggle&team=${abbr}`, name);
    a.States[0].Image = rel;
    A[pos(i)] = a;
  });
  return A;
});

/* page 2 — Controls */
newPage(() => {
  const A = {};
  const ctrl = [
    ["Reset\nBoard",        "action=board_reset"],
    ["Clear\nHighlights",   "action=highlight_clear"],
    ["Stash or\nPass",      "action=play&name=Stash"],
    ["Spin 2\nPick 1",      "action=play&name=Spin"],
    ["Skip\nBanner",        "action=banner_skip"],
    ["BG: TV\nLoop",        "action=set_background&name=TV Background"],
    ["BG:\nStadium",        "action=set_background&name=Stadium"],
  ];
  ctrl.forEach(([title, q], i) => { A[pos(i)] = apiNinja(`${BASE}&${q}`, title); });
  A[pos(24)] = pageGoto(0, "◀ Teams");
  A[pos(25)] = pageGoto(1, "Highlight");
  return A;
});

/* ---- profile + package manifests ---- */
const profDir = join(OUT_DIR, "Profiles", `${PROFILE_UUID}.sdProfile`);
writeFileSync(join(profDir, "manifest.json"), JSON.stringify({
  AppIdentifier: "*",
  Device: { Model: "20GAT9902", UUID: "" },      // blank = bind to any XL on import
  Name: "ACBreakz Cloud",
  Pages: { Current: "00000000-0000-0000-0000-000000000000",
           Default: pageDirs[0], Pages: pageDirs },
  Version: "3.0",
}));
writeFileSync(join(OUT_DIR, "package.json"), JSON.stringify({
  AppVersion: "7.4.2.22730", DeviceModel: "20GAT9902", DeviceSettings: null,
  FormatVersion: 1, OSType: "Windows", OSVersion: "10.0.26200",
  RequiredPlugins: ["com.barraider.apininja", "com.elgato.streamdeck.multiactions",
                    "com.elgato.streamdeck.page"],
}));

/* ---- zip it (let the icon writes settle first; Compress-Archive trips over
       freshly-written files, so use .NET's ZipFile directly) ---- */
if (existsSync(OUT_FILE)) rmSync(OUT_FILE);
await new Promise(r => setTimeout(r, 1500));
execFileSync("powershell", ["-NoProfile", "-Command",
  `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
  `[System.IO.Compression.ZipFile]::CreateFromDirectory('${OUT_DIR.replace(/\//g,"\\")}', ` +
  `'${OUT_FILE.replace(/\//g,"\\")}')`]);
console.log(`\nbuilt: ${OUT_FILE}`);
console.log(`pages: Teams(32 toggle) · Highlight(32) · Controls(9)`);
