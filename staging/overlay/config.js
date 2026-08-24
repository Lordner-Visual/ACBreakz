/* ============================================================
   ACBreakz Stream System — shared config
   Loaded by BOTH overlay/index.html and control/index.html
   Fill in SUPABASE_URL + SUPABASE_ANON_KEY after `supabase init`.
   Leave them blank to run in PREVIEW MODE (same-browser tabs only).
   ============================================================ */
window.ACBZ = (() => {
  const qs = new URLSearchParams(location.search);

  return {
    SUPABASE_URL: "https://jqowngdkgnfhaworyppo.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impxb3duZ2RrZ25maGF3b3J5cHBvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNTgyNjMsImV4cCI6MjEwMTczNDI2M30.2M5RRKfBbgtBwVv5QvKI4Hu88Xdzh5xAhZvBxNdD4qo", // anon public key (safe to ship in overlay)

    DEVICE: Math.min(6, Math.max(1, parseInt(qs.get("pc"), 10) || 1)), // ?pc=1..6 — each PC is its own stream; 6 = PC Test
    LAYER:  qs.get("layer") || "all", // bg | hud | fx | all

    /* --- Exact geometry from layout_key (1080x1920 canvas) --- */
    GEOM: {
      CANVAS_W: 1080, CANVAS_H: 1920,
      BG:      { x: 0,   y: 0,   w: 1080, h: 480  },  // streamer background
      CAM1:    { x: 207, y: 68,  w: 667,  h: 413  },  // reference only (real cam in OBS)
      BOARD:   { x: 0,   y: 480, w: 1080, h: 165  },  // NFL team board
      BANNERS: { x: 0,   y: 645, w: 1080, h: 97   },  // rotating banners
      CAM2:    { x: 0,   y: 645, w: 1080, h: 1275 },  // reference only
      ANIM:    { x: 207, y: 800, w: 667,  h: 413  },  // animation focus box (FX may overscan)
    },

    /* --- Board rendering --- */
    BOARD_COLS: 16, BOARD_ROWS: 2,
    BOARD_PAD_X: 46, BOARD_PAD_Y: 12, BOARD_GAP: 8,

    /* Team logos served from our own Supabase Storage (migrated in M3) */
    LOGO_URL: (abbr) => `https://jqowngdkgnfhaworyppo.supabase.co/storage/v1/object/public/media/logos/${abbr}.png`,

    /* Board order = left→right, top row then bottom row.
       Edit freely to match your physical clipboard order. */
    ORDER: [
      "atl","phi","mia","dal","wsh","ind","kc","lac","ari","sf","tb","cle","den","buf","cin","chi",
      "min","ten","hou","pit","sea","no","lar","lv","ne","car","gb","det","jax","nyj","nyg","bal"
    ],

    TEAMS: {
      ari:{name:"Cardinals",  color:"#97233F"}, atl:{name:"Falcons",   color:"#A71930"},
      bal:{name:"Ravens",     color:"#241773"}, buf:{name:"Bills",     color:"#00338D"},
      car:{name:"Panthers",   color:"#0085CA"}, chi:{name:"Bears",     color:"#C83803"},
      cin:{name:"Bengals",    color:"#FB4F14"}, cle:{name:"Browns",    color:"#FF3C00"},
      dal:{name:"Cowboys",    color:"#003594"}, den:{name:"Broncos",   color:"#FB4F14"},
      det:{name:"Lions",      color:"#0076B6"}, gb:{name:"Packers",    color:"#203731"},
      hou:{name:"Texans",     color:"#03202F"}, ind:{name:"Colts",     color:"#002C5F"},
      jax:{name:"Jaguars",    color:"#006778"}, kc:{name:"Chiefs",     color:"#E31837"},
      lac:{name:"Chargers",   color:"#0080C6"}, lar:{name:"Rams",      color:"#003594"},
      lv:{name:"Raiders",     color:"#A5ACAF"}, mia:{name:"Dolphins",  color:"#008E97"},
      min:{name:"Vikings",    color:"#4F2683"}, ne:{name:"Patriots",   color:"#002244"},
      no:{name:"Saints",      color:"#D3BC8D"}, nyg:{name:"Giants",    color:"#0B2265"},
      nyj:{name:"Jets",       color:"#125740"}, phi:{name:"Eagles",    color:"#004C54"},
      pit:{name:"Steelers",   color:"#FFB612"}, sf:{name:"49ers",      color:"#AA0000"},
      sea:{name:"Seahawks",   color:"#69BE28"}, tb:{name:"Buccaneers", color:"#D50A0A"},
      ten:{name:"Titans",     color:"#4B92DB"}, wsh:{name:"Commanders",color:"#5A1414"},
    },

    /* Banner timing rules from the layout key */
    bannerSeconds(asset) {
      if (asset?.meta?.durationSec) return asset.meta.durationSec;      // manual override
      const t = asset?.meta?.type;
      if (t === "ai" || t === "text") {
        const words = (asset?.meta?.text || asset?.meta?.prompt || "").trim().split(/\s+/).filter(Boolean).length;
        return Math.min(12, Math.max(7, Math.ceil(words / 3)));         // 1s per 3 words, 7–12s
      }
      return 10;                                                        // uploaded images default
    },
  };
})();
