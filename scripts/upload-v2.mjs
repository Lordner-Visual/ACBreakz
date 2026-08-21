/* Upload media-staging/v2/* to animations/v2/ via the keyed panel sign_upload flow. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

async function panel(body) {
  const { data, error } = await sb.functions.invoke("panel", { body: { key: env.PANEL_KEY, ...body } });
  if (error || data?.error) throw new Error(error?.message ?? data.error);
  return data;
}

const DIR = "C:/ACBreakz-Cloud/media-staging/v2";
for (const f of readdirSync(DIR)) {
  const signed = await panel({ action: "sign_upload", path: `animations/v2/${f}` });
  const { error } = await sb.storage.from("media")
    .uploadToSignedUrl(signed.path, signed.token, readFileSync(`${DIR}/${f}`), { contentType: "video/webm", cacheControl: "31536000" });
  if (error) throw new Error(`${f}: ${error.message}`);
  process.stdout.write(f.replace(".webm", "") + " ");
}
console.log("\nall v2 files uploaded");
