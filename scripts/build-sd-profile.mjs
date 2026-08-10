/* Build an importable Stream Deck profile for the ACBreakz cloud system.
   - reuses the 32 team icons from the existing profile
   - every key is ONE API Ninja HTTPS request (no OBS scene names, no sceneitemids)
     => the profile is fully portable to any PC
   Output is gitignored: the URLs embed the real DECK_KEY. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync,
         readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import JSZip from "jszip";

/* Elgato writes folder GUIDs uppercase and references them lowercase in JSON */
const guid = () => randomUUID().toUpperCase();

const SRC_PROFILE = process.argv[2];   // extracted existing profile (for icons)
const OUT_DIR     = "C:/ACBreakz-Cloud/streamdeck/build";
const OUT_FILE    = "C:/ACBreakz-Cloud/streamdeck/ACBreakz Cloud.local.streamDeckProfile";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;

const TEAMS = [ /* board order: leftâ†’right, top row then bottom row */
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
/* spaces (and friends) in query values must be percent-encoded or the request dies */
const deckUrl = (query) => `${BASE}&${query.replace(/ /g, "%20")}`;
const apiNinja = (url, title) => ({
  ActionID: randomUUID(),
  LinkedTitle: false,
  Name: "API Ninja",
  Plugin: { Name: "API Ninja", UUID: "com.barraider.apininja", Version: "1.0" },
  Resources: null,
  /* EVERY key the property inspector defines must be present â€” the plugin trims
     these strings on load, and a missing one throws (Stream Deck shows âš ). */
  Settings: {
    url, urlFile: "",
    requestType: "0",                 // 0 = GET
    contentType: "",
    data: "", dataFile: "",
    headers: "", headersFile: "",
    loadFromFiles: false, loadURLFromFiles: false,
    parseResponse: false,
    responseFormat: "", responseRegex: "", responseRegexFetch: "",
    responseShown: "", responseShownFile: "",
    saveResponseToFile: false,
    showCustomImages: false, customImageValue: "",
    matchedImage: "", unmatchedImage: "",
    treatResponseAsImage: false, treatResponseAsText: false, responseImageField: "",
    titlePrefix: "", titleSuffix: "",
    /* Autorun is a plain number box: EMPTY = off. "0" means "every 0 minutes", which
       makes the plugin fire in a loop and crash in its own autorun code path. */
    autorunType: "0", autorunMinutes: "",
    debugLogging: false, hideSuccessIndicator: false,
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

/* team key: ONE plain request. The server reads the live board and decides whether
   this press removes the team or puts it back, so the key can never fall out of sync
   (a stateful Multi Action Switch drifts the moment you use Reset Board). */
const teamToggle = (abbr, name, imageRel) => {
  const a = apiNinja(deckUrl(`action=team_toggle&team=${abbr}`), name);
  a.States[0].Image = imageRel;
  a.States[0].FSize = "10";
  return a;
};

/* ---- lay out the pages (Stream Deck XL: 8 x 4) ---- */
const COLS = 8;
const pos = (i) => `${i % COLS},${Math.floor(i / COLS)}`;

const pageDirs = [];
function newPage(build) {
  const uuid = guid();
  const dir = join(OUT_DIR, "Profiles", `${PROFILE_UUID}.sdProfile`, "Profiles", uuid);
  mkdirSync(join(dir, "Images"), { recursive: true });
  const Actions = build(dir);
  writeFileSync(join(dir, "manifest.json"),
    JSON.stringify({ Controllers: [ { Actions, Type: "Keypad" } ], Icon: "", Name: "" }));
  pageDirs.push(uuid);
  return uuid;
}

const PROFILE_UUID = guid();
const DEVICE_UUID = randomUUID();
rmSync(OUT_DIR, { recursive: true, force: true });

/* page 0 â€” Teams: tap to remove, tap again to put back */
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

/* page 1 â€” Highlight: tap a team to star it (button animations play only on starred) */
newPage((dir) => {
  const A = {};
  TEAMS.forEach(([abbr, name], i) => {
    let rel = "";
    const src = icons.get(name);
    if (src) { rel = `Images/${name}.png`; copyFileSync(src, join(dir, rel)); }
    const a = apiNinja(deckUrl(`action=highlight_toggle&team=${abbr}`), name);
    a.States[0].Image = rel;
    A[pos(i)] = a;
  });
  return A;
});

/* page 2 â€” Controls */
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
  ctrl.forEach(([title, q], i) => { A[pos(i)] = apiNinja(deckUrl(q), title); });
  A[pos(24)] = pageGoto(0, "Teams");
  A[pos(25)] = pageGoto(1, "Highlight");
  return A;
});

/* ---- profile + package manifests ---- */
const profDir = join(OUT_DIR, "Profiles", `${PROFILE_UUID}.sdProfile`);
writeFileSync(join(profDir, "manifest.json"), JSON.stringify({
  AppIdentifier: "*",
  Device: { Model: "20GAT9902", UUID: DEVICE_UUID },
  Name: "ACBreakz Cloud",
  Pages: { Current: "00000000-0000-0000-0000-000000000000",
           Default: pageDirs[0].toLowerCase(),
           Pages: pageDirs.map(p => p.toLowerCase()) },
  Version: "3.0",
}));
writeFileSync(join(OUT_DIR, "package.json"), JSON.stringify({
  AppVersion: "7.4.2.22730", DeviceModel: "20GAT9902", DeviceSettings: null,
  FormatVersion: 1, OSType: "Windows", OSVersion: "10.0.26200",
  RequiredPlugins: ["com.barraider.apininja", "com.elgato.streamdeck.multiactions",
                    "com.elgato.streamdeck.page"],
}));

/* ---- zip it ----
   Entry names MUST use forward slashes. PowerShell's ZipFile (.NET Framework) writes
   backslashes on Windows, which Stream Deck silently refuses to import, so build the
   archive here and mirror Elgato's layout: explicit directory entries included. */
if (existsSync(OUT_FILE)) rmSync(OUT_FILE);
const zip = new JSZip();
zip.file("package.json", readFileSync(join(OUT_DIR, "package.json")));   // Elgato lists it first
(function add(dir, prefix) {
  for (const e of readdirSync(dir).sort()) {
    if (!prefix && e === "package.json") continue;
    const p = join(dir, e);
    const name = prefix ? `${prefix}/${e}` : e;
    if (statSync(p).isDirectory()) { zip.folder(name); add(p, name); }
    else zip.file(name, readFileSync(p));
  }
})(OUT_DIR, "");
writeFileSync(OUT_FILE, await zip.generateAsync({ type: "nodebuffer",
  compression: "DEFLATE", compressionOptions: { level: 6 } }));
console.log(`\nbuilt: ${OUT_FILE}`);
console.log(`pages: Teams(32 toggle) Â· Highlight(32) Â· Controls(9)`);
