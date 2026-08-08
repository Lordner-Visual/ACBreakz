# ACBreakz Cloud Overlay — Operator Runbook

One page to run the whole system. Keys are NOT in this file: get `<DECK_KEY>` and
`<PANEL_KEY>` from Brandon (they live in `C:\ACBreakz-Cloud\.env` on the main PC and in
Supabase → Edge Functions → Secrets).

**Live URLs**
- Overlay (OBS): `https://lordner-visual.github.io/ACBreakz/overlay/`
- Control panel (any phone/laptop): `https://lordner-visual.github.io/ACBreakz/control/`
- Deck endpoint: `https://jqowngdkgnfhaworyppo.supabase.co/functions/v1/deck`

---

## Set up a stream PC (≈10 minutes, one time)

OBS canvas is 1080×1920. Make ONE new scene, e.g. **"AC Breakz Cloud"**. Old scenes stay
untouched — they are the rollback.

Add sources bottom → top (browser sources: Width **1080**, Height **1920**, FPS **60**):

| # | Source | Settings |
|---|---|---|
| 1 | Browser "ACBZ BG" | URL `https://lordner-visual.github.io/ACBreakz/overlay/?layer=bg&pc=2` |
| 2 | Camera 2 (hand cam) | your existing device, full-width lower region |
| 3 | Camera 1 (face cam) | your existing device + Chroma Key, 667×413 at x207 y68 |
| 4 | Browser "ACBZ HUD" | URL `...?layer=hud&pc=2` · ✅ Control audio via OBS |
| 5 | Browser "ACBZ FX" | URL `...?layer=fx&pc=2` · ✅ Control audio via OBS |

On every browser source: ❌ "Shutdown source when not visible", ❌ "Refresh browser when
scene becomes active", ✅ "Control audio via OBS" (HUD + FX only).

**The ONLY per-PC difference is `pc=1` … `pc=5`** — it powers the "PCs live" counter in
the control panel. Use the next free number.

Verify: the background loop + team board + rotating banner appear immediately. Tap a team
in the control panel → pick animation + sound + board slot on every PC at once.

## Control panel (phone / tablet / laptop)

1. Open `https://lordner-visual.github.io/ACBreakz/control/`.
2. First time on a device: **Settings tab → "Panel key" → paste `<PANEL_KEY>` → Save &
   reconnect.** Without it the panel can watch but not change anything.
3. **Pick the PC in the header dropdown first** — board taps, banner rotation,
   backgrounds, and styles apply to that PC's stream only ("ALL PCs" broadcasts).
   Uploads and AI generations always land in the shared library for every PC.
4. Tabs: **Team Board** (tap to eliminate / tap again to restore) · **Animations**
   (team-animation styles + one-shots, each with "Link SoundFX") · **SoundFX**
   (upload/generate/preview sounds) · **Banners** (upload, composer, rotation,
   Reframe) · **Backgrounds** (set live, Reframe) · **Board Style** (button style +
   board background + button animation, mixed freely).
5. Every media tab has an **AI generate** strip at the bottom; tabs with more than one
   media type have a dropdown next to it. Costs: image ≈$0.03 (seconds), sound ≈$0.05
   and animation ≈$0.20 (both take 1–4 minutes — leave the tab open).
6. **Deleting**: any non-built-in asset card has Delete → it turns into "Are you sure?"
   → click again. This removes the file, the library entry, and any use of it on every
   PC. Built-in styles can't be deleted.

## Stream Deck buttons

Install the free **"Web Requests"** plugin (API Ninja). Each button = one GET request,
no browser popup. Build once, export, import on all 5 decks.

Base URL (everything before `&action`):
```text
https://jqowngdkgnfhaworyppo.supabase.co/functions/v1/deck?key=<DECK_KEY>
```

Add `&pc=2` to target one PC's stream; leave it off to hit ALL PCs.

| Button | Append |
|---|---|
| Eliminate a team (32 buttons) | `&action=team_pick&team=sea` (abbr list below) |
| Bring a team back | `&action=team_restore&team=sea` |
| Reset board | `&action=board_reset` |
| Stash or Pass | `&action=play&name=Stash` |
| Spin 2 Pick 1 | `&action=play&name=Spin` |
| Skip banner | `&action=banner_skip` |
| Background: TV loop | `&action=set_background&name=TV Background` |
| Background: Stadium | `&action=set_background&name=Stadium` |

Abbreviations: `ari atl bal buf car chi cin cle dal den det gb hou ind jax kc lac lar lv
mia min ne no nyg nyj phi pit sea sf tb ten wsh`

Scene switches, camera toggles, and mic/music mute stay native OBS actions per machine.

## Rollback (30 seconds)

Click your **legacy scene** in the OBS scene list. Done — the old setup was never
modified. The cloud system keeps running in the background; switch back any time.

## If something breaks

| Symptom | Fix |
|---|---|
| Panel says "Enter the panel key in Settings" | Settings tab → paste `<PANEL_KEY>` → Save |
| Overlay frozen / no picks arriving | Right-click the browser source → "Refresh cache of current page"; check PC internet |
| Deck button does nothing | Test the URL in a phone browser — `{"ok":true}` means the button/plugin is misconfigured, an error names the problem |
| "bad key" from deck endpoint | The `<DECK_KEY>` in the button URL is wrong |
| Team pick shows CSS burst instead of team video | That team's stinger asset is missing — check Games & FX library |
| WebM plays with black background | Re-encode with alpha: `ffmpeg -i in.webm -pix_fmt yuva420p out.webm` |
| Storage 403 on upload | Panel key missing/wrong (uploads are signed through the panel function) |
| Nothing works, show must go on | Rollback (above) and stream on legacy scenes |

## System map (for whoever maintains this)

- **Hosting:** GitHub Pages from `master` of `Lordner-Visual/ACBreakz` (push = deploy).
- **Backend:** Supabase project `jqowngdkgnfhaworyppo` — `stream_state` (one row),
  `assets`, `events` (auto-pruned daily), storage bucket `media`, realtime on
  state+events.
- **Security:** anon key (in `overlay/config.js`) is READ-ONLY. Writes only via edge
  functions: `deck` (`DECK_KEY`), `panel` (`PANEL_KEY`, also gates AI spend).
- **Budget ledger:** `BUDGET.md`. AI images ≈$0.03 each (fal.ai FLUX).
- **QA:** `node qa/shoot.mjs` re-runs the 6-screenshot vision check against
  `docs/LAYOUT_KEY.md`.
