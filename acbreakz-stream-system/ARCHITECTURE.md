# ACBreakz Stream System — Architecture Decision & Justification

## What you're running today (decoded from your actual files)

Your OBS collection ("AC Breakz", 4-25-26) contains 5 scenes and ~158 sources. Every graphic is a
**local file on each PC** (`C:/ACBreakz OBS/Graphics/...`): 32 team-logo `.webm` animations, 32 board
logo PNGs (×2 board variants), the TV background webm, Stash or Pass / Spin 2 Pick 1 webms, and a
shared `Team Animation Sound Effect.wav`. Your Stream Deck profile ("AC Breakz 2.0", XL) drives it all
with **63 Source Visibility actions**; each team button is a multi-action of roughly **19 steps**
(switch profile → show animation + sound + board logo → delay → hide sources → switch back), and the
team page alone holds **607 chained actions**. Multiply by 5 PCs and every change means editing 5
scene collections, 5 graphics folders, and 5 deck profiles by hand. That is the exact fragility we're
deleting.

## The decision: cloud-state overlay ("the overlay is a website")

**One rule drives everything: graphics live at a URL, not on a PC.** Each OBS instance renders three
Browser Sources pointing at the same hosted page. The page subscribes to a single shared *state
document* over WebSockets. Change the state once — from the control panel, a Stream Deck button, or
your laptop in Maryland — and all five PCs repaint within ~100–250 ms. No files copied, no OBS opened,
no profiles re-imported.

```
                        ┌──────────────────────────────┐
  Control panel (any    │       SUPABASE (free tier)   │
  phone/laptop) ───────►│  stream_state (jsonb, 1 row) │
                        │  events (one-shot triggers)  │
  Stream Deck ──HTTPS──►│  assets (template library)   │
  (deck edge function)  │  Storage: /media bucket      │
                        │  Edge fn: generate-asset (AI)│
                        └──────────────┬───────────────┘
                             realtime WebSocket push
          ┌──────────┬──────────┬──────┴───┬──────────┐
        PC 1        PC 2       PC 3      PC 4       PC 5
     OBS browser sources (bg / hud / fx) — identical URL, ?pc=N
```

### Stack (total infrastructure cost: $0/month)

| Piece | Choice | Why |
|---|---|---|
| State + realtime + storage + functions | **Supabase free tier** | One service does the database, WebSocket fan-out, file hosting, and serverless endpoints. 500 MB DB + 1 GB storage + 5 GB egress free — plenty for overlay graphics. Alternative (Firebase) is equivalent; Supabase's SQL + REST is easier for the Stream Deck. |
| Overlay + control hosting | **Cloudflare Pages** (or GitHub Pages) | Free, global CDN, deploys with one command. It's static HTML — nothing to maintain. |
| Overlay tech | **Plain HTML/CSS/JS browser sources** | OBS's browser source is Chromium: 60 fps CSS/WebM animation, alpha-channel video, audio routed into the OBS mixer. No plugins to install on 5 machines. |
| AI generation | **fal.ai FLUX [dev]** via edge function (~$0.03/img) | Pay-per-image, no subscription, called server-side so the key never touches a stream PC. Recraft API is a drop-in alternative. |

### Why not the alternatives

- **P2P / LAN mesh:** dies the moment you're not in the building, and your 5 PCs must stay reachable
  from each other. You explicitly want remote control — LAN-only fails the requirement.
- **Syncthing/Dropbox file sync into local OBS sources:** syncs files but not *state* (which teams are
  picked, which banner is live), still needs OBS touched per machine, and media sources cache paths.
- **obs-websocket to 5 machines:** requires port-forwarding or VPN into every PC, credentials per
  machine, and scripts that know each machine's source names. Brittle and a security headache.
- **Paid overlay SaaS (Uno/Streamlabs):** monthly cost, no 32-team custom logic, no AI pipeline, and
  you'd still be locked to their editor.

### Latency reality check

"Zero latency" over the public internet means **one WebSocket hop**: Supabase realtime pushes in
~50–150 ms on typical connections — visually instant, and *faster than your current deck macros*,
which chain a hard-coded Delay action between show/hide steps. Sound + animation fire together because
they're one event, not 19 sequenced actions.

### Stream Deck: hybrid, with graphics going straight to the cloud

- **Graphics, board, banners, games → HTTPS to the `deck` edge function.** One button = one GET
  request = every PC reacts. Buttons work identically on all 5 decks (export one profile, import
  everywhere, done forever), and even from the Stream Deck mobile app when nobody's at the desk.
- **Cameras, scene switches, mic/music mute → stay native OBS actions**, because those are genuinely
  per-machine hardware concerns. This is the only part of a deck profile that ever differs per PC.

### Resilience & independence (your 5-PCs requirement)

Each PC streams fully independently: browser sources hold their last rendered state if the internet
blips and reconnect automatically. A backend edit is a *broadcast*, never a dependency — PCs don't
talk to each other, and nothing you do on one stream can affect another except through the shared
state you intentionally change. Emergency fallback: keep the old scene collection as "AC Breakz
(legacy)" on each PC; one scene-collection switch restores the entire old system.

### What each requirement maps to

1. **Multi-PC sync** → shared `stream_state` row + realtime push to identical browser sources.
2. **Control app** → `control/index.html`: board, games, banner rotation, backgrounds, uploads, AI
   box. Every upload/generation lands in the `assets` template library automatically.
3. **Team board & games** → `overlay/index.html` renders the 32-cell copper-glass board at exactly
   1080×165 @ y480 per your layout key, with pick/eliminate modes, per-team FX + sound, and a
   full-canvas FX layer whose focus box is 667×413 @ (207, 800) — effects intentionally overscan.
4. **Stream Deck** → `deck` function endpoints (see streamdeck/STREAM_DECK_SETUP.md).
