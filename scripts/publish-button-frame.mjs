/* Publish an extracted frame/background pair, and split the old welded "Gold Buttons"
   builtin into its two halves.

   The Apply handler in the control pages stores NULL for any builtin with no effect
   ("use the CSS default"). That matters here: "No Button Frame" must be effect-less so it
   stores null and genuinely turns the frame off, while the gold bezel must carry an
   effect so it stores a real object — otherwise choosing it would read as "off".

   Every PC then gets boardFrame written EXPLICITLY, so the panel's Applied state and the
   overlay agree. Without that a PC sits on undefined, which the overlay treats as "keep
   what you had" but the panel would draw as "No Frame".

     node scripts/publish-button-frame.mjs --dry
     node scripts/publish-button-frame.mjs                                              */
import { readFileSync, existsSync } from "fs";
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
const DRY = process.argv.includes("--dry");

const panel = (b) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST", headers: H, body: JSON.stringify({ key: env.PANEL_KEY, ...b }) }).then(r => r.json());
const sql = (q) => fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
  method: "POST",
  headers: { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN, "content-type": "application/json" },
  body: JSON.stringify({ query: q }) }).then(async r => {
    const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300)); return j; });
const rest = (p) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, { headers: H }).then(r => r.json());

const meta = JSON.parse(readFileSync(`${W}/meta.json`, "utf8"));
const label = meta.label;
console.log(`publishing "${label}"  sliceFrac=${meta.sliceFrac}`);

const states = await rest("stream_state?select=id,data&order=id");
const assets = await rest("assets?kind=eq.style&select=id,name,meta");
const gold = assets.find(a => a.meta?.builtin && a.meta?.domain === "board_button");
console.log(`existing builtin to repurpose as the fill: ${gold ? JSON.stringify(gold.name) : "NOT FOUND"}`);
console.log("per-PC boardFrame to write:");
for (const s of states)
  console.log(`  PC${s.id}: ${s.data?.boardButtons?.url ? "null (has a custom texture)" : "Gold Bezel"}`);
if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }

const upload = async (local, path, ct) => {
  const signed = await panel({ action: "sign_upload", path });
  if (signed.error) throw new Error(JSON.stringify(signed));
  const { error } = await sb.storage.from("media").uploadToSignedUrl(signed.path, signed.token,
    readFileSync(local), { contentType: ct, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return sb.storage.from("media").getPublicUrl(signed.path).data.publicUrl;
};

/* 1 + 2: the extracted pair */
const stamp = Date.now();
const frameUrl = await upload(`${W}/frame.png`,
  `button_frame/${stamp}-${label.replace(/\W+/g, "_")}_Frame.png`, "image/png");
await panel({ action: "asset", asset: { kind: "style", name: `Frame: ${label}`, url: frameUrl,
  meta: { type: "upload", domain: "button_frame", sliceFrac: meta.sliceFrac } } });
console.log(`  frame      -> ${frameUrl.split("/").pop()}`);

const fillUrl = await upload(`${W}/background.png`,
  `board_button/${stamp}-${label.replace(/\W+/g, "_")}_Fill.png`, "image/png");
await panel({ action: "asset", asset: { kind: "style", name: `Buttons: ${label} fill`, url: fillUrl,
  meta: { type: "upload", domain: "board_button" } } });
console.log(`  fill       -> ${fillUrl.split("/").pop()}`);

/* 3: the old builtin was the FILL half; rename it to say so */
if (gold) {
  await sql(`update assets set name = 'Teal Glass (default fill)' where id = '${gold.id}';`);
  console.log(`  renamed    -> "Teal Glass (default fill)"`);
}

/* 4: the two frame builtins */
const mk = (name, m) => panel({ action: "asset",
  asset: { kind: "style", name, url: null, meta: m } });
await mk("No Button Frame", { builtin: true, domain: "button_frame" });               // -> null
await mk("Gold Bezel", { builtin: true, domain: "button_frame", effect: "gold" });    // -> object
console.log(`  builtins   -> "No Button Frame", "Gold Bezel"`);

/* 5: pin every PC so the panel and the overlay agree */
const bez = (await rest("assets?kind=eq.style&select=id,name,url,meta"))
  .find(a => a.meta?.builtin && a.meta?.domain === "button_frame" && a.meta?.effect === "gold");
for (const s of states) {
  const wants = s.data?.boardButtons?.url ? null : bez;
  const res = await panel({ action: "patch", pc: s.id, clientId: "publish-frame",
    patch: { boardFrame: wants } });
  console.log(`  PC${s.id} boardFrame = ${wants ? "Gold Bezel" : "null"}  ${res.ok ? "ok" : JSON.stringify(res)}`);
}
console.log("\ndone.");
