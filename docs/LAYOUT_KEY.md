# Layout key with redesign notes (transcribed from the design PNG, 2026-08-08)

Canvas 1080×1920. Section geometry lives in `overlay/config.js` (GEOM).

## Streamer background (animated) — yellow dashed, 1080×480 @ y0
- Logos, animated backgrounds, effects.
- Background/effects/transitions change in sync with all other animations & banners
  for a cohesive style.
- Background chosen from backend template set; new backgrounds via upload or fully
  AI-generated (exact dimensions, brand-matched, professional). All new backgrounds
  are saved into the template library.

## Camera 1 — red, 667×413 @ (207,68)
- Streamer camera, green screen keyed out. Camera source set up in OBS (not the overlay).

## Camera 2 — yellow, 1080×1275 @ y645
- Hands / card boxes / cards camera. OBS source (not the overlay).

## NFL Team Board — purple dashed, 1080×165 @ y480
- All 32 team logos in their own boxes/containers.
- Animated background that isn't distracting.
- Each logo container has its own glossy / shimmer / reflection animation for a
  realistic, high-quality look.

## Banners — green dashed, 1080×97 @ y645 (bottom edge y742)
- Rotate through banners selected in the app; each shows 7–12 s.
- 10 s default for custom uploaded images.
- AI/text banners: 1 s per 3 words, minimum 7 s, max 12 s.
- Creation paths: upload image, text banner over backend background templates,
  or fully AI-generated banner.

## Animations — cyan, focus box 667×413 @ (207,800)
- MAIN FOCUS stays inside this box: text, solid objects, borders, logos, images —
  anything tangible. (Bounds may deliberately expand for special moments.)
- Main asset scales to fill the box as much as possible, aligned to its exact center.
- Additional effects (particles, light rays, flares, explosions, heat waves, smoke,
  fog, mist) are encouraged to overscan the box and every other section, and should
  "interact" with other elements (fog briefly fogs the board glass, light rays glint
  off metallic/glass surfaces) for a UI that feels alive.
