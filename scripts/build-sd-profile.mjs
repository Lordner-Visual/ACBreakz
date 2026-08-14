/* Build one importable Stream Deck profile PER PC (1..5) for the ACBreakz cloud system.
   Every deck key is one API Ninja HTTPS request scoped to that PC, so the profiles are
   independent and portable. Output is gitignored: URLs embed the real DECK_KEY. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync,
         readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import JSZip from "jszip";

/* Elgato writes folder GUIDs uppercase and references them lowercase in JSON */
const guid = () => randomUUID().toUpperCase();

const SRC_PROFILE = process.argv[2];              // extracted existing profile (for icons)
const OUT_ROOT    = "C:/ACBreakz-Cloud/streamdeck";
const SITE        = "https://lordner-visual.github.io/ACBreakz";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;

const TEAMS = [ /* board order: left->right, top row then bottom row */
  ["atl","Falcons"],["phi","Eagles"],["mia","Dolphins"],["dal","Cowboys"],["wsh","Commanders"],
  ["ind","Colts"],["kc","Chiefs"],["lac","Chargers"],["ari","Cardinals"],["sf","49ers"],
  ["tb","Buccaneers"],["cle","Browns"],["den","Broncos"],["buf","Bills"],["cin","Bengals"],
  ["chi","Bears"],["min","Vikings"],["ten","Titans"],["hou","Texans"],["pit","Steelers"],
  ["sea","Seahawks"],["no","Saints"],["lar","Rams"],["lv","Raiders"],["ne","Patriots"],
  ["car","Panthers"],["gb","Packers"],["det","Lions"],["jax","Jaguars"],["nyj","Jets"],
  ["nyg","Giants"],["bal","Ravens"] ];

/* ---- icon sets prepared by scripts/make-icons.mjs from the old profile's art ---- */
const ICONS = "C:/ACBreakz-Cloud/streamdeck/icons";
const iconPath = (set, team) => {
  const p = join(ICONS, set, `${team}.png`);
  return existsSync(p) ? p : null;
};
console.log(`icon sets: normal/x/glow from ${ICONS}`);

/* ---- action builders (every settings shape below was read off real, working files) ---- */
const deckUrl = (q, pc) => `${BASE}&${q.replace(/ /g, "%20")}&pc=${pc}`;

/* Every value below was copied from a button API Ninja built itself. The file fields
   MUST be the sentinel "No file..." — an empty string makes the plugin treat it as a
   real path and null-crash in LoadHeadersAndUserData, which kills every request. */
const NO_FILE = "No file...";
const apiNinja = (url, title) => ({
  ActionID: randomUUID(), LinkedTitle: true, Name: "API Ninja",
  Plugin: { Name: "API Ninja", UUID: "com.barraider.apininja", Version: "1.5.1" },
  Resources: null,
  Settings: {
    url, urlFile: NO_FILE, requestType: "0", contentType: "",
    data: "", dataFile: NO_FILE, headers: "", headersFile: NO_FILE,
    loadFromFiles: false, loadURLFromFiles: false, parseResponse: false,
    responseFormat: "", responseRegex: "", responseRegexFetch: "",
    responseShown: "", responseShownFile: "", saveResponseToFile: false,
    showCustomImages: false, customImageValue: "",
    matchedImage: NO_FILE, unmatchedImage: NO_FILE,
    treatResponseAsImage: false, treatResponseAsText: true, responseImageField: "",
    titlePrefix: "", titleSuffix: "",
    autorunType: "0", autorunMinutes: "",          // EMPTY = no autorun
    debugLogging: false, hideSuccessIndicator: false,
  },
  State: 0,
  States: [ { Title: title ?? "", FontSize: 11, FontFamily: "", FontStyle: "",
              FontUnderline: false, OutlineThickness: 2, ShowTitle: true,
              TitleAlignment: "middle", TitleColor: "#ffffff" } ],
  UUID: "com.barraider.apininja",
});

const obsScene = (scene, title) => ({
  ActionID: randomUUID(), LinkedTitle: true, Name: "Scene",
  Plugin: { Name: "OBS Studio", UUID: "com.elgato.obsstudio", Version: "2.2.9.9" },
  Resources: null,
  Settings: { scene, target: "preview" },
  State: 0, States: [ { Title: title, FSize: "10" }, {} ],
  UUID: "com.elgato.obsstudio.scene",
});
const obsSimple = (uuid, name, title) => ({
  ActionID: randomUUID(), LinkedTitle: true, Name: name,
  Plugin: { Name: "OBS Studio", UUID: "com.elgato.obsstudio", Version: "2.2.9.9" },
  Resources: null, Settings: {},
  State: 0, States: [ { Title: title, FSize: "10" }, {} ],
  UUID: uuid,
});

