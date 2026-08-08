/* M3 migration — uploads media-staging/ (+ the original .wav) to the Supabase
   `media` bucket and registers rows in `assets`. Idempotent: existing storage
   objects (409) and existing (kind,name) rows are skipped on re-runs. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";

const env = Object.fromEntries(
  readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
const STAGE = "C:/ACBreakz-Cloud/media-staging";
const GFX = "C:/ACBreakz OBS/Graphics";
const pub = (path) => sb.storage.from("media").getPublicUrl(path).data.publicUrl;

const TEAMS = { sf:"49ers", chi:"Bears", cin:"Bengals", buf:"Bills", den:"Broncos",
  cle:"Browns", tb:"Buccaneers", ari:"Cardinals", lac:"Chargers", kc:"Chiefs",
  ind:"Colts", wsh:"Commanders", dal:"Cowboys", mia:"Dolphins", phi:"Eagles",
  atl:"Falcons", nyg:"Giants", jax:"Jaguars", nyj:"Jets", det:"Lions", gb:"Packers",
  car:"Panthers", ne:"Patriots", lv:"Raiders", lar:"Rams", bal:"Ravens", no:"Saints",
  sea:"Seahawks", pit:"Steelers", hou:"Texans", ten:"Titans", min:"Vikings" };

const CT = { webm:"video/webm", png:"image/png", wav:"audio/wav" };
let up = 0, skipped = 0, rows = 0;

async function upload(storagePath, localPath) {
  const ext = storagePath.split(".").pop();
  const { error } = await sb.storage.from("media").upload(storagePath,
    readFileSync(localPath), { contentType: CT[ext], cacheControl: "31536000" });
  if (error) {
    if (/exists|409|duplicate/i.test(error.message)) { skipped++; return pub(storagePath); }
    throw new Error(`upload ${storagePath}: ${error.message}`);
  }
  up++; return pub(storagePath);
}

const { data: existing, error: exErr } = await sb.from("assets").select("kind,name");
if (exErr) throw exErr;
const have = new Set((existing ?? []).map(a => `${a.kind}|${a.name}`));
async function row(kind, name, url, meta) {
  if (have.add(`${kind}|${name}`) && existing?.some(a => a.kind === kind && a.name === name)) return;
  const { error } = await sb.from("assets").insert({ kind, name, url, meta });
  if (error) throw new Error(`row ${name}: ${error.message}`);
  rows++;
}

/* stingers + logos */
for (const [abbr, team] of Object.entries(TEAMS)) {
  const anim = await upload(`animations/${abbr}.webm`, `${STAGE}/animations/${abbr}.webm`);
  await row("animation", `${team} Stinger`, anim, { type: "upload", team: abbr });
  const logo = await upload(`logos/${abbr}.png`, `${STAGE}/logos/${abbr}.png`);
  await row("logo", `${team} logo`, logo, { type: "upload", team: abbr });
  process.stdout.write(abbr + " ");
}
console.log("");

/* sound effect (uploaded straight from the source folder, read-only) */
const sfxUrl = await upload("sfx/team-pick.wav",
  `${GFX}/NFL Teams/Logos/NFL Team Logo Animation/Team Animation Sound Effect.wav`);
await row("sfx", "Team Pick Sound", sfxUrl, { type: "upload", default: true });

/* games */
await row("animation", "Stash or Pass",
  await upload("animations/stash-or-pass.webm", `${STAGE}/games/stash-or-pass.webm`), { type: "upload" });
await row("animation", "Spin 2 Pick 1",
  await upload("animations/spin-2-pick-1.webm", `${STAGE}/games/spin-2-pick-1.webm`), { type: "upload" });

/* backgrounds */
const bgs = [["tv-background.webm","TV Background (loop)"], ["tv-glow.png","TV Glow"],
  ["stadium-lights.png","Stadium Lights"]]; // football-field.png dropped: watermarked stock
let tvBgUrl = null;
for (const [file, name] of bgs) {
  const url = await upload(`backgrounds/${file}`, `${STAGE}/backgrounds/${file}`);
  if (file === "tv-background.webm") tvBgUrl = url;
  await row("background", name, url, { type: "upload" });
}

/* the four banners */
const bans = [["band-navy-steel.png","Band – Navy Steel"], ["nfl-mosaic.png","NFL Mosaic"],
  ["gold-frame.png","Gold Frame"], ["stadium-strip.png","Stadium Strip"]];
for (const [file, name] of bans)
  await row("banner", name, await upload(`banners/${file}`, `${STAGE}/banners/${file}`), { type: "upload" });

/* default live state: TV background + all four banners rotating */
const { data: bannerRows } = await sb.from("assets").select("*").eq("kind", "banner").order("created_at");
const { error: stErr } = await sb.from("stream_state").update({ data: {
  background: { url: tvBgUrl, name: "TV Background (loop)" },
  banners: { rotation: bannerRows ?? [] },
  board: { mode: "fill", visible: true, picked: {} },
  updatedAt: Date.now(),
}}).eq("id", 1);
if (stErr) throw stErr;

console.log(`uploaded ${up}, skipped-existing ${skipped}, asset rows inserted ${rows}`);
console.log("state set: TV background live, 4 banners rotating, board clear");
