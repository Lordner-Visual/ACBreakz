// ============================================================
// /deck — the Stream Deck endpoint (v2: per-PC targeting).
//
//   GET /deck?key=SECRET&action=team_pick&team=sea[&pc=2]
//   pc=1..5 targets one PC's stream; omit pc to hit ALL PCs.
//   Actions: team_pick, team_restore, board_reset, play, banner_skip,
//            set_background. (board_mode / board_visible retired in v2 —
//            the board is always eliminate-style and always visible.)
//
// Deploy:  supabase functions deploy deck --no-verify-jwt
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const DECK_KEY = Deno.env.get("DECK_KEY") ?? "";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

async function getState(pc: number) {
  const { data } = await sb.from("stream_state").select("data").eq("id", pc).single();
  return data?.data ?? {};
}
async function setState(pc: number, state: unknown) {
  await sb.from("stream_state").update({ data: state, updated_at: new Date() }).eq("id", pc);
}
async function fire(type: string, payload: Record<string, unknown>) {
  await sb.from("events").insert({ type, payload });
}
async function findAsset(kind: string, name?: string, team?: string) {
  let q = sb.from("assets").select("*").eq("kind", kind).order("created_at", { ascending: false });
  if (team) q = q.eq("meta->>team", team);
  if (name) q = q.ilike("name", `%${name}%`);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const p = Object.fromEntries(u.searchParams);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const g = (k: string) => (p[k] ?? body[k]) as string | undefined;

  if (!DECK_KEY || g("key") !== DECK_KEY) return json({ error: "bad key" }, 401);

  const action = g("action");
  const pcRaw = parseInt(g("pc") ?? "", 10);
  const pcs = pcRaw >= 1 && pcRaw <= 5 ? [pcRaw] : [1, 2, 3, 4, 5];
  const scoped = pcs.length === 1;

  switch (action) {
    /* team_toggle: the SERVER decides from the live board, so a Stream Deck key can
       never fall out of sync the way a stateful toggle button does. */
    case "team_toggle": {
      const team = (g("team") ?? "").toLowerCase();
      if (!team) return json({ error: "team required" }, 400);
      const defSfx = await findAsset("sfx");
      let removed = false;
      for (const pc of pcs) {
        const state = await getState(pc);
        state.board ??= { picked: {} }; state.board.picked ??= {};
        if (state.board.picked[team]) {                    // already out -> put it back
          delete state.board.picked[team];
          await fire("team_restore", { team, pc });
        } else {                                           // out it goes, with the FX
          removed = true;
          state.board.picked[team] = true;
          if (state.board.highlighted) delete state.board.highlighted[team];
          const style = state.animStyle;
          const sfxUrl = style?.meta && "sfxUrl" in style.meta ? style.meta.sfxUrl : (defSfx?.url ?? null);
          const payload: Record<string, unknown> = { team, pc, sfxUrl };
          if (style && style.meta?.per_team !== true && (style.url || style.meta?.base_url)) {
            payload.styleUrl = style.url ?? style.meta.base_url;
            payload.styleImage = style.meta?.image === true;
            payload.logoOverlay = true;
          } else {
            const anim = await findAsset("animation", undefined, team);
            payload.animUrl = anim?.url ?? null;
          }
          await fire("team_pick", payload);
        }
        await setState(pc, state);
      }
      return json({ ok: true, team, action: removed ? "removed" : "restored", pcs });
    }
    case "team_pick": {
      const team = (g("team") ?? "").toLowerCase();
      if (!team) return json({ error: "team required" }, 400);
      const defSfx = await findAsset("sfx");
      for (const pc of pcs) {
        const state = await getState(pc);
        state.board ??= { picked: {} }; state.board.picked ??= {};
        state.board.picked[team] = true;
        if (state.board.highlighted) delete state.board.highlighted[team]; // eliminated => unhighlighted
        const style = state.animStyle;
        /* linked SFX wins (explicit null = "No SoundFX"); fall back to the default sound */
        const sfxUrl = style?.meta && "sfxUrl" in style.meta ? style.meta.sfxUrl : (defSfx?.url ?? null);
        const payload: Record<string, unknown> = { team, pc, sfxUrl };
        if (style && style.meta?.per_team !== true && (style.url || style.meta?.base_url)) {
          payload.styleUrl = style.url ?? style.meta.base_url;   // one base + logo overlay
          payload.styleImage = style.meta?.image === true;
          payload.logoOverlay = true;
        } else {
          const anim = await findAsset("animation", undefined, team);
          payload.animUrl = anim?.url ?? null;                   // classic per-team stinger
        }
        await fire("team_pick", payload);
        await setState(pc, state);
      }
      return json({ ok: true, team, pcs });
    }
    case "team_restore": {
      const team = (g("team") ?? "").toLowerCase();
      for (const pc of pcs) {
        const state = await getState(pc);
        if (state.board?.picked) delete state.board.picked[team];
        await fire("team_restore", { team, pc });
        await setState(pc, state);
      }
      return json({ ok: true, pcs });
    }
    case "board_reset": {
      for (const pc of pcs) {
        const state = await getState(pc);
        state.board ??= {}; state.board.picked = {};
        await fire("board_reset", { pc });
        await setState(pc, state);
      }
      return json({ ok: true, pcs });
    }
    case "play": {
      const a = await findAsset("animation", g("name"));
      if (!a) return json({ error: "animation not found" }, 404);
      const boxed = a.meta?.group !== "team";
      for (const pc of pcs)
        await fire("play_animation", { url: a.url, name: a.name, boxed,
          image: a.meta?.image === true, sfxUrl: a.meta?.sfxUrl ?? null, pc });
      return json({ ok: true, name: a.name, pcs });
    }
    case "banner_skip": {
      for (const pc of pcs) await fire("banner_skip", { pc });
      return json({ ok: true, pcs });
    }
    case "set_background": {
      const a = await findAsset("background", g("name"));
      if (!a) return json({ error: "background not found" }, 404);
      for (const pc of pcs) {
        const state = await getState(pc);
        state.background = { url: a.url, name: a.name, crop: a.meta?.crop ?? null };
        await setState(pc, state);
      }
      return json({ ok: true, name: a.name, pcs });
    }
    /* ---- highlights: button animations play only on highlighted teams ---- */
    case "highlight":
    case "unhighlight":
    case "highlight_toggle": {
      const team = (g("team") ?? "").toLowerCase();
      if (!team) return json({ error: "team required" }, 400);
      for (const pc of pcs) {
        const state = await getState(pc);
        state.board ??= {}; state.board.highlighted ??= {};
        const on = action === "highlight" ? true
          : action === "unhighlight" ? false
          : !state.board.highlighted[team];
        if (on && !state.board.picked?.[team]) state.board.highlighted[team] = true;
        else delete state.board.highlighted[team];
        await setState(pc, state);
      }
      return json({ ok: true, team, pcs });
    }
    case "highlight_clear": {
      for (const pc of pcs) {
        const state = await getState(pc);
        state.board ??= {}; state.board.highlighted = {};
        await setState(pc, state);
      }
      return json({ ok: true, pcs });
    }
    case "board_mode":
    case "board_visible":
      return json({ ok: true, note: "retired in v2 — board is always eliminate-style and visible" });
    default:
      return json({ error: "unknown action" }, 400);
  }
});
