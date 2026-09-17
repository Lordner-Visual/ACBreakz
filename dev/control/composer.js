/* Banner composer — the ONE text renderer, shared by control/index.html and control/pc.html.

   Both pages had their own ~70-line copy of drawComposer(), which is precisely the divergence
   the master/PC parity rule exists to prevent: a typography control added to one and not the
   other produces banners the two panels disagree about. One engine, two thin UIs.

   Why this can be lavish: the composer BAKES to a 1080x97 PNG and uploads it. The font only has
   to exist in the operator's browser at compose time — nothing is installed on the five stream
   PCs, and the overlay just renders an image. So web fonts and expensive effects cost the rigs
   nothing at all. (A banner saved with meta.type:"text" and NO url is the other path: the
   overlay draws it live with CSS. That one cannot use any of this.)

   Settings live on the asset as meta.style, so a banner can be reopened and re-edited later. */
(function () {
  "use strict";

  /* ---------- fonts ----------
     Loaded from Google Fonts into the PANEL only. "system" needs no network and is the
     historical default, so a composer that cannot reach fonts.googleapis.com still works. */
  const FONTS = {
    system:   { label: "Arial Black (default)", stack: '"Arial Black","Segoe UI",sans-serif', weight: 700 },
    anton:    { label: "Anton — heavy condensed",   family: "Anton",            weight: 400 },
    bebas:    { label: "Bebas Neue — tall caps",    family: "Bebas Neue",       weight: 400 },
    archivo:  { label: "Archivo Black — solid",     family: "Archivo Black",    weight: 400 },
    teko:     { label: "Teko — very condensed",     family: "Teko",             weight: 700 },
    oswald:   { label: "Oswald — clean condensed",  family: "Oswald",           weight: 700 },
    bungee:   { label: "Bungee — signage",          family: "Bungee",           weight: 400 },
    russo:    { label: "Russo One — squared",       family: "Russo One",        weight: 400 },
    orbitron: { label: "Orbitron — techy",          family: "Orbitron",         weight: 900 },
    blackops: { label: "Black Ops One — stencil",   family: "Black Ops One",    weight: 400 },
    marker:   { label: "Permanent Marker — hand",   family: "Permanent Marker", weight: 400 },
    monoton:  { label: "Monoton — retro neon",      family: "Monoton",          weight: 400 },
    faster:   { label: "Faster One — speed",        family: "Faster One",       weight: 400 },
  };

  const stackOf = (key) => {
    const f = FONTS[key] || FONTS.system;
    return f.stack || `"${f.family}", "Arial Black", sans-serif`;
  };
  const weightOf = (key) => (FONTS[key] || FONTS.system).weight || 700;

  let linkAdded = false;
  function addFontLink() {
    if (linkAdded) return; linkAdded = true;
    const families = Object.values(FONTS).filter(f => f.family)
      .map(f => "family=" + f.family.replace(/ /g, "+") + ":wght@400;700;900").join("&");
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(l);
  }
  /* Canvas silently falls back to a default face if the font is not loaded YET, and the
     operator sees the wrong typeface baked into a PNG they cannot tell is wrong. Always await
     this before drawing. */
  async function ensureFont(key, sizePx) {
    const f = FONTS[key] || FONTS.system;
    if (!f.family) return;                       // system stack: nothing to fetch
    addFontLink();
    try {
      await document.fonts.load(`${weightOf(key)} ${Math.max(12, sizePx | 0)}px "${f.family}"`);
      await document.fonts.ready;
    } catch (e) { /* offline: the fallback stack still renders */ }
  }

  /* ---------- presets ----------
     Each paints ONE line at (x, baselineY) with the current ctx.font already set. They receive
     the measured width so gradients can span the actual glyphs rather than the whole band. */
  const PRESETS = {
    classic: { label: "Classic (brand default)", paint(ctx, line, x, y, w, s) {
      ctx.save(); ctx.shadowColor = hexA(s.accent, .65); ctx.shadowBlur = 18;
      ctx.fillStyle = s.color; ctx.fillText(line, x, y); ctx.restore();
      ctx.save(); ctx.shadowColor = "#000"; ctx.shadowOffsetY = 3;
      ctx.fillStyle = s.color; ctx.fillText(line, x, y); ctx.restore();
    } },
    outline: { label: "Outline", paint(ctx, line, x, y, w, s) {
      ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .08);
      ctx.strokeStyle = "#04101B"; ctx.strokeText(line, x, y);
      ctx.fillStyle = s.color; ctx.fillText(line, x, y); ctx.restore();
    } },
    sticker: { label: "Sticker — thick white rim", paint(ctx, line, x, y, w, s) {
      ctx.save(); ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowOffsetY = 4; ctx.shadowBlur = 6;
      ctx.lineWidth = Math.max(4, s.size * .16); ctx.strokeStyle = "#FFFFFF";
      ctx.strokeText(line, x, y); ctx.restore();
      ctx.save(); ctx.fillStyle = s.accent; ctx.fillText(line, x, y); ctx.restore();
    } },
    neon: { label: "Neon glow", paint(ctx, line, x, y, w, s) {
      ctx.save();
      for (const b of [26, 16, 8]) { ctx.shadowColor = s.accent; ctx.shadowBlur = b;
        ctx.fillStyle = hexA(s.accent, .9); ctx.fillText(line, x, y); }
      ctx.restore();
      ctx.save(); ctx.fillStyle = "#FFFFFF"; ctx.shadowColor = s.accent; ctx.shadowBlur = 6;
      ctx.fillText(line, x, y); ctx.restore();
    } },
    chrome: { label: "Chrome", paint(ctx, line, x, y, w, s) {
      const g = ctx.createLinearGradient(0, y - s.size * .8, 0, y + s.size * .25);
      g.addColorStop(0, "#FFFFFF"); g.addColorStop(.45, "#9FB6C9");
      g.addColorStop(.5, "#41586B"); g.addColorStop(.55, "#C9D6E0"); g.addColorStop(1, "#6B7C8B");
      ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .07);
      ctx.strokeStyle = "#0A1622"; ctx.strokeText(line, x, y);
      ctx.fillStyle = g; ctx.fillText(line, x, y); ctx.restore();
    } },
    gold: { label: "Gold", paint(ctx, line, x, y, w, s) {
      const g = ctx.createLinearGradient(0, y - s.size * .8, 0, y + s.size * .25);
      g.addColorStop(0, "#FFF3C4"); g.addColorStop(.4, "#E8B23C");
      g.addColorStop(.62, "#8A5A12"); g.addColorStop(1, "#F0CE72");
      ctx.save(); ctx.shadowColor = "rgba(232,178,60,.55)"; ctx.shadowBlur = 16;
      ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .07);
      ctx.strokeStyle = "#2A1A05"; ctx.strokeText(line, x, y);
      ctx.fillStyle = g; ctx.fillText(line, x, y); ctx.restore();
    } },
    fire: { label: "Fire", paint(ctx, line, x, y, w, s) {
      const g = ctx.createLinearGradient(0, y - s.size * .85, 0, y + s.size * .2);
      g.addColorStop(0, "#FFF1A8"); g.addColorStop(.45, "#FFAE23");
      g.addColorStop(.8, "#E5401A"); g.addColorStop(1, "#8E1206");
      ctx.save(); ctx.shadowColor = "rgba(255,120,20,.7)"; ctx.shadowBlur = 20;
      ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .06);
      ctx.strokeStyle = "#2B0A02"; ctx.strokeText(line, x, y);
      ctx.fillStyle = g; ctx.fillText(line, x, y); ctx.restore();
    } },
    ice: { label: "Ice", paint(ctx, line, x, y, w, s) {
      const g = ctx.createLinearGradient(0, y - s.size * .85, 0, y + s.size * .2);
      g.addColorStop(0, "#FFFFFF"); g.addColorStop(.5, "#8FD8FF"); g.addColorStop(1, "#1D6FA8");
      ctx.save(); ctx.shadowColor = "rgba(120,220,255,.75)"; ctx.shadowBlur = 20;
      ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .06);
      ctx.strokeStyle = "#062033"; ctx.strokeText(line, x, y);
      ctx.fillStyle = g; ctx.fillText(line, x, y); ctx.restore();
    } },
    extrude: { label: "3D extrude", paint(ctx, line, x, y, w, s) {
      const d = Math.max(3, s.size * .12);
      ctx.save(); ctx.fillStyle = shade(s.accent, -55);
      for (let i = d; i > 0; i--) ctx.fillText(line, x + i * .6, y + i * .6);
      ctx.restore();
      ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .05);
      ctx.strokeStyle = "#04101B"; ctx.strokeText(line, x, y);
      ctx.fillStyle = s.color; ctx.fillText(line, x, y); ctx.restore();
    } },
    slab: { label: "Slab behind text", paint(ctx, line, x, y, w, s) {
      const padX = s.size * .28, h = s.size * 1.12;
      ctx.save(); ctx.fillStyle = hexA(s.accent, .92);
      ctx.fillRect(x - w / 2 - padX, y - h * .74, w + padX * 2, h);
      ctx.fillStyle = s.color; ctx.fillText(line, x, y); ctx.restore();
    } },
    sweep: { label: "Colour sweep", paint(ctx, line, x, y, w, s) {
      const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      g.addColorStop(0, s.accent); g.addColorStop(.5, "#FFFFFF"); g.addColorStop(1, s.accent);
      ctx.save(); ctx.shadowColor = "#000"; ctx.shadowOffsetY = 3;
      ctx.fillStyle = g; ctx.fillText(line, x, y); ctx.restore();
    } },
    hollow: { label: "Hollow", paint(ctx, line, x, y, w, s) {
      ctx.save(); ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, s.size * .06);
      ctx.shadowColor = hexA(s.accent, .6); ctx.shadowBlur = 14;
      ctx.strokeStyle = s.color; ctx.strokeText(line, x, y); ctx.restore();
    } },
  };

  /* ---------- helpers ---------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function hexA(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#35A7FF"));
    const n = parseInt(m ? m[1] : "35A7FF", 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function shade(hex, d) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "#35A7FF"));
    const n = parseInt(m ? m[1] : "35A7FF", 16);
    const c = (v) => clamp(v + d, 0, 255);
    return `rgb(${c(n >> 16 & 255)},${c(n >> 8 & 255)},${c(n & 255)})`;
  }

  const DEFAULTS = {
    text: "", font: "system", preset: "classic",
    size: 44, autofit: true, lineHeight: 1.02, tracking: 1, scaleY: 1, offsetY: 0,
    upper: true, color: "#EFE9DC", accent: "#35A7FF", scrim: true,
  };
  const settingsFrom = (o) => Object.assign({}, DEFAULTS, o || {});

  /* ---------- the renderer ---------- */
  function draw(ctx, opts) {
    const W = opts.W || 1080, H = opts.H || 97;
    const s = settingsFrom(opts.settings);
    ctx.clearRect(0, 0, W, H);

    /* background: cover-fit art, or the brand gradient */
    const im = opts.bgImage;
    if (im && im.naturalWidth) {
      const k = Math.max(W / im.naturalWidth, H / im.naturalHeight);
      ctx.drawImage(im, (W - im.naturalWidth * k) / 2, (H - im.naturalHeight * k) / 2,
                    im.naturalWidth * k, im.naturalHeight * k);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, "#071527"); g.addColorStop(.5, "#274A66"); g.addColorStop(1, "#071527");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (s.scrim) {
      const sc = ctx.createLinearGradient(0, 0, 0, H);
      sc.addColorStop(0, "rgba(4,10,18,.36)"); sc.addColorStop(1, "rgba(4,10,18,.62)");
      ctx.fillStyle = sc; ctx.fillRect(0, 0, W, H);
    }

    let raw = (s.text || "").replace(/\r/g, "");
    if (!raw.trim()) raw = "YOUR BANNER TEXT";
    if (s.upper) raw = raw.toUpperCase();
    const lines = raw.split("\n").map(l => l.trim()).filter((l, i, a) => l !== "" || a.length === 1);
    if (!lines.length) lines.push(" ");

    const stack = stackOf(s.font), weight = weightOf(s.font);
    const setFont = (px) => {
      ctx.font = `${weight} ${px}px ${stack}`;
      /* letterSpacing is Chromium 99+; the panel is Chrome, and a browser without it simply
         renders at default tracking rather than breaking */
      try { ctx.letterSpacing = `${s.tracking}px`; } catch (e) {}
    };
    ctx.textAlign = "center"; ctx.textBaseline = "middle";

    /* Fit: shrink until the widest line fits the band AND the stack fits its height. The old
       code only ever checked width, because it only ever drew one line. */
    const maxW = W - 80, maxH = H - 10;
    let size = clamp(s.size | 0, 8, 200);
    if (s.autofit) {
      /* Start LARGE and shrink. Starting from the slider only ever shrank, so "auto-fit" left
         a short line floating at 44px in a band it could have filled. */
      size = 160;
      for (; size > 8; size -= 1) {
        setFont(size);
        const widest = Math.max.apply(null, lines.map(l => ctx.measureText(l).width));
        const stackH = size * s.lineHeight * lines.length * s.scaleY;
        if (widest <= maxW && stackH <= maxH) break;
      }
    }
    setFont(size);
    const draws = Object.assign({}, s, { size });

    const step = size * s.lineHeight;
    const first = H / 2 - (step * (lines.length - 1)) / 2 + 2;
    const painter = (PRESETS[s.preset] || PRESETS.classic).paint;

    ctx.save();
    /* Nudge first, in REAL pixels: inside the scaleY transform an offset would be multiplied
       by the stretch, so the same slider would move the text further at 1.8x than at 0.6x. */
    if (s.offsetY) ctx.translate(0, s.offsetY);
    /* "font height": stretch vertically about the band's middle without touching width */
    if (s.scaleY !== 1) { ctx.translate(0, H / 2); ctx.scale(1, s.scaleY); ctx.translate(0, -H / 2); }
    lines.forEach((line, i) => {
      const w = ctx.measureText(line).width;
      painter(ctx, line, W / 2, first + i * step, w, draws);
    });
    ctx.restore();
    return { size, lines: lines.length };
  }

  window.ACBZ_COMPOSER = { FONTS, PRESETS, DEFAULTS, settingsFrom, ensureFont, draw, stackOf };
})();
