/* Raise the browser cache lifetime on storage objects that were uploaded before
   upload-v2.mjs set one. Filenames are timestamp-prefixed and effectively immutable, so a
   one-year max-age is safe.

   cacheControl lives per object in storage.objects.metadata and that value DOES reach the
   wire (verified: two objects with different stored values serve different headers). But
   Cloudflare fronts the bucket, so an edge entry cached under the old header can outlive
   the change — hence the probe step.

     node scripts/fix-cache-headers.mjs            # report only
     node scripts/fix-cache-headers.mjs --one      # patch ONE object and probe it
     node scripts/fix-cache-headers.mjs --all      # patch everything still at 1 hour   */
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const PROJECT = "jqowngdkgnfhaworyppo";
const YEAR = "max-age=31536000";

const q = (sql) => fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
  method: "POST",
  headers: { Authorization: "Bearer " + env.SUPABASE_ACCESS_TOKEN, "content-type": "application/json" },
  body: JSON.stringify({ query: sql }) }).then(async r => {
    const j = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(j));
    return j;
  });

/* GET, never HEAD — the HEAD response carries no-cache regardless of the stored value */
const served = async (name) => {
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/media/` +
    name.split("/").map(encodeURIComponent).join("/");
  const r = await fetch(url, { headers: { Range: "bytes=0-127" } });
  return { cc: r.headers.get("cache-control"), cf: r.headers.get("cf-cache-status"),
           age: r.headers.get("age") };
};

const report = async () => {
  const rows = await q(
    "select coalesce(metadata->>'cacheControl','(null)') as cache_control, count(*) as objects, " +
    "pg_size_pretty(sum((metadata->>'size')::bigint)) as total " +
    "from storage.objects where bucket_id='media' group by 1 order by 2 desc;");
  console.table(rows);
};

const mode = process.argv[2];
await report();

if (mode === "--one") {
  /* a small, rarely-requested object so the edge is least likely to hold a stale copy */
  const [pick] = await q(
    "select name from storage.objects where bucket_id='media' " +
    `and metadata->>'cacheControl' = 'max-age=3600' ` +
    "order by (metadata->>'size')::bigint asc limit 1;");
  console.log("\nprobe object:", pick.name);
  console.log("  before:", JSON.stringify(await served(pick.name)));
  await q("update storage.objects set metadata = jsonb_set(metadata,'{cacheControl}'," +
    `'"${YEAR}"') where bucket_id='media' and name = ` +
    `'${pick.name.replace(/'/g, "''")}';`);
  console.log("  patched metadata; waiting 5s for the edge…");
  await new Promise(r => setTimeout(r, 5000));
  console.log("  after :", JSON.stringify(await served(pick.name)));
  console.log("\nIf cache-control still reads max-age=3600, the edge is holding a stale");
  console.log("entry — re-check in a few minutes before deciding to fall back to re-upload.");
}

if (mode === "--all") {
  const before = await q(
    "select count(*) as n, pg_size_pretty(sum((metadata->>'size')::bigint)) as total " +
    `from storage.objects where bucket_id='media' and metadata->>'cacheControl' = 'max-age=3600';`);
  console.log("\npatching", before[0].n, "objects /", before[0].total);
  await q("update storage.objects set metadata = jsonb_set(metadata,'{cacheControl}'," +
    `'"${YEAR}"') where bucket_id='media' and metadata->>'cacheControl' = 'max-age=3600';`);
  console.log("done.\n");
  await report();
}
