/* Team animation SETS and per-PC Stream Deck event variants.

   Proves the two things that matter: a second set does not outrank Classic just by
   being newer, and two PCs can be on different choices at the same time.

   Uses throwaway asset rows that point at files already in storage (no uploads), and
   purges them afterwards — the reference-counted purge protects the shared files.
   Runs on PC 4 and PC 5 and restores both. */
import { readFileSync } from "fs";
/* refuses to run while a live PC looks busy — these suites mutate the production rows */
import { assertIdle } from "./lib/live-guard.mjs";
await assertIdle();

const A = Number(process.argv[2]) || 5;      // the PC we switch
const B = Number(process.argv[3]) || 4;      // the PC that must NOT move
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const ANON = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8")
  .match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];

let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const deck = (q) => fetch(`${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}&${q}`)
  .then(r => r.json().catch(() => ({})));
const panel = (b) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST",
  headers: { "content-type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
  body: JSON.stringify({ key: env.PANEL_KEY, ...b }) }).then(r => r.json());
const rest = (p) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }).then(r => r.json());
const stateOf = (pc) => rest(`stream_state?id=eq.${pc}&select=data`).then(r => r[0].data);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const SNAP = { [A]: await stateOf(A), [B]: await stateOf(B) };
console.log(`snapshot of PC${A} and PC${B} taken — restored at the end\n`);
const made = [];
const cleanup = async () => {
  for (const id of made) await panel({ action: "purge_asset", id });
  for (const pc of [A, B]) await panel({ action: "state", pc, data: SNAP[pc], force: true });
};

try {
  /* borrow two files that already exist so nothing is uploaded */
  const classicKc = (await rest(`assets?kind=eq.animation&meta->>team=eq.kc&meta->>set=is.null&select=id,name,url`))[0];
  const someClip  = (await rest(`assets?kind=eq.animation&url=not.is.null&select=id,name,url&limit=1&order=created_at.asc`))[0];
  ok(`found the Classic clip for KC ("${classicKc?.name}")`, !!classicKc?.url);

  /* ---------- a second team set ---------- */
  console.log("\n=== a second team animation set ===");
  const setId = crypto.randomUUID();
  const clip = await panel({ action: "asset", asset: { kind: "animation", name: "QA set — Chiefs",
    url: someClip.url, meta: { team: "kc", group: "team", set: setId, type: "upload" } } });
  made.push(clip.asset.id);
  const card = await panel({ action: "asset", asset: { kind: "style", name: "QA Test Set", url: null,
    meta: { domain: "team_anim", per_team: true, set: setId, type: "upload" } } });
  made.push(card.asset.id);
  ok("set created: one card + one clip sharing meta.set", !!clip.asset?.id && !!card.asset?.id);

  const firedUrl = async (pc) => {
    const t0 = new Date().toISOString();
    await deck(`action=board_reset&pc=${pc}`);
    await sleep(300);
    await deck(`action=team_toggle&team=kc&pc=${pc}`);
    await sleep(900);
    const ev = await rest(`events?type=eq.team_pick&created_at=gte.${encodeURIComponent(t0)}&select=payload,created_at&order=created_at.desc`);
    return ev.find(e => Number(e.payload?.pc) === pc && e.payload?.team === "kc")?.payload?.animUrl ?? null;
  };

  /* both PCs still on Classic */
  await panel({ action: "patch", pc: A, patch: { animStyle: null } });
  await panel({ action: "patch", pc: B, patch: { animStyle: null } });
  await sleep(400);
  ok(`with no style selected PC${A} still fires the Classic clip`,
    (await firedUrl(A)) === classicKc.url);

  /* PC A switches to the new set, PC B must not move */
  await panel({ action: "patch", pc: A, patch: { animStyle: card.asset } });
  await sleep(400);
  const aUrl = await firedUrl(A), bUrl = await firedUrl(B);
  ok(`PC${A} on the new set fires the SET clip, not the newest-overall`, aUrl === someClip.url);
  ok(`PC${B} is untouched and still fires Classic`, bUrl === classicKc.url);
  ok(`the two PCs genuinely differ at the same moment`, aUrl !== bUrl);

  /* back to Classic */
  await panel({ action: "patch", pc: A, patch: { animStyle: null } });
  await sleep(400);
  ok(`switching PC${A} back to Classic restores the Classic clip`,
    (await firedUrl(A)) === classicKc.url);

  /* ---------- per-PC event variants ---------- */
  console.log("\n=== Stream Deck event variants, per PC ===");
  const EV = "Stash or Pass";
  const original = (await rest(`assets?kind=eq.animation&meta->>event=eq.${encodeURIComponent(EV)}&select=id,name,url&order=created_at.desc`))[0];
  ok(`"${EV}" resolves to an asset today ("${original?.name}")`, !!original?.url);

  const variant = await panel({ action: "asset", asset: { kind: "animation", name: "QA variant — Stash",
    url: someClip.url, meta: { type: "upload", group: "oneshot", event: EV } } });
  made.push(variant.asset.id);

  /* pin both PCs to the original first, exactly as the panel does on upload */
  for (const pc of [A, B]) await panel({ action: "patch", pc, patch: { oneshots: { [EV]: original.id } } });
  await sleep(400);
  const loopUrl = async (pc) => {
    await deck(`action=play_loop&name=${encodeURIComponent(EV)}&pc=${pc}`);
    await sleep(700);
    const u = (await stateOf(pc)).loopFx?.url ?? null;
    await deck(`action=play_loop&name=${encodeURIComponent(EV)}&pc=${pc}`);   // toggle back off
    await sleep(400);
    return u;
  };
  ok(`a newer clip does NOT hijack the key while both PCs are pinned`,
    (await loopUrl(A)) === original.url);

  /* PC A switches to the variant */
  await panel({ action: "patch", pc: A, patch: { oneshots: { [EV]: variant.asset.id } } });
  await sleep(400);
  const la = await loopUrl(A), lb = await loopUrl(B);
  ok(`PC${A} now plays the variant`, la === variant.asset.url);
  ok(`PC${B} still plays the original`, lb === original.url);
  ok(`one deck key, two PCs, two different clips`, la !== lb);

  /* a deleted assignment must fall back rather than break the key */
  await panel({ action: "patch", pc: A, patch: { oneshots: { [EV]: "00000000-0000-0000-0000-000000000000" } } });
  await sleep(400);
  ok(`a stale assignment falls back instead of breaking the key`, !!(await loopUrl(A)));
} finally {
  await cleanup();
  const back = { [A]: await stateOf(A), [B]: await stateOf(B) };
  const bare = (d) => { const { updatedAt, lastWriter, ...r } = d; return JSON.stringify(r); };
  for (const pc of [A, B])
    ok(`PC${pc} restored`, bare(back[pc]) === bare(SNAP[pc]));
  const leftover = await rest(`assets?name=like.QA*&select=id,name`);
  ok(`no throwaway rows left behind (${leftover.length})`, leftover.length === 0);
}

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
