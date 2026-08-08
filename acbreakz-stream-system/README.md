# ACBreakz Stream System

Cloud-synced OBS overlay for 5 stream PCs. One control panel, one Stream Deck endpoint, zero manual
per-machine updates. Overlay geometry matches the layout key exactly: BG 1080×480 · Board 1080×165
@ y480 · Banners 1080×97 @ y645 · ANIM focus 667×413 @ (207,800) on a 1080×1920 canvas.

## Try it in 60 seconds (no accounts)

```
python -m http.server 8080
```
Tab 1 → `http://localhost:8080/overlay/?layer=all&debug=1`
Tab 2 → `http://localhost:8080/control/` — tap teams, add a text banner, watch tab 1 react.

## Go live (≈1 hour, $0/mo) — or hand the repo to Claude Code

Follow `AGENT_BLUEPRINT.md` (Claude Code reads it directly; `agent/claude_plan.json` is the machine
version): Supabase backend → deploy functions → host on Cloudflare Pages → paste keys into
`overlay/config.js` → migrate your existing `C:/ACBreakz OBS/Graphics/` into the media library →
add the three browser sources per `obs-setup/OBS_SETUP.md` → build deck buttons per
`streamdeck/STREAM_DECK_SETUP.md`.

## Map

```
ARCHITECTURE.md               why this design (Phase 1)
overlay/index.html + config.js   the on-stream engine (bg/hud/fx layers)
control/index.html            the streamer app (board, games, banners, uploads, AI)
supabase/schema.sql           state + assets + events + storage
supabase/functions/deck       Stream Deck HTTPS endpoint
supabase/functions/generate-asset   in-panel AI generation (fal.ai FLUX)
obs-setup/ · streamdeck/      one-time machine setup guides
PROMPT_KIT.md                 Midjourney/Recraft/AI-video formulas (Phase 3)
AGENT_BLUEPRINT.md · agent/   Claude Code execution plan (Phase 4)
```
