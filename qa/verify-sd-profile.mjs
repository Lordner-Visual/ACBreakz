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
  pages.sort((a, b) => Object.keys(a).length - Object.keys(b).length);
  const [main, teams, highs] = pages;

  const flat = [];
  const collect = (a) => { if (!a || typeof a !== "object") return; if (a.UUID) flat.push(a);
    const k = a.Actions; if (Array.isArray(k)) k.forEach(collect);
    else if (k && typeof k === "object") Object.values(k).forEach(collect); };
  pages.forEach(p => Object.values(p).forEach(collect));
  const urls = flat.filter(a => a.UUID === "com.barraider.apininja").map(a => a.Settings.url);

  const head = `PC${pc}`;
  if (pc === 1) {
    ok(`${head} zip uses forward slashes`, !names.some(n => n.includes("\\")));
    ok(`${head} main page: 4 scenes + 4 animations + 2 jumps + 3 OBS + dashboard`,
      Object.keys(main).length === 14);
    ok(`${head} scene row is Cloud N + Archived 1-3`,
      ["0,0","1,0","2,0","3,0"].every(p => main[p]?.UUID === "com.elgato.obsstudio.scene"));
    ok(`${head} record + replay row`,
      main["0,3"]?.UUID === "com.elgato.obsstudio.record" &&
      main["1,3"]?.UUID === "com.elgato.obsstudio.replaybuffer" &&
      main["2,3"]?.UUID === "com.elgato.obsstudio.replaybuffer.save");
    ok(`${head} dashboard key uses the Website action (open handles files, not URLs)`,
      main["7,0"]?.UUID === "com.elgato.streamdeck.system.website" &&
      main["7,0"].Settings.openInBrowser === true &&
      main["7,0"].Settings.path.endsWith("/control/pc.html?pc=1"));
    ok(`${head} TEAMS -> page 2, HIGHLIGHTS -> page 3 (1-based)`,
      main["0,2"]?.Settings.PageIndex === 2 && main["1,2"]?.Settings.PageIndex === 3);
    ok(`${head} nested multi-action steps carry isInMultiAction`,
      Object.values(teams).every(k =>
        k.Actions?.[0]?.Actions?.every(s => s.Settings?.isInMultiAction === true)));
    ok(`${head} team keys hop back to main (page 1)`,
      Object.values(teams).every(k =>
        k.Actions[0].Actions.some(s => s.UUID === "com.elgato.streamdeck.page.goto" &&
          s.Settings.PageIndex === 1)));
    ok(`${head} teams + highlights pages are 32 keys each`,
      Object.keys(teams).length === 32 && Object.keys(highs).length === 32);
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
  /* the point of five profiles: each one only ever talks to its own PC */
  /* 4 animations + (32 teams + 32 highlights) x 2 identical switch states = 132 */
  ok(`${head} every request is scoped to pc=${pc} (${urls.length} urls)`,
    urls.length === 132 && urls.every(u => u.endsWith(`&pc=${pc}`)));
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