/* A team / highlight key. Two states so the key can show a second icon after it fires
   (X'd when removed, glowing when highlighted). Both states run the same
   server-authoritative toggle, so the ACTION is always right even if the icon and the
   board drift apart (e.g. after Reset Board).
   The key deliberately STAYS on its page — eliminating several teams in a row is the
   common case, and a second Stream Deck drives page navigation. */
const teamKey = (url, title, imageRel, imageRel2) => {
  const step = () => {
    const req = apiNinja(url);
    req.Settings.isInMultiAction = true;
    return { Actions: [ req ] };
  };
  return {
    ActionID: randomUUID(), Actions: [ step(), step() ],
    LinkedTitle: true, Name: "Multi Action Switch",
    Plugin: { Name: "Multi Action", UUID: "com.elgato.streamdeck.multiactions", Version: "1.0" },
    Resources: null, Settings: {}, State: 0,
    States: [ { Image: imageRel,  Title: "", ShowTitle: false },
              { Image: imageRel2 ?? imageRel, Title: "", ShowTitle: false } ],
    UUID: "com.elgato.streamdeck.multiactions.routine2",
  };
};

const pageGoto = (index, title) => ({
  ActionID: randomUUID(), LinkedTitle: false, Name: "Switch Page",
  Plugin: { Name: "Pages", UUID: "com.elgato.streamdeck.page", Version: "1.0" },
  Resources: null, Settings: { PageIndex: index },
  State: 0, States: [ { Title: title, FSize: "10" } ],
  UUID: "com.elgato.streamdeck.page.goto",
});

/* URLs need the Website action — system.open only handles apps/files/folders.
   Shape copied from a real Website key already on this machine. */
const openUrl = (url, title) => ({
  ActionID: randomUUID(), LinkedTitle: true, Name: "Website",
  Resources: null,
  Settings: { openInBrowser: true, path: url },
  State: 0, States: [ { Title: title, FSize: "9" } ],
  UUID: "com.elgato.streamdeck.system.website",
});

/* ---- build one profile for a given PC ---- */
const COLS = 8;
const pos = (col, row) => `${col},${row}`;

