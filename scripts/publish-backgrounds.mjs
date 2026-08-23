/* Publish the re-encoded backgrounds produced by scripts/reencode-backgrounds.mjs.

   Uploads under NEW timestamped paths (never overwriting, so the originals stay as a
   rollback), repoints each asset row's url, and then patches every PC whose background
   selection pointed at the old file.

   Per-PC state stores a COPY of the asset row, so updating the assets table alone
   changes nothing on screen — the patch step is what actually swaps the background. That
   ordering is deliberate: upload and library updates are harmless, and the visible change
   happens last, one PC at a time, through the row-locked state_patch so a concurrent deck
   press cannot be clobbered.

     node scripts/publish-backgrounds.mjs --dry     # show what would happen
     node scripts/publish-backgrounds.mjs --pc 5    # library + PC5 only (verify first)
     node scripts/publish-backgrounds.mjs           # library + every PC                */
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const W = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/" +
  "1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/bgwork";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" };
const sb = createClient(env.SUPABASE_URL, ANON);

const DRY = process.argv.includes("--dry");
const onlyPc = process.argv.includes("--pc")
  ? Number(process.argv[process.argv.indexOf("--pc") + 1]) : null;

const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST", headers: H, body: JSON.stringify({ key: env.PANEL_KEY, ...body }) })
  .then(r => r.json());
const sql = (q) => fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
  method: "POST",
  headers: { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN, "content-type": "application/json" },
  body: JSON.stringify({ query: q }) }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
    return j;
  });

const MB = (n) => (n / 1048576).toFixed(2);
const upload = async (localPath, storagePath, contentType) => {
  const signed = await panel({ action: "sign_upload", path: storagePath });
  if (signed.error) throw new Error("sign_upload: " + JSON.stringify(signed));
  const { error } = await sb.storage.from("media").uploadToSignedUrl(
    signed.path, signed.token, readFileSync(localPath),
    { contentType, cacheControl: "31536000" });
  if (error) throw new Error("upload: " + error.message);
  return sb.storage.from("media").getPublicUrl(signed.path).data.publicUrl;
};

/* ---- map each re-encoded file back to its asset row ---- */
const assets = await fetch(`${env.SUPABASE_URL}/rest/v1/assets?kind=eq.background&select=id,name,url,meta`,
  { headers: H }).then(r => r.json());
const states = await fetch(`${env.SUPABASE_URL}/rest/v1/stream_state?select=id,data&order=id`,
  { headers: H }).then(r => r.json());

/* Match on the storage basename WITHOUT its extension: the Poltergeist background was
   .mp4 and comes back as .webm, so an exact filename compare misses it. */
const stem = (u) => decodeURIComponent(String(u).split("/").pop() || "").replace(/\.[^.]+$/, "");
const jobs = [];
for (const f of readdirSync(`${W}/new`)) {
  if (f.startsWith("Background_2")) continue;              // a new asset, handled separately
  const row = assets.find(a => a.url && stem(a.url) === stem(f));
  if (!row) { console.log(`  ! no asset row for ${f} — skipping`); continue; }
  /* keep the OLD url: the per-PC selection stores {url, crop, name} with no id, so the
     url is the only way to tell which PCs are showing this file */
  jobs.push({ file: f, row, oldUrl: row.url, local: `${W}/new/${f}` });
}

console.log(`=== ${jobs.length} re-encoded background(s) to publish ===`);
for (const j of jobs) {
  j.users = states.filter(s => s.data?.background?.url === j.oldUrl).map(s => s.id);
  const was = assets.find(a => a.id === j.row.id);
  console.log(`  ${MB(statSync(j.local).size).padStart(7)} MB  ${String(j.row.name).padEnd(34)}` +
    (j.users.length ? `LIVE on PC${j.users.join(", PC")}` : "not selected"));
}
if (DRY) { console.log("\n--dry: nothing uploaded."); process.exit(0); }

/* --patch-only: the files are already uploaded and the library rows already repointed
   (e.g. a previous run did --pc 5 to verify). Match PCs by NAME here, because their
   stored url is still the OLD one and the row's url is already the new one. */
if (process.argv.includes("--patch-only")) {
  for (const s of states) {
    if (onlyPc && s.id !== onlyPc) continue;
    const bg = s.data?.background;
    if (!bg) continue;
    const row = assets.find(a => a.name === bg.name);
    if (!row || row.url === bg.url) { console.log(`  PC${s.id} already current`); continue; }
    const res = await panel({ action: "patch", pc: s.id, clientId: "publish-bg",
      patch: { background: { ...bg, url: row.url } } });
    console.log(`  PC${s.id} -> ${row.name}  ${res.ok ? "ok" : JSON.stringify(res)}`);
  }
  process.exit(0);
}

/* ---- 1. upload + repoint the library row (invisible to the overlays) ---- */
const stamp = Date.now();
for (const j of jobs) {
  const clean = j.file.replace(/^\d+-/, "");
  const path = `background/${stamp}-${clean}`;
  const ct = /\.webm$/i.test(clean) ? "video/webm"
    : /\.mp4$/i.test(clean) ? "video/mp4" : "image/png";
  j.url = await upload(j.local, path, ct);
  await sql(`update assets set url = '${j.url.replace(/'/g, "''")}' where id = '${j.row.id}';`);
  console.log(`  uploaded  ${j.row.name}`);
}

/* ---- 2. swap what each PC is actually showing ---- */
for (const s of states) {
  if (onlyPc && s.id !== onlyPc) continue;
  const bg = s.data?.background;
  if (!bg) continue;
  const j = jobs.find(x => x.oldUrl === bg.url);      // matched by url — there is no id here
  if (!j) continue;
  const next = { ...bg, url: j.url };                 // keep the operator's crop/pan exactly
  const res = await panel({ action: "patch", pc: s.id, clientId: "publish-bg",
    patch: { background: next } });
  console.log(`  PC${s.id} -> ${j.row.name}  ${res.ok ? "ok" : JSON.stringify(res)}`);
}
console.log("\nOriginals left in storage for rollback. Verify, then they can be purged.");
