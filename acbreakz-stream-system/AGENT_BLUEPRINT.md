# AGENT EXECUTION BLUEPRINT — hand this folder to Claude Code

**Mission:** Deploy the ACBreakz cloud overlay system (this repo) end-to-end: Supabase backend,
hosted overlay + control panel, asset migration, Stream Deck endpoints. Ship a working v1 today;
polish is iterative.

## Ground rules (non-negotiable)

1. **Budget:** hard cap $50 total. Infra is $0 (Supabase free, Cloudflare Pages free). The only
   spend is fal.ai credits (start with $10) — never batch-generate more than 10 images without
   asking. Keep a running ledger in `BUDGET.md`.
2. **Secrets:** `FAL_KEY`, `DECK_KEY`, `SUPABASE_SERVICE_ROLE_KEY` live only in Supabase secrets /
   `.env` (gitignored). Never commit keys; never put the service-role key in frontend code.
3. **Do no harm to the live rig:** never modify the existing OBS scene collection or Stream Deck
   profile files — the new system is additive; old scenes are the rollback.
4. **Test gates:** do not advance a milestone until its acceptance check passes. Screenshot proof
   into `/qa/`.
5. Commit after every milestone with message `M<n>: <what>`.

## Prerequisites (ask the human to have ready)

Node 20+, Supabase account + CLI (`npm i -g supabase`), Cloudflare account (or GitHub for Pages),
fal.ai account + API key, the `C:/ACBreakz OBS/Graphics/` folder accessible.

## Milestones

### M0 — Local preview (15 min)
`python -m http.server 8080` in repo root → open `/control/` and
`/overlay/?layer=all&debug=1` in two tabs (same browser = preview mode).
✅ Accept: tapping Seahawks in the panel fires the burst FX + fills the board slot in the overlay
tab; debug guides sit at y=480/645/742 and the ANIM box at 667×413 @ (207,800).

### M1 — Supabase backend (30 min)
`supabase init` → `supabase link` → run `supabase/schema.sql` (db push or SQL editor) →
`supabase secrets set DECK_KEY=<random32> FAL_KEY=<key>` →
`supabase functions deploy deck --no-verify-jwt && supabase functions deploy generate-asset`.
Paste project URL + anon key into `overlay/config.js`.
✅ Accept: `curl ".../functions/v1/deck?key=K&action=team_pick&team=kc"` returns `{ok:true}` and a
row appears in `events`.

### M2 — Hosting (20 min)
`npx wrangler pages deploy . --project-name acbreakz` (fallback: GitHub Pages). Note the URL.
✅ Accept: hosted `/overlay/?layer=all&debug=1` connects (network tab shows realtime websocket);
`/control/` shows "cloud: connected"; a team pick from a phone updates a laptop overlay in <1 s.

### M3 — Asset migration (45 min)
Write `scripts/migrate.mjs`: walk `C:/ACBreakz OBS/Graphics/`, upload to the `media` bucket, insert
`assets` rows — 32 team stingers as kind `animation` with `meta.team=<abbr>` (map filename →
abbreviation, e.g. `Seahawks.webm`→`sea`, `49ers.webm`→`sf`, `Commanders.webm`→`wsh`), the `.wav` as
kind `sfx` with `meta.default=true`, TV Background webm + old-scene stills as `background`, the four
banner PNGs as `banner`. Also upload the 32 board PNGs and switch `LOGO_URL` in config to storage.
✅ Accept: team pick now plays the real team webm full-screen with the real sound on every overlay;
all four banners rotate on their 7–12 s rules.

### M4 — Banner composer + AI polish (60 min)
In the control panel's banner tab, add a canvas composer: pick a background template (or AI art),
type text, live-preview at 1080×97, export PNG → upload as a banner asset (`meta.type='text'`,
`meta.text` set so duration = 1 s per 3 words, clamp 7–12). Wire an "AI art" button that calls
`generate-asset` with kind `banner` and drops the result into the composer's background picker.
✅ Accept: a typed 9-word banner renders on stream for exactly 7 s (min rule) with brand styling.

### M5 — Vision QA loop (30 min)
`npm i -D playwright` → script `qa/shoot.mjs`: load hosted overlay `?layer=all` at 1080×1920,
screenshot before/after simulated `team_pick`, `board_reset`, banner rotation, background swap.
**Look at each screenshot** and verify against `layout_key_with_redesign_notes.png`: band positions,
board gloss/shimmer, logo centering, FX overscanning the ANIM box but keeping its core inside.
Fix and re-shoot until visually clean. Save finals to `/qa/`.
✅ Accept: 6 screenshots in `/qa/` match the layout key geometry pixel-tight.

### M6 — Handoff + hardening (30 min)
Write `RUNBOOK.md` (per-PC OBS source URLs from obs-setup/OBS_SETUP.md, Stream Deck button URL list
with the real DECK_KEY placeholder, rollback = switch to legacy scenes). Stretch (only if time):
move panel writes behind an edge function with a panel key, and drop the anon insert/update policies
in `schema.sql`.
✅ Accept: a non-technical operator can set up PC #2 in 10 minutes using only RUNBOOK.md.

## If something breaks

Realtime not firing → confirm tables are in the `supabase_realtime` publication. CORS on functions →
functions must return `access-control-allow-origin: *` (already coded). Storage 403 → re-run the
policy block in schema.sql. WebM alpha shows black → re-encode `-pix_fmt yuva420p`. Anything
destructive or ambiguous → stop and ask the human.

## Budget ledger (maintain in BUDGET.md)

| Item | Est. |
|---|---|
| Supabase, Cloudflare Pages | $0 |
| fal.ai starter credits | $10 |
| Optional: Kling/Runway credits for animated set | $10–25 |
| Optional: domain | $10/yr |
| **Total** | **≤ $45** |
