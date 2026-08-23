/* Re-upload the extracted frame/fill pair and PROVE they landed.

   A previous republish reported success from uploadToSignedUrl and the files were never
   in the bucket — the asset rows and a live board were left pointing at 400s. Every
   upload here is confirmed against the BUCKET LISTING before anything is repointed, and
   the per-PC copies are updated last.

     node scripts/repair-button-frame.mjs                                               */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const W = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/" +
  "1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/btnwork";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" };
const sb = createClient(env.SUPABASE_URL, ANON);
const panel = (b) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: H, body: JSON.stringify({ key: env.PANEL_KEY, ...b }) }).then(r => r.json());
const rest = (p) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: H }).then(r => r.json());
const list = (prefix) => fetch(`${env.SUPABASE_URL}/storage/v1/object/list/media`, {
  method: "POST", headers: H, body: JSON.stringify({ prefix, limit: 1000 }) }).then(r => r.json());
const sql = (q) => fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
  method: "POST", headers: { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN,
    "content-type": "application/json" }, body: JSON.stringify({ query: q }) })
  .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j; });

const meta = JSON.parse(readFileSync(`${W}/meta.json`, "utf8"));

/** Upload, then confirm against the bucket listing — the SDK reporting no error is not proof. */
const upload = async (local, dir, file, ct) => {
  const path = `${dir}/${file}`;
  const signed = await panel({ action: "sign_upload", path });
  if (signed.error) throw new Error("sign_upload: " + JSON.stringify(signed));
  const bytes = readFileSync(local);
  const { error } = await sb.storage.from("media")
    .uploadToSignedUrl(signed.path, signed.token, bytes,
      { contentType: ct, cacheControl: "31536000", upsert: true });
  if (error) throw new Error("upload: " + error.message);
  const there = (await list(dir)).find(o => o.id && o.name === file);
  if (!there) throw new Error(`upload reported OK but ${path} is NOT in the bucket`);
  const size = Number(there.metadata?.size || 0);
  if (Math.abs(size - bytes.length) > 16)
    throw new Error(`size mismatch: local ${bytes.length}, bucket ${size}`);
  console.log(`  ${path}  ${(size / 1024).toFixed(0)} KB  verified in bucket`);
  return sb.storage.from("media").getPublicUrl(signed.path).data.publicUrl;
};

const stamp = Date.now();
const frameUrl = await upload(`${W}/frame.png`, "button_frame", `${stamp}-Button_2_Frame.png`, "image/png");
const fillUrl = await upload(`${W}/background.png`, "board_button", `${stamp}-Button_2_Fill.png`, "image/png");

/* and confirm they actually serve, since a bucket row is still not a 200 */
for (const u of [frameUrl, fillUrl]) {
  const r = await fetch(u, { headers: { Range: "bytes=0-64" } });
  console.log(`  GET ${u.split("/").pop()} -> ${r.status}`);
  if (!r.ok && r.status !== 206) throw new Error("uploaded file does not serve");
}

const assets = await rest("assets?kind=eq.style&select=id,name,url,meta");
const frameRow = assets.find(a => a.name === "Frame: Button 2" && !a.meta?.deleted);
const fillRow = assets.find(a => a.name === "Buttons: Button 2 fill" && !a.meta?.deleted);
await sql(`update assets set url='${frameUrl}',
           meta = meta || '{"sliceFrac":${meta.sliceFrac}}'::jsonb where id='${frameRow.id}';`);
await sql(`update assets set url='${fillUrl}' where id='${fillRow.id}';`);
console.log(`  rows repointed (frame sliceFrac ${meta.sliceFrac})`);

/* per-PC copies last */
const fresh = await rest("assets?kind=eq.style&select=id,name,url,meta,kind,created_at");
for (const s of await rest("stream_state?select=id,data&order=id")) {
  const d = s.data || {}, patch = {};
  for (const k of ["boardFrame", "boardButtons"]) {
    const cur = d[k]; if (!cur?.id) continue;
    const row = fresh.find(a => a.id === cur.id);
    if (row && row.url !== cur.url) patch[k] = { ...row, meta: { ...(row.meta || {}), crop: cur.meta?.crop ?? row.meta?.crop } };
  }
  if (!Object.keys(patch).length) continue;
  const r = await panel({ action: "patch", pc: s.id, clientId: "repair", patch });
  console.log(`  PC${s.id} -> ${Object.keys(patch).join(", ")}  ${r.ok ? "ok" : JSON.stringify(r)}`);
}
console.log("done.");
