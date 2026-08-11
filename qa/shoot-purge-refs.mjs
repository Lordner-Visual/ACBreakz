/* Acceptance for reference-counted purge: two asset rows share one storage file.
   Purging one must NOT remove the file; purging the last owner must remove it.
   Uses throwaway rows/files only — nothing the show uses is touched. */
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, {
  method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const fileStatus = (path) => fetch(
  `${env.SUPABASE_URL}/storage/v1/object/public/media/${path}`,
  { headers: { "Cache-Control": "no-cache" } }).then(r => r.status);
/* The public URL keeps serving a Cloudflare-cached 200 for a while after deletion,
   so existence is judged by the bucket listing, which is authoritative. */
const inBucket = async (path) => {
  const [prefix, name] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
  const list = await fetch(`${env.SUPABASE_URL}/storage/v1/object/list/media`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 200 }) }).then(r => r.json());
  return list.some(x => x.name === name);
};

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

/* 1. upload a tiny throwaway file via the panel's own signed-upload flow */
const path = `banners/composed-purgetest-${Date.now()}.png`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const signed = await panel({ action: "sign_upload", path });
if (!signed.ok) { console.log("sign_upload failed:", JSON.stringify(signed)); process.exit(1); }
const up = await fetch(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/media/${signed.path}?token=${signed.token}`,
  { method: "PUT", headers: { "content-type": "image/png" }, body: png });
if (!up.ok) { console.log("upload failed:", up.status, await up.text()); process.exit(1); }
const url = `${env.SUPABASE_URL}/storage/v1/object/public/media/${path}`;
ok(`throwaway file uploaded`, await inBucket(path));

/* 2. two rows pointing at the same file — the "file into section" shape */
const r1 = await panel({ action: "asset", asset: { kind: "banner", name: "purgetest-original", url,
  meta: { type: "ai", template: true } } });
const r2 = await panel({ action: "asset", asset: { kind: "style", name: "purgetest-filed-copy", url,
  meta: { domain: "board_bg", type: "ai" } } });
ok("two rows created sharing the file", !!r1.asset?.id && !!r2.asset?.id);

/* 3. purge the original — the filed copy still owns the file.
   Deliberately WAIT past any CDN lag: if the file were wrongly deleted, this is
   when it would disappear. */
const p1 = await panel({ action: "purge_asset", id: r1.asset.id });
await new Promise(r => setTimeout(r, 8000));
ok(`purging the ORIGINAL leaves the shared file alive (panel:${p1.ok})`,
  p1.ok === true && await inBucket(path));

/* 4. trash + empty-trash the filed copy — now nothing references it, file must go */
const d2 = await panel({ action: "delete_asset", id: r2.asset.id });
ok(`soft delete keeps the file`, d2.ok === true && await inBucket(path));
/* guard: only empty the trash if it holds exactly our throwaway row */
const trash = await fetch(`${env.SUPABASE_URL}/rest/v1/assets?meta->>deleted=eq.true&select=id`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json());
if (trash.length === 1 && trash[0].id === r2.asset.id) {
  const e = await panel({ action: "empty_trash" });
  ok(`empty_trash removes the last owner's file (purged:${e.purged})`,
    e.ok === true && !(await inBucket(path)));
} else {
  console.log(`  trash unexpectedly holds ${trash.length} row(s) — using purge_asset instead`);
  const p2 = await panel({ action: "purge_asset", id: r2.asset.id });
  ok(`purging the LAST owner removes the file (panel:${p2.ok})`,
    p2.ok === true && !(await inBucket(path)));
}

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
