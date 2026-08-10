/* Verify the generated Stream Deck profile: zip layout, settings completeness,
   URL encoding, and that a sample of the real URLs actually return ok from deck. */
import { readFileSync, readdirSync, statSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import JSZip from "jszip";

const FILE = "C:/ACBreakz-Cloud/streamdeck/ACBreakz Cloud.local.streamDeckProfile";
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const zip = await JSZip.loadAsync(readFileSync(FILE));
const names = Object.keys(zip.files);
ok(`zip entries use forward slashes (${names.length} entries)`, !names.some(n => n.includes("\\")));
ok("package.json at archive root", names.includes("package.json"));

const manifests = names.filter(n => n.endsWith("manifest.json"));
const pages = [];
for (const n of manifests) {
  const j = JSON.parse(await zip.file(n).async("string"));
  if (j.Controllers?.[0]?.Actions) pages.push(j.Controllers[0].Actions);
}
ok(`3 key pages found`, pages.length === 3);

/* every API Ninja action: full settings + encoded url */
const REQUIRED = ["url","urlFile","requestType","contentType","data","dataFile","headers",
  "headersFile","loadFromFiles","loadURLFromFiles","parseResponse","responseFormat",
  "responseRegex","responseRegexFetch","responseShown","responseShownFile","saveResponseToFile",
  "showCustomImages","customImageValue","matchedImage","unmatchedImage","treatResponseAsImage",
  "treatResponseAsText","responseImageField","titlePrefix","titleSuffix","autorunType",
  "autorunMinutes","debugLogging","hideSuccessIndicator"];

const ninjas = [];
const collect = (a) => {
  if (a?.UUID === "com.barraider.apininja") ninjas.push(a);
  const kids = a?.Actions;
  if (Array.isArray(kids)) kids.forEach(collect);
  else if (kids && typeof kids === "object") Object.values(kids).forEach(collect);
};
pages.forEach(p => Object.values(p).forEach(collect));
ok(`103 API Ninja actions (${ninjas.length})`, ninjas.length === 103);
ok("every action has all 30 settings keys",
  ninjas.every(a => REQUIRED.every(k => k in a.Settings)));
ok("every action is a GET", ninjas.every(a => a.Settings.requestType === "0"));
ok("no raw spaces in any url", !ninjas.some(a => / /.test(a.Settings.url)));
ok("no mojibake in titles",
  !JSON.stringify(pages).match(/[\u00C2-\u00C3][\u0080-\u00BF]/));

/* live-fire a representative sample straight from the profile */
const pick = (re) => ninjas.find(a => re.test(a.Settings.url))?.Settings.url;
const samples = [["team_pick", pick(/team_pick&team=sea/)],
                 ["highlight_toggle", pick(/highlight_toggle&team=sea/)],
                 ["board_reset", pick(/board_reset/)],
                 ["set_background", pick(/set_background/)]];
for (const [label, url] of samples) {
  if (!url) { ok(`${label} url present`, false); continue; }
  const r = await fetch(url).then(x => x.json()).catch(e => ({ error: String(e) }));
  ok(`${label} returns ok from the profile's exact URL (${JSON.stringify(r).slice(0, 60)})`, r.ok === true);
}
/* leave the board clean */
await fetch(pick(/board_reset/));
await fetch(pick(/highlight_clear/));
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
