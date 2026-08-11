/* Deleting anything must also deselect it everywhere — through all three paths:
   delete (to trash), purge from trash, and hide-from-rotation. */
import { readFileSync } from "fs";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  "content-type": "application/json" };
const panel = (body) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: REST, body: JSON.stringify({ key: env.PANEL_KEY, ...body }) }).then(r => r.json());
const stateOf = async (pc) => (await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=data&id=eq.${pc}`, { headers: REST })).json())[0].data;
const selected = async (pc, id) =>
  ((await stateOf(pc)).banners?.rotation ?? []).some(b => b.id === id);
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

async function makeBanner(name) {
  const r = await panel({ action: "asset",
    asset: { kind: "banner", name, url: "https://example.invalid/x.png", meta: { type: "text", text: name } } });
  return r.asset;
}
async function select(pc, asset) {
  const d = await stateOf(pc);
  d.banners ??= { rotation: [] };
  d.banners.rotation = [...(d.banners.rotation ?? []), asset];
  await panel({ action: "state", pc, data: d });
}

/* 1 — delete to trash */
let a = await makeBanner("DESELECT TEST A");
await select(2, a); await select(3, a);
ok("selected on PC2 and PC3", await selected(2, a.id) && await selected(3, a.id));
await panel({ action: "delete_asset", id: a.id });
ok("delete to trash deselects on every PC",
  !(await selected(2, a.id)) && !(await selected(3, a.id)));

/* 2 — purge from the trash (this was the broken path) */
a = await makeBanner("DESELECT TEST B");
await select(2, a);
await panel({ action: "delete_asset", id: a.id });
await select(2, a);                                   // re-select it while it sits in the trash
ok("re-selected while in the trash", await selected(2, a.id));
await panel({ action: "purge_asset", id: a.id });
ok("purging from the trash deselects it", !(await selected(2, a.id)));

/* 3 — hiding from the rotation list */
a = await makeBanner("DESELECT TEST C");
await select(4, a);
await panel({ action: "update_asset", id: a.id, meta: { hideRotation: true } });
ok("hiding from the rotation list deselects it", !(await selected(4, a.id)));
await panel({ action: "purge_asset", id: a.id });

/* 4 — empty trash */
a = await makeBanner("DESELECT TEST D");
await select(5, a);
await panel({ action: "delete_asset", id: a.id });
await select(5, a);
await panel({ action: "empty_trash" });
ok("empty trash deselects everything it removes", !(await selected(5, a.id)));

console.log(fails ? `DONE with ${fails} FAILURES` : "DONE all ok");
