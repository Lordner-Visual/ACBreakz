/* Upload the V4 re-encodes + folder poster, repoint the one-shot assets, and
   attach the poster to the Classic Stingers folder card. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
const panel = async (body) => {
  const { data, error } = await sb.functions.invoke("panel", { body: { key: env.PANEL_KEY, ...body } });
  if (error || data?.error) throw new Error(error?.message ?? data.error);
  return data;
};
const DIR = "C:/ACBreakz-Cloud/media-staging/v4";

async function up(path, file, contentType) {
  const signed = await panel({ action: "sign_upload", path });
  const { error } = await sb.storage.from("media")
    .uploadToSignedUrl(signed.path, signed.token, readFileSync(`${DIR}/${file}`), { contentType, cacheControl: "31536000" });
  if (error) throw new Error(`${file}: ${error.message}`);
  return sb.storage.from("media").getPublicUrl(signed.path).data.publicUrl;
}

const stamp = Date.now();
const spin  = await up(`animations/v4/spin-2-pick-1-${stamp}.webm`, "spin-2-pick-1.webm", "video/webm");
const stash = await up(`animations/v4/stash-or-pass-${stamp}.webm`, "stash-or-pass.webm", "video/webm");
const poster = await up(`styles/classic-stingers-poster-${stamp}.png`, "classic-stingers-poster.png", "image/png");
console.log("uploaded 3 files");

const { data: assets } = await sb.from("assets").select("*");
const find = (kind, re) => (assets ?? []).find(a => a.kind === kind && re.test(a.name));

/* folder poster for the 32-video Classic Stingers style (meta merge via the panel fn) */
const cs = find("style", /Classic Stingers/i);
if (cs) { await panel({ action: "update_asset", id: cs.id, meta: { poster } });
  console.log("poster attached to", cs.name); }

/* url repoints need service role -> emit SQL for the Management API */
writeFileSync("C:/ACBreakz-Cloud/supabase/repoint-v4.sql",
  `-- V4: point the boxed one-shots at the content-cropped encodes\n` +
  `update public.assets set url = '${spin}'  where kind='animation' and name ilike '%Spin 2 Pick 1%';\n` +
  `update public.assets set url = '${stash}' where kind='animation' and name ilike '%Stash or Pass%';\n`);
console.log("wrote supabase/repoint-v4.sql");
