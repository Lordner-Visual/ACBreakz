# Stream Deck — from 607 chained actions to one request per button

## What your current profile does (decoded from "AC Breakz 2.0 (may 14th)")

- **Team page:** 32 team buttons, each a Multi Action of ~19 steps — Switch Profile → 7× Source
  Visibility (show `<Team>.webm` + `Team Animation Sound Effect.wav` + board logo) → Delay → 8× Source
  Visibility (hide) → Switch Profile. 607 actions total on that page.
- **Main page:** Auction 1/2/3 + Solo 1/2 scene switches, STASH OR PASS and SPIN 2 PICK 1 multi-actions
  (show 5 sources → delay → hide 5), Music mute/unmute, Sound FX folder.

Timing lives in hard-coded Delay steps, sources are referenced by name per machine, and the profile
must be re-exported to 5 PCs after every edit. All of that goes away.

## The new pattern

Install the free **"Web Requests"** plugin (a.k.a. API Ninja) from the Stream Deck store — it fires
HTTP calls with no browser popup. Each graphics button becomes ONE action:

```
Method: GET
URL:    https://<PROJECT>.supabase.co/functions/v1/deck?key=<DECK_KEY>&action=<ACTION>
```

### Button map

| Button | URL suffix |
|---|---|
| Seahawks (and each of the 32) | `&action=team_pick&team=sea` |
| Un-pick a team | `&action=team_restore&team=sea` |
| Reset board | `&action=board_reset` |
| Fill ⇄ Eliminate mode | `&action=board_mode&mode=eliminate` (or `fill`) |
| Hide / show board | `&action=board_visible&v=0` / `&v=1` |
| Stash or Pass | `&action=play&name=Stash` |
| Spin 2 Pick 1 | `&action=play&name=Spin` |
| Skip to next banner | `&action=banner_skip` |
| Swap background | `&action=set_background&name=Volcanic` |

Team abbreviations: ari atl bal buf car chi cin cle dal den det gb hou ind jax kc lac lar lv mia min
ne no nyg nyj phi pit sea sf tb ten wsh.

### Why this beats obs-websocket for graphics

One request updates ALL five PCs plus the animation, sound, and board slot in a single event — no
delays to tune, no source names to match, and the buttons work from any deck, the Stream Deck mobile
app, or even a phone browser bookmark. Build the profile once, export, import on all 5 decks, and it
never needs re-syncing again because the logic lives in the cloud, not in the buttons.

### What stays native OBS

Scene switches (Auction 1–3, Solo 1–2), camera toggles, mic/music mute — genuinely per-machine
hardware. Keep those exactly as they are today.

### Bonus

The 32 team icons from your current profile can be reused: Stream Deck lets you copy a key's icon
before replacing its action, or the agent can extract them from the `.streamDeckProfile` zip
(`Profiles/*/CustomImages`) during migration.
