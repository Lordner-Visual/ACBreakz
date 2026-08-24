# PC Test — the staging rig

PC Test is per-PC row **6**. It is a real PC in every sense the system cares about: its own
board, banners, background, board style, one-shot assignments, Stream Deck profile and dashboard.
Two things make it a staging rig rather than a sixth stream:

1. **It is excluded from broadcasts.** A `/deck` press with no `?pc=` and a master-panel
   **ALL PCs** write both mean PCs 1-5. PC Test is only ever reached by naming it. Otherwise an
   all-PCs write during a show would stamp over whatever was being tested, and the test would
   look like it failed.
2. **It loads the staging copy of the code.** `overlay/` and `control/` are single static files
   that every PC loads, and each overlay polls its own hash every 45s and reloads on change — so
   a push *is* the rollout. `staging/overlay/` and `staging/control/` are a second deployed copy
   that only PC Test points at.

## Stream links

OBS browser sources on the test PC — 1080×1920, same as the live rigs:

| Source | URL |
|---|---|
| bg | `https://lordner-visual.github.io/ACBreakz/staging/overlay/?layer=bg&pc=6` |
| hud | `https://lordner-visual.github.io/ACBreakz/staging/overlay/?layer=hud&pc=6` |
| fx | `https://lordner-visual.github.io/ACBreakz/staging/overlay/?layer=fx&pc=6` |

Only the `fx` source plays audio. All three are required — "sound but no stinger" means the fx
source is missing.

Operator dashboard: `https://lordner-visual.github.io/ACBreakz/staging/control/pc.html?pc=6`
Master panel (staging copy): `https://lordner-visual.github.io/ACBreakz/staging/control/index.html`

The live PCs are unchanged and keep using the non-`staging` paths.

## How a change reaches the live streams

```
edit staging/  ->  you test on PC Test  ->  you approve  ->  promote (now or scheduled)
```

Promotion copies `staging/overlay/` and `staging/control/` over the live files. Because the
overlays self-update, every live PC reloads within ~45s of that landing.

```bash
node scripts/promote.mjs --check
```

`--check` reports what would change and whether anything looks live. Promotion **refuses** by
default when it does, because a mid-show reload is the thing we are avoiding. `--force`
overrides. Two liveness proxies are combined and both are printed, because neither is proof —
nothing here can see whether OBS is actually streaming:

- Realtime presence on `presence:overlays`: every overlay source reports itself, so a PC with
  OBS open shows up.
- `stream_state.updated_at` recency: somebody actively working a board.

### Scheduling it

```bash
node scripts/promote.mjs --at 2026-08-25T07:00:00Z
```

That writes `staging/PROMOTE_AT`. Commit and push it, and the **Promote staging to live**
GitHub Action (cron, every 15 minutes) promotes once that time has passed *and* nothing looks
live — retrying on the next tick if something does. No machine of yours needs to be awake. The
same workflow can be run on demand from the Actions tab, with a **force** checkbox.

Times are UTC. It needs no secrets: the only key it reads is the anon key already public inside
`overlay/config.js`.

## What staging does NOT cover

Staging is for the **static pages** only. These are one deployment for the whole project and go
live for every PC the moment they ship:

- **Edge functions** (`supabase/functions/deck`, `panel`, `generate-asset`)
- **SQL functions and schema** (`board_action`, `state_patch`, migrations)

In practice these changes are additive and per-PC in effect, so they can be exercised against
`pc=6` before anything on a live board is touched — but the new code itself is already serving
all five PCs at that point. If that ever becomes a real risk, the fix is a parallel
`deck-staging` function that only PC Test's profile calls; say the word and it is a small job.

## Manual steps — the things the cloud cannot do for you

Everything else in this system updates itself. These do not:

**One-time, to bring PC Test up:**

1. **Create the OBS scene** `ACBreakz Cloud PC Test` on the test machine, with the three browser
   sources above. The Stream Deck profile's scene key looks for exactly that name.
2. **Set each source to 1080×1920** and leave the scene-item transform at **scale 1.000 ×
   1.000**. Any other scale resamples the whole frame and is what "buttons look low-res" was.
3. **Import** `streamdeck/ACBreakz Cloud PC Test.local.streamDeckProfile`. Delete any older copy
   first — importing duplicates rather than replaces.
4. **Install** `streamdeck/ACBreakz Board.streamDeckPlugin` (double-click) if that machine has
   not had it yet. Nothing to type: the deck key rides inside the plugin.

**Every time a Stream Deck profile or the plugin changes** — a new key, a moved key, a new
plugin action — that is a file on each machine, so it needs a hands-on import per PC. Code and
per-PC settings do not.

**Never needed by hand:** overlay or control-page changes, board style, grid, sizes, backgrounds,
banners, one-shot assignments, team-animation sets, anything in the database. Those all arrive
over the cloud.
