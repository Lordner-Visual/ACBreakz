/* Upgrade an ALREADY-INSTALLED per-PC profile in place, instead of importing a duplicate.

   Double-clicking a .streamDeckProfile always adds a new profile — the built manifest
   carries a random Device.UUID, so Stream Deck cannot match it to the one already bound
   to the physical deck. This copies the freshly built pages over the installed folder and
   keeps that folder's real Device.UUID and Name, so the deck keeps the profile it is
   already showing.

   Stream Deck must be CLOSED. The previous contents are backed up first.

     node scripts/install-sd-profile.mjs 5 [--dry]                                       */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, cpSync } from "fs";
import JSZip from "jszip";

const pc = Number(process.argv[2]);
const DRY = process.argv.includes("--dry");
if (!pc) { console.log("usage: node scripts/install-sd-profile.mjs <pc>"); process.exit(1); }

const ROOT = `${process.env.APPDATA}/Elgato/StreamDeck/ProfilesV3`.replace(/\\/g, "/");
const BUILT = `C:/ACBreakz-Cloud/streamdeck/ACBreakz Cloud PC${pc}.local.streamDeckProfile`;
const BACKUP = "C:/Users/Brandon/AppData/Local/Temp/claude/C--ACBreakz-Cloud/" +
  `1f708054-1874-4656-a4ad-d322df884fa9/scratchpad/sdprofile-backup-pc${pc}`;

/* find the installed profile for this PC that is bound to a REAL device */
const want = `ACBreakz Cloud PC${pc}`;
const candidates = [];
for (const d of readdirSync(ROOT, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const mf = `${ROOT}/${d.name}/manifest.json`;
  if (!existsSync(mf)) continue;
  try {
    const j = JSON.parse(readFileSync(mf, "utf8"));
    if (j.Name === want) candidates.push({ dir: d.name, model: j.Device?.Model, uuid: j.Device?.UUID });
  } catch (_) {}
}
console.log(`installed profiles named "${want}":`);
candidates.forEach(c => console.log(`  ${c.dir}  model=${c.model}  device=${c.uuid}`));
/* a real hardware deck reports a serial-looking UUID; the software deck does not */
const target = candidates.find(c => /\[.*\/.*\/.*\]/.test(String(c.uuid))) || candidates[0];
if (!target) { console.log("no installed profile to upgrade — import once by hand first."); process.exit(1); }
console.log(`\nupgrading: ${target.dir}  (device ${target.uuid})`);
if (DRY) { console.log("--dry: nothing written."); process.exit(0); }

const dst = `${ROOT}/${target.dir}`;
rmSync(BACKUP, { recursive: true, force: true });
cpSync(dst, BACKUP, { recursive: true });
console.log(`backed up -> ${BACKUP}`);

/* unpack the build over it, keeping the device binding and the name */
const zip = await JSZip.loadAsync(readFileSync(BUILT));
const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
/* The archive is an IMPORT bundle — package.json at the root and the profile itself under
   Profiles/<uuid>.sdProfile/. What lives in ProfilesV3 is only that inner subtree, so the
   source root is the folder holding the profile manifest, not the zip root. Treating the
   zip root as the source writes package.json and a nested Profiles/ into the installed
   folder and leaves it without a manifest at all. */
const manifestEntry = names.find(n => n.endsWith(".sdProfile/manifest.json"));
if (!manifestEntry) { console.log("no .sdProfile/manifest.json inside the build"); process.exit(1); }
const rootPrefix = manifestEntry.slice(0, manifestEntry.lastIndexOf("manifest.json"));
console.log(`source root inside the archive: ${rootPrefix}`);
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const n of names) {
  if (!n.startsWith(rootPrefix)) continue;          // skip the bundle wrapper
  const rel = n.slice(rootPrefix.length);
  const out = `${dst}/${rel}`;
  mkdirSync(out.slice(0, out.lastIndexOf("/")), { recursive: true });
  writeFileSync(out, await zip.files[n].async("nodebuffer"));
}
const mf = `${dst}/manifest.json`;
const m = JSON.parse(readFileSync(mf, "utf8"));
m.Device = { Model: target.model, UUID: target.uuid };   // keep the deck it is bound to
m.Name = want;
writeFileSync(mf, JSON.stringify(m, null, 1));
console.log(`installed ${names.length} files; Device.UUID preserved as ${target.uuid}`);
console.log("start Stream Deck and select the profile.");
