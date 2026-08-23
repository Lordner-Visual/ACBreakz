/* v14: teach assets_deselect about boardFrame.

   Deleting or purging an asset nulls it out of every PC's selections — but the slot list
   inside assets_deselect was written before boardFrame existed, so purging a button frame
   left every board still pointing at the deleted file. That is exactly what happened:
   emptying the trash removed the file (purge is reference-counted) and the row, and a
   live board was left rendering a black border because border-image had nothing to load.

   Adding a per-PC selection key means touching THREE places: the overlay, this function,
   and scripts/audit-refs.mjs. Miss any one and the failure is silent.

   Rewrites the function from its own current definition so nothing else can drift.       */
import { readFileSync, writeFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const sql = (q) => fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
  method: "POST", headers: { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN,
    "content-type": "application/json" }, body: JSON.stringify({ query: q }) })
  .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 400)); return j; });

const [{ def }] = await sql("select pg_get_functiondef(oid) as def from pg_proc where proname='assets_deselect';");
const FROM = "array['animStyle', 'boardButtons', 'boardBg', 'buttonAnim']";
const TO = "array['animStyle', 'boardButtons', 'boardBg', 'boardFrame', 'buttonAnim']";
if (def.includes(TO)) { console.log("already covers boardFrame — nothing to do"); process.exit(0); }
if (!def.includes(FROM)) { console.log("slot list not found; refusing to guess"); process.exit(1); }

const next = def.replace(FROM, TO);
await sql(next);
writeFileSync("C:/ACBreakz-Cloud/supabase/migrate-v14-boardframe.sql",
  "-- v14: assets_deselect must clear boardFrame too (see scripts/migrate-v14-boardframe.mjs)\n" +
  next + ";\n");

const [{ def: check }] = await sql("select pg_get_functiondef(oid) as def from pg_proc where proname='assets_deselect';");
console.log(check.includes(TO)
  ? "assets_deselect now clears boardFrame; migration written to supabase/migrate-v14-boardframe.sql"
  : "FAILED — the replacement did not take");
