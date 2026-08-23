/* Verify all five per-PC Stream Deck profiles: layout, plugin wiring, PC scoping,
   and that the URLs baked into them actually work. */
import { readFileSync } from "fs";
import JSZip from "jszip";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

for (let pc = 1; pc <= 5; pc++) {
  const file = `C:/ACBreakz-Cloud/streamdeck/ACBreakz Cloud PC${pc}.local.streamDeckProfile`;
  const zip = await JSZip.loadAsync(readFileSync(file));
  const names = Object.keys(zip.files);
  const pages = [];
  for (const n of names.filter(n => n.endsWith("manifest.json"))) {
    const j = JSON.parse(await zip.file(n).async("string"));
    if (j.Controllers?.[0]?.Actions) pages.push(j.Controllers[0].Actions);
  }
  /* identify pages by what their keys DO — both team pages have 32 keys, so their
     order in the archive is not meaningful */
  /* Identify by what the keys ARE, not by a URL: team and highlight keys are plugin
     actions now and carry no url at all, so the old regex over the JSON found nothing
     and both pages came back undefined. */
  const hasMode = (p, mode) => Object.values(p).some(
    (k) => k.UUID === "com.acbreakz.board.team" && k.Settings?.mode === mode);
  const main  = pages.find(p => Object.keys(p).length !== 32);
  const teams = pages.find(p => hasMode(p, "eliminate"));
  const highs = pages.find(p => hasMode(p, "highlight"));

  const flat = [];
  const collect = (a) => { if (!a || typeof a !== "object") return; if (a.UUID) flat.push(a);
    const k = a.Actions; if (Array.isArray(k)) k.forEach(collect);
    else if (k && typeof k === "object") Object.values(k).forEach(collect); };
  pages.forEach(p => Object.values(p).forEach(collect));
  const urls = flat.filter(a => a.UUID === "com.barraider.apininja").map(a => a.Settings.url);

  const head = `PC${pc}`;
  if (pc === 1) {
    ok(`${head} zip uses forward slashes`, !names.some(n => n.includes("\\")));
    /* 4 scenes + 4 animations + 2 page jumps + 3 OBS + dashboard */
    ok(`${head} main page has all 14 keys`, Object.keys(main).length === 14);
    ok(`${head} no reset keys on the deck`,
      !/board_reset|highlight_clear/.test(JSON.stringify(Object.values(main))));
    ok(`${head} scene row is Cloud N + Archived 1-3`,
      ["0,0","1,0","2,0","3,0"].every(p => main[p]?.UUID === "com.elgato.obsstudio.scene"));
    ok(`${head} record + replay sit under the control key (column 7)`,
      main["7,1"]?.UUID === "com.elgato.obsstudio.record" &&
      main["7,2"]?.UUID === "com.elgato.obsstudio.replaybuffer" &&
      main["7,3"]?.UUID === "com.elgato.obsstudio.replaybuffer.save");
    /* Team and highlight keys are now plugin actions, not Multi Action Switches. The
       switch's second state WAS the drift: it flipped locally on press and was never
       reconciled with the board. A plugin key has ONE state and NO baked image — the
       plugin paints it from stream_state at runtime.
       This assertion used to require States[0].Image to be a real Images/*.png, which
       enforced the exact bug it should have caught: Stream Deck ranks a profile-baked
       image above setImage, so the plugin repainted correctly and nothing ever showed.
       An Image here must therefore be a FAILURE, not a requirement. */
    const pluginKeys = (page, mode) => Object.values(page).every(k =>
      k.UUID === "com.acbreakz.board.team" &&
      k.States?.length === 1 &&
      k.States[0].Image === undefined &&
      k.Settings?.mode === mode &&
      Number(k.Settings?.pc) === pc &&
      typeof k.Settings?.team === "string" && k.Settings.team.length >= 2);
    ok(`${head} scenes go black when that scene isn't active`,
      ["0,0","1,0","2,0","3,0"].every(p =>
        (main[p].States?.[1]?.Image ?? "").includes("scene-inactive")));
    ok(`${head} no key is left showing the API Ninja logo`,
      Object.values(main).filter(k => k.UUID === "com.barraider.apininja")
        .every(k => !!k.States[0].Image));
    ok(`${head} all 32 team keys are plugin keys carrying pc/team/mode`,
      Object.keys(teams).length === 32 && pluginKeys(teams, "eliminate"));
    ok(`${head} all 32 highlight keys are plugin keys carrying pc/team/mode`,
      Object.keys(highs).length === 32 && pluginKeys(highs, "highlight"));
    ok(`${head} every team appears exactly once on each page`,
      new Set(Object.values(teams).map(k => k.Settings.team)).size === 32 &&
      new Set(Object.values(highs).map(k => k.Settings.team)).size === 32);
    ok(`${head} no Multi Action Switch survives on either page`,
      ![...Object.values(teams), ...Object.values(highs)]
        .some(k => /multiactions/.test(k.UUID ?? "")));
    ok(`${head} dashboard key uses the Website action (open handles files, not URLs)`,
      main["7,0"]?.UUID === "com.elgato.streamdeck.system.website" &&
      main["7,0"].Settings.openInBrowser === true &&
      main["7,0"].Settings.path.endsWith(`/control/pc.html?pc=${pc}`));
    ok(`${head} TEAMS -> page 2, HIGHLIGHTS -> page 3 (1-based)`,
      main["0,2"]?.Settings.PageIndex === 2 && main["1,2"]?.Settings.PageIndex === 3);
    /* team + highlight keys deliberately STAY on their page — a second deck drives
       navigation, and eliminating several teams in a row is the common case */
    ok(`${head} team + highlight keys do NOT navigate away`,
      [...Object.values(teams), ...Object.values(highs)].every(k =>
        k.UUID === "com.acbreakz.board.team"));
    ok(`${head} animation row includes Spin 3 Pick 1 and PYT`,
      urls.some(u => /name=Spin%203%20Pick%201/.test(u)) && urls.some(u => /name=PYT/.test(u)));
    const ninjas = flat.filter(a => a.UUID === "com.barraider.apininja");
    ok(`${head} autorun disabled everywhere`,
      ninjas.every(a => a.Settings.autorunMinutes === ""));
    /* the bug that killed every request: empty file fields null-crash the plugin */
    ok(`${head} file fields use the plugin's "No file..." sentinel`,
      ninjas.every(a => ["urlFile","dataFile","headersFile","matchedImage","unmatchedImage"]
        .every(k => a.Settings[k] === "No file...")));
    ok(`${head} plugin version matches the installed 1.5.1`,
      ninjas.every(a => a.Plugin.Version === "1.5.1"));
  }
  /* The point of five profiles: each one only ever talks to its own PC. That used to be
     one URL check (132 = 4 animations + 64 keys x 2 switch states), but team and
     highlight keys carry no URL at all now — their PC lives in Settings — so scoping has
     to be checked in both places, and for every PC rather than just PC1. */
  ok(`${head} the remaining API Ninja urls are scoped to pc=${pc} (${urls.length} urls)`,
    urls.length === 4 && urls.every(u => u.endsWith(`&pc=${pc}`)));
  const plugKeys = [...Object.values(teams ?? {}), ...Object.values(highs ?? {})];
  ok(`${head} all 64 plugin keys are scoped to pc=${pc}`,
    plugKeys.length === 64 && plugKeys.every(k => Number(k.Settings?.pc) === pc));
  ok(`${head} profile name`, JSON.parse(await zip.file(
      names.find(n => n.endsWith(".sdProfile/manifest.json"))).async("string")).Name
      === `ACBreakz Cloud PC${pc}`);
}

/* live-fire a couple of PC-scoped URLs and confirm they only touch that PC */
const B = `${env.SUPABASE_URL}/functions/v1/deck?key=${env.DECK_KEY}`;
const REST = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
const boards = async () => Object.fromEntries((await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/stream_state?select=id,data->board&order=id`, { headers: REST })).json())
  .map(r => [r.id, r.board]));
await fetch(`${B}&action=board_reset`);
await fetch(`${B}&action=team_toggle&team=gb&pc=3`);
const b = await boards();
ok("a PC3 key changes only PC3",
  b[3].picked?.gb === true && [1,2,4,5].every(n => !b[n].picked?.gb));
await fetch(`${B}&action=board_reset`);
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