function buildProfile(pc) {
  const OUT_DIR  = `${OUT_ROOT}/build-pc${pc}`;
  const OUT_FILE = `${OUT_ROOT}/ACBreakz Cloud PC${pc}.local.streamDeckProfile`;
  rmSync(OUT_DIR, { recursive: true, force: true });

  const PROFILE_UUID = guid();
  const pageDirs = [];
  const newPage = (build) => {
    const uuid = guid();
    const dir = join(OUT_DIR, "Profiles", `${PROFILE_UUID}.sdProfile`, "Profiles", uuid);
    mkdirSync(join(dir, "Images"), { recursive: true });
    const Actions = build(dir);
    writeFileSync(join(dir, "manifest.json"),
      JSON.stringify({ Controllers: [ { Actions, Type: "Keypad" } ], Icon: "", Name: "" }));
    pageDirs.push(uuid);
  };

  /* page 0 — main */
  newPage((dir) => {
    const A = {};
    /* reuse the old profile's artwork where an equivalent button existed */
    const MAIN_ART = {
      "0,0": "Auction-1", "1,0": "Auction-2", "2,0": "Auction-3", "3,0": "Solo-1",
      "0,1": "STASH-OR-PASS", "1,1": "SPIN-2-PICK-1",
      /* row-2 animations with no art of their own fall back to Stash or Pass */
      "2,1": "anim-default", "3,1": "anim-default",
      "0,2": "Teams", "1,2": "Highlight",
    };
    const art = (name) => {
      const src = join(ICONS, "main", `${name}.png`);
      if (!existsSync(src)) return null;
      const rel = `Images/${name}.png`;
      copyFileSync(src, join(dir, rel));
      return rel;
    };
    const dressUp = () => {
      for (const [key, name] of Object.entries(MAIN_ART)) {
        const rel = A[key] && art(name);
        if (rel) A[key].States[0].Image = rel;
      }
      /* scenes: logo while live, the black tile while that scene is not active */
      const black = art("scene-inactive");
      for (const key of ["0,0", "1,0", "2,0", "3,0"])
        if (A[key]?.States?.[1]) A[key].States[1].Image = black;
      /* nothing may fall back to the plugin's own logo */
      const blank = art("blank");
      for (const k of Object.values(A))
        if (k.UUID === "com.barraider.apininja" && !k.States[0].Image) k.States[0].Image = blank;
    };
    /* row 1: scenes */
    [[`ACBreakz Cloud ${pc}`, `Cloud ${pc}`], ["Archived 1","Archived 1"],
     ["Archived 2","Archived 2"], ["Archived 3","Archived 3"]]
      .forEach(([scene, title], i) => { A[pos(i, 0)] = obsScene(scene, title); });
    /* top right: this PC's own control dashboard */
    A[pos(7, 0)] = openUrl(`${SITE}/control/pc.html?pc=${pc}`, "CONTROL");
    /* row 2: one-shot animations */
    [["Stash or Pass","Stash\nor Pass"], ["Spin 2 Pick 1","Spin 2\nPick 1"],
     ["Spin 3 Pick 1","Spin 3\nPick 1"], ["PYT","PYT"]]
      .forEach(([name, title], i) => {
        /* play_loop is a toggle: press to start the clip looping on stream, press
           again to fade it out. Single-state key — the icon never claims a state
           the server has not confirmed. */
        A[pos(i, 1)] = apiNinja(deckUrl(`action=play_loop&name=${name}`, pc), title);
      });
    /* row 3: page jumps — PageIndex is 1-based (main = 1) — with their resets beneath */
    A[pos(0, 2)] = pageGoto(2, "TEAMS");
    A[pos(1, 2)] = pageGoto(3, "HIGH\nLIGHTS");
    /* OBS recording sits under the control key, right-hand column */
    A[pos(7, 1)] = obsSimple("com.elgato.obsstudio.record", "Record", "RECORD");
    A[pos(7, 2)] = obsSimple("com.elgato.obsstudio.replaybuffer", "Replay Buffer", "START\nREPLAY");
    A[pos(7, 3)] = obsSimple("com.elgato.obsstudio.replaybuffer.save", "Replay Buffer Save", "SAVE\nREPLAY");
    dressUp();
    return A;
  });

  /* pages 2 and 3 — all 32 teams, each firing its request then hopping back to main
     (exactly what the original profile did, which is how 32 teams fit on 32 keys).
     Nested actions need isInMultiAction — without it the step is skipped silently. */
  for (const [action, altSet] of [["team_toggle", "x"], ["highlight_toggle", "glow"]]) {
    newPage((dir) => {
      const A = {};
      TEAMS.forEach(([abbr, name], i) => {
        const put = (set, suffix) => {
          const src = iconPath(set, name);
          if (!src) return "";
          const rel = `Images/${name}${suffix}.png`;
          copyFileSync(src, join(dir, rel));
          return rel;
        };
        A[pos(i % COLS, Math.floor(i / COLS))] =
          teamKey(deckUrl(`action=${action}&team=${abbr}`, pc), name,
            put("normal", ""), put(altSet, "-" + altSet));
      });
      return A;
    });
  }

  const profDir = join(OUT_DIR, "Profiles", `${PROFILE_UUID}.sdProfile`);
  writeFileSync(join(profDir, "manifest.json"), JSON.stringify({
    AppIdentifier: "*",
    Device: { Model: "20GAT9902", UUID: randomUUID() },
    Name: `ACBreakz Cloud PC${pc}`,
    Pages: { Current: "00000000-0000-0000-0000-000000000000",
             Default: pageDirs[0].toLowerCase(),
             Pages: pageDirs.map(p => p.toLowerCase()) },
    Version: "3.0",
  }));
  writeFileSync(join(OUT_DIR, "package.json"), JSON.stringify({
    AppVersion: "7.4.2.22730", DeviceModel: "20GAT9902", DeviceSettings: null,
    FormatVersion: 1, OSType: "Windows", OSVersion: "10.0.26200",
    RequiredPlugins: ["com.barraider.apininja", "com.elgato.obsstudio",
                      "com.elgato.streamdeck.multiactions", "com.elgato.streamdeck.page",
                      "com.elgato.streamdeck.system.open"],
  }));
  return { OUT_DIR, OUT_FILE };
}

/* ---- zip each one (forward slashes + directory entries, as Elgato writes them) ---- */
for (let pc = 1; pc <= 5; pc++) {
  const { OUT_DIR, OUT_FILE } = buildProfile(pc);
  if (existsSync(OUT_FILE)) rmSync(OUT_FILE);
  const zip = new JSZip();
  zip.file("package.json", readFileSync(join(OUT_DIR, "package.json")));
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
  console.log(`built PC${pc}: ${OUT_FILE.split("/").pop()}`);
}
console.log("\npages per profile: Main(14) · Teams(32) · Highlights(32)");
