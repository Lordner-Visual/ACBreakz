# OBS Setup — one-time, ~10 minutes per PC (then never again)

Canvas: 1080×1920 (unchanged). Create ONE new scene, e.g. **"AC Breakz Cloud"**, and keep your old
scenes untouched as the fallback.

## Sources, bottom → top

| # | Source | Settings |
|---|---|---|
| 1 | **Browser — "ACBZ BG"** | URL `https://YOUR-SITE/overlay/?layer=bg&pc=1` · W 1080 · H 1920 · FPS 60 |
| 2 | **Camera 2** (hand cam / DroidCam) | your existing device, positioned per layout (full-width lower region) |
| 3 | **Camera 1** (face cam, chroma key) | your existing device + Chroma Key filter, 667×413 at x 207, y 68 |
| 4 | **Browser — "ACBZ HUD"** | URL `.../overlay/?layer=hud&pc=1` · W 1080 · H 1920 · FPS 60 · ✅ Control audio via OBS |
| 5 | **Browser — "ACBZ FX"** | URL `.../overlay/?layer=fx&pc=1` · W 1080 · H 1920 · FPS 60 · ✅ Control audio via OBS |

Change `pc=1` → `pc=2 … pc=5` per machine (that's the ONLY per-PC difference; it powers the "PCs
live" presence readout in the control panel).

## Per browser source

- ❌ UNCHECK "Shutdown source when not visible" (keeps state warm between scenes)
- ❌ UNCHECK "Refresh browser when scene becomes active" (state sync makes refresh unnecessary)
- ✅ "Control audio via OBS" on HUD + FX → team-pick sounds ride your normal mix and duck with music
- Page permissions: "Allow all" is not required; defaults are fine

## Verify

Open `.../overlay/?layer=all&debug=1&pc=test` in Chrome: dashed guides should sit exactly at
BG 0–480, BOARD 480–645, BANNERS 645–742, ANIM 667×413 @ (207, 800). Then tap a team in the control
panel — the pick animation, sound, and board slot should fire on every open overlay at once.

## Notes

- OBS Browser = Chromium with hardware acceleration; WebM alpha video plays natively, so your existing
  32 team `.webm` files work as-is once uploaded to the media library (agent task M3 migrates them).
- If a PC's internet blips, the overlay keeps its last state and auto-reconnects — the stream itself
  is unaffected because encoding is local.
- Legacy safety net: your old scenes stay in the collection; one click in the scene list rolls back.
