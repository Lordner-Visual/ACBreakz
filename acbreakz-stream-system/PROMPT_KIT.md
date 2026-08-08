# AC Breakz Visual Asset Prompt Kit

## The brand formula (prepend to everything)

```
AC Breakz esports broadcast graphic — deep navy #0B1E33 to glacial steel-blue gradient,
dark teal glass panels with beveled edges, brushed copper and antique gold #D9A441 trim,
bone-white graffiti shatter fragments, electric blue #35A7FF energy arcs, cinematic rim
light, volumetric haze, hyper-clean premium sports-network finish, no text, no watermark
```

Style reference: feed `Logo_New_2@2x.png` as an image prompt / `--sref` in Midjourney or a style
image in Recraft so every asset inherits the shatter DNA. Negative for all: `--no text, letters,
watermark, people, hands, blur, jpeg artifacts`.

## Sizing cheat sheet

| Asset | Final size | Generate at | Note |
|---|---|---|---|
| Streamer background | 1080×480 | MJ `--ar 9:4` / Recraft 1344×576 | overlay crops via cover |
| Banner art strip | 1080×97 | MJ `--ar 8:1` (max ratio) / Recraft 2048×256 | crop center band; text added in the panel composer |
| Board backplate | 1080×165 | MJ `--ar 13:2` | subtle — logos sit on top |
| FX / animation frame | full canvas | MJ `--ar 9:16`, focus center 667×413 | effects overscan on purpose |
| Team stingers | 1080×1920 video | image → AI video | export WebM VP9 **with alpha** |

## 1 · Streamer backgrounds (1080×480)

**MJ v7:**
```
[BRAND FORMULA], panoramic broadcast header backdrop for a trading card breaker,
towering wall of holographic graded card slabs receding into darkness, copper vault
doors ajar leaking gold light, floating refractor particles, shallow depth of field,
symmetrical composition with clear center space for a keyed-out host
--ar 9:4 --v 7 --style raw --stylize 250
```
Variants — swap the middle clause: `volcanic ember card cave, molten gold veins` (Volcanic drop) ·
`ice-vault freezer glow, frost on slab glass` · `midnight stadium tunnel, wet concrete reflections,
teal stadium beams` · `luxury display case interior, museum spotlights on one glowing slab`.

**Recraft (digital illustration → realistic image):** same text, size 1344×576, style "Cinematic",
brand colors locked via custom palette.

## 2 · Banner art (1080×97 strips)

```
[BRAND FORMULA], ultra-wide slim ticker strip design, diagonal speed streaks of copper
and electric blue on deep navy, faint shattered-glass texture, gradient vignette at both
ends for text legibility, flat lighting, seamless left-right tiling
--ar 8:1 --v 7 --style raw
```
Colorway swaps for your four banner types: Discord = `purple-magenta gradient streaks` · Promo code =
`charcoal black brushed metal, gold pinstripes` · Live everyday = `black & white halftone echo text
pattern` · Instagram = `cyan geo-maze pattern, floating heart particles`.

## 3 · NFL board backplate (1080×165)

```
[BRAND FORMULA], slim horizontal broadcast rail, 32 recessed empty glass sockets hint,
dark teal smoked glass with copper filament edge lighting, faint animated-circuit
etching, extremely low contrast so team logos pop on top
--ar 13:2 --v 7 --style raw --stylize 100
```

## 4 · Team pick stingers (the money shot)

Still frame (per team — swap name/colors):
```
[BRAND FORMULA], explosive reveal frame, Seattle Seahawks logo bursting through
shattered teal glass dead-center, action-green #69BE28 and navy shockwave rings,
copper shrapnel and refractor shards flying outward, radial god rays, motion blur
on debris only, logo tack sharp --ar 9:16 --v 7 --stylize 400
```
Animate (Runway Gen-4 / Kling 2 / Hailuo — image-to-video, 2–3 s):
```
Camera locked. The logo slams forward 10%, glass shards and copper sparks blast outward
past frame edges, two expanding electric-blue shockwave rings, light rays sweep across
reflective surfaces, debris settles, 2.5 seconds, loopable end on clean logo hold.
```
Export: 1080×1920, WebM VP9 with alpha (or ProRes 4444 → convert:
`ffmpeg -i in.mov -c:v libvpx-vp9 -pix_fmt yuva420p out.webm`).

## 5 · Game overlays

**Stash or Pass:** `[BRAND FORMULA], split-screen versus badge, left side molten gold vault glow
labeled zone, right side icy blue discard zone, giant beveled chrome divider bolt, arena spotlight
sweep --ar 9:16 --v 7`
**Pick Your Team wheel:** `[BRAND FORMULA], circular roulette of 32 glass tiles orbiting a copper
hub, one tile igniting in electric blue, long exposure light trails --ar 9:16 --v 7`
**Case Hit alert:** `[BRAND FORMULA], vault door blasting open, blinding gold core light, slab
silhouette rising, confetti of refractor shards, maximum hype energy --ar 9:16 --v 7 --stylize 500`

## 6 · Ambient FX plates (for the "interacting effects" note in your layout key)

Fog pass: `wisps of cold volumetric fog drifting laterally on pure black, subtle blue tint,
seamless loop, alpha-friendly --ar 9:16` · Light-ray pass: `single diagonal god ray sweeping
left-to-right on black, gold-white core, lens bloom` · Ember pass: `slow-rising copper embers and
dust motes on black`. Layer these as low-opacity looping WebMs in the FX layer so rays "hit" the
board's glass gloss exactly as your redesign notes describe.

## Workflow

Generate stills (MJ/Recraft) → upscale (MJ U / Magnific) → animate the hero pieces (Runway/Kling)
→ `ffmpeg` to alpha WebM → drag into the control panel's upload — it lands in the template library
and is live on all 5 PCs immediately. Budget guide: FLUX via the in-panel box ≈ $0.03/still; a full
32-team stinger set on Kling standard ≈ $10–15 of credits.
