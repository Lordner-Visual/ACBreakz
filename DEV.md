# Dev — the test rig

Dev is per-PC row **7**. It is a real PC in every sense the system cares about: its own board,
banners, background, board style, one-shot assignments, Stream Deck profile, dashboard and a card
on the master panel's Status tab. Two things make it a test rig rather than a seventh stream:

1. **It is excluded from broadcasts.** A `/deck` press with no `?pc=` and a master-panel
   **ALL PCs** write both mean PCs 1-6. Dev is only ever reached by naming it. Otherwise an
   all-PCs write during a show would stamp over whatever was being tested, and the test would
   look like it failed.
2. **It loads the dev copy of the code.** `overlay/` and `control/` are single static files that
   every PC loads, and each overlay polls its own hash every 45s and reloads on change — so a push
   *is* the rollout. `dev/overlay/` and `dev/control/` are a second deployed copy that only Dev
   points at.

## What happened to PC Test

Row **6** used to be the test rig, "PC Test". On 2026-09-17 that profile was installed on a new
streamer's machine at short notice, so row 6 is now a **live PC (PC6)** that still carries the name
"PC Test" — the rename waits until his OBS and Stream Deck naming change too. Until then:

- It is **part of** the ALL PCs broadcast, like any other live PC.
- Its OBS sources still load **`/staging/overlay/?…&pc=6`** and its CONTROL key opens
  **`/staging/control/pc.html?pc=6`**. `staging/` is therefore no longer a test copy: every
  promotion writes the same files to `overlay/` **and** `staging/`, so PC6 always runs production
  code. **Never edit `staging/` by hand** — the next promotion overwrites it.
- When he is renamed: point his three sources at `/overlay/?layer=…&pc=6`, re-import his rebuilt
  profile, rename "PC Test" → "PC6" in the code, then `staging/` can be deleted and its two
  promotion pairs removed from `scripts/promote.mjs`.

## Stream links

OBS browser sources on the Dev machine — 1080×1920, same as the live rigs, in a scene named
exactly **`ACBreakz Cloud Dev`** with sources named **`BG`**, **`HUD`** and **`FX`** (the Stream
Deck scene key and the Status tab's instructions use those names):

| Source | URL |
|---|---|
| BG | `https://lordner-visual.github.io/ACBreakz/dev/overlay/?layer=bg&pc=7` |
| HUD | `https://lordner-visual.github.io/ACBreakz/dev/overlay/?layer=hud&pc=7` |
| FX | `https://lordner-visual.github.io/ACBreakz/dev/overlay/?layer=fx&pc=7` |

Only the FX source plays audio. All three are required — "sound but no stinger" means the FX
source is missing.

Operator dashboard: `https://lordner-visual.github.io/ACBreakz/dev/control/pc.html?pc=7`
Master panel (dev copy): `https://lordner-visual.github.io/ACBreakz/dev/control/index.html`

The live PCs are unchanged and keep using the plain paths (PC6 the `staging` ones, above).

## How a change reaches the live streams

```
edit dev/  ->  test on Dev  ->  promote (now, or scheduled)
```

Promotion copies `dev/overlay/` and `dev/control/` over `overlay/`, `control/`, `staging/overlay/`
and `staging/control/`. Because the overlays self-update, every live PC reloads within ~45s.

```bash
node scripts/promote.mjs --check
```

`--check` reports what would change and whether anything looks live. Promotion **refuses** by
default when it does, because a mid-show reload is the thing we are avoiding. `--force` overrides.
`--only control` ships panel changes with no stream impact (no OBS source loads a control page).
Two liveness proxies are combined and both are printed, because neither is proof — nothing here
can see whether OBS is actually streaming:

- Realtime presence on `presence:overlays`: every overlay source reports itself, so a PC with
  OBS open shows up.
- `stream_state.updated_at` recency: somebody actively working a board.

### Scheduling it

```bash
node scripts/promote.mjs --at 2026-08-25T07:00:00Z
```

That writes `dev/PROMOTE_AT`. The **Promote** GitHub Action (cron, every 15 minutes) is meant to
pick it up — but `.github/workflows/promote.yml` is still **not pushed** (the GitHub token on this
machine lacks the `workflow` scope), so scheduled promotion does not run unattended yet.

## What dev/ does NOT cover

`dev/` is for the **static pages** only. These are one deployment for the whole project and go
live for every PC the moment they ship:

- **Edge functions** (`supabase/functions/deck`, `panel`, `generate-asset`)
- **SQL functions and schema** (`board_action`, `state_patch`, migrations)

In practice these changes are additive and per-PC in effect, so they can be exercised against
`pc=7` before anything on a live board is touched — but the new code itself is already serving
every PC at that point.

## Tests that run against Dev

`qa/shoot-dev.mjs` (routing: Dev reachable, excluded from ALL PCs; PC Test included),
`qa/shoot-status.mjs`, `qa/shoot-fx-selfheal.mjs`, `qa/shoot-rebuild-loop.mjs`,
`qa/shoot-events-filter.mjs`, `qa/shoot-realtime-rate.mjs`. They never press anything on a live
PC; the parts of `shoot-dev` that must (a real broadcast press) skip themselves while any PC looks
live.

## Manual steps — the things the cloud cannot do for you

**One-time, to bring Dev up on the machine you test on:**

1. **Create the OBS scene** `ACBreakz Cloud Dev` with the three browser sources above, named `BG`,
   `HUD`, `FX`, each 1080×1920.
2. Leave each scene-item transform at **scale 1.000 × 1.000**. Any other scale resamples the whole
   frame and is what "buttons look low-res" was.
3. **Import** `streamdeck/ACBreakz Cloud Dev.local.streamDeckProfile` (double-click). Delete any
   older Dev copy first — importing duplicates rather than replaces.
4. **Install** `streamdeck/ACBreakz Board.streamDeckPlugin` (double-click) on that machine. It was
   rebuilt so its key settings can choose Dev; a machine that already has it only needs this if
   you want to re-point a key to Dev by hand.

**Every time a Stream Deck profile or the plugin changes** — a new key, a moved key, a new plugin
action — that is a file on each machine, so it needs a hands-on import per PC. Code and per-PC
settings do not.

**Never needed by hand:** overlay or control-page changes, board style, grid, sizes, backgrounds,
banners, one-shot assignments, team-animation sets, anything in the database. Those all arrive
over the cloud — and a source that stops working can be reloaded from the Status tab.
