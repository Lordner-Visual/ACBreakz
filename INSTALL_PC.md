# Installing a stream PC (PC 1 shown — swap the number for others)

Nothing in this system lives on the PC except OBS itself and two Stream Deck plugins.
There are **no ACBreakz files to copy** — no icon folders, no scripts, no config files.
The overlay, the control dashboard and every asset are served from the cloud, and the
Stream Deck profile carries its own artwork inside the file.

## 1. Software

| Needed | Where | Why |
|---|---|---|
| OBS Studio | you already run it | the scenes and browser sources |
| Stream Deck app | you already run it | the deck |
| **API Ninja** plugin | Stream Deck Marketplace → Plugins → "API Ninja" (BarRaider) | every board/animation key is one HTTPS request |
| **OBS Studio** plugin | Stream Deck Marketplace → Plugins → "OBS Studio" (Elgato) | the scene, Record and Replay keys |

Both plugins are free. The profile lists them as required, so Stream Deck will prompt
if either is missing.

## 2. Stream Deck profile

Import `ACBreakz Cloud PC1.streamDeckProfile` (double-click, or Preferences →
Profiles → ⋯ → Import).

That is the whole install. The 137 team and button icons are embedded in the file, and
every key's URL already contains the deck key and `&pc=1`, so it drives **only this PC**.

If a profile with the same name is already installed, delete it first — Stream Deck
adds a duplicate rather than replacing, and you can end up pressing the old one.

**Layout**

| Row | Keys |
|---|---|
| 1 | ACBreakz Cloud 1 · Archived 1 · Archived 2 · Archived 3 — and **CONTROL** at the far right |
| 2 | Stash or Pass · Spin 2 Pick 1 · Spin 3 Pick 1 · PYT |
| 3 | TEAMS (page 2) · HIGHLIGHTS (page 3) |
| Right column | RECORD · START REPLAY · SAVE REPLAY (under CONTROL) |

Team and highlight pages hold all 32 teams; each key fires and hops back to page 1.

## 3. OBS

Scene names must match the deck keys exactly:

```text
ACBreakz Cloud 1      (the number matches the PC)
Archived 1
Archived 2
Archived 3
```

In **ACBreakz Cloud 1**, add three Browser sources — all 1080 × 1920, 60 FPS:

| Order (bottom → top) | URL |
|---|---|
| 1 | `https://lordner-visual.github.io/ACBreakz/overlay/?layer=bg&pc=1` |
| 2 | *Camera 2* (hands / cards) |
| 3 | *Camera 1* (face cam + chroma key) |
| 4 | `https://lordner-visual.github.io/ACBreakz/overlay/?layer=hud&pc=1` |
| 5 | `https://lordner-visual.github.io/ACBreakz/overlay/?layer=fx&pc=1` |

On each browser source: uncheck "Shutdown source when not visible" and "Refresh browser
when scene becomes active". Tick **Control audio via OBS** on the FX source.

The **FX source is what plays the stinger videos and all sound.** If it is missing you
still see the board and banners, and you hear nothing — that combination means the FX
source is absent.

You do not need to refresh the browser cache: the overlay checks for new builds every
45 seconds and reloads itself.

## 4. Control dashboard

Nothing to install. The **CONTROL** key opens
`https://lordner-visual.github.io/ACBreakz/control/pc.html?pc=1` in the default browser.
No password, and it only ever drives PC 1.

That operator can: eliminate/restore/highlight teams, choose the team animation style,
play one-shots and sounds, compose banners and set the rotation, pick a background, and
set the board style. They cannot upload, delete, or run AI generation.

## Checklist

1. Install the API Ninja and OBS Studio Stream Deck plugins
2. Import the PC's profile (delete any older copy first)
3. Create the four scenes with the exact names above
4. Add the three browser sources with `pc=1` in each URL
5. Press **Stash or Pass** — the animation should play on stream
6. Press **CONTROL** — the dashboard should open in a browser

## Master control (your machine only)

`https://lordner-visual.github.io/ACBreakz/control/` — password protected, drives any PC
or all five, and owns uploads, AI generation, deletion and the trash.
