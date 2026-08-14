// ============================================================
// /deck — the Stream Deck endpoint (v2: per-PC targeting).
//
//   GET /deck?key=SECRET&action=team_pick&team=sea[&pc=2]
//   pc=1..5 targets one PC's stream; omit pc to hit ALL PCs.
//   Actions: team_toggle, team_pick, team_restore, board_reset, play,
//            banner_skip, set_background, highlight*, highlight_clear.
//            (board_mode / board_visible retired in v2.)
//
// V11: every board mutation goes through the board_action() SQL function, which
// takes `select ... for update` on the row. Read-modify-write in JS here was a
// lost-update race — measured 1 of 12 simultaneous presses surviving, while all
// 12 stingers still fired because the event insert was a separate write. The RPC
// makes state + event one transaction and only fires on a real transition.
// NEVER go back to getState/setState for anything under data.board.
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

async function findAsset(kind: string, name?: string, team?: string) {
  let q = sb.from("assets").select("*").eq("kind", kind).order("created_at", { ascending: false });
  if (team) q = q.eq("meta->>team", team);
  if (name) q = q.ilike("name", `%${name}%`);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}
/* The panels prefer an sfx flagged default and fall back to the newest; the deck
   used to just take the newest. One rule now, resolved here. */
async function defaultSfxUrl() {
  const { data } = await sb.from("assets").select("url,meta")
    .eq("kind", "sfx").eq("meta->>default", "true").limit(1);
  if (data?.[0]?.url) return data[0].url;
  return (await findAsset("sfx"))?.url ?? null;
}

/* Resolve everything the FX event might need BEFORE calling the RPC — the RPC
   holds a row lock, and no I/O may happen inside that critical section. */
async function boardCall(pcs: number[], action: string, team?: string) {
  const needsFx = action === "team_toggle" || action === "team_pick";
  const [sfx, anim] = needsFx
    ? await Promise.all([defaultSfxUrl(), team ? findAsset("animation", undefined, team) : null])
    : [null, null];
  const { data, error } = await sb.rpc("board_action", {
    p_pcs: pcs,
    p_action: action,
    p_team: team ?? null,
    p_fx: { defaultSfxUrl: sfx, teamAnimUrl: anim?.url ?? null },
    p_writer: "deck",
    p_return_data: false,
  });
  return { data, error };
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
  const team = (g("team") ?? "").toLowerCase();

  /* Board actions all share one atomic path. `state` is the token a Stream Deck
     key can paint its icon from: out|in for the board, hl|off for highlights. */
  const BOARD = ["team_toggle", "team_pick", "team_restore", "board_reset",
                 "highlight", "unhighlight", "highlight_toggle", "highlight_clear"];
  if (action && BOARD.includes(action)) {
    const needsTeam = action !== "board_reset" && action !== "highlight_clear";
    if (needsTeam && !team) return json({ error: "team required" }, 400);
    const { data, error } = await boardCall(pcs, action, needsTeam ? team : undefined);
    if (error) return json({ error: error.message }, 500);
    const results = (data?.results ?? []) as Array<Record<string, unknown>>;
    const mine = results.find((r) => Number(r.pc) === pcs[0]) ?? results[0] ?? {};
    /* one bare token for the deck's icon matcher; JSON for everything else */
    if (g("fmt") === "text") {
      return new Response(String(mine.state ?? ""), {
        headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
      });
    }
    return json({
      ok: true, team: needsTeam ? team : undefined, pcs,
      state: mine.state, changed: mine.changed,
      /* kept for compatibility with existing scripts */
      action: action === "team_toggle" ? (mine.picked ? "removed" : "restored") : undefined,
      results,
    });
  }

  switch (action) {
    case "play": {
      const a = await findAsset("animation", g("name"));
      if (!a) return json({ error: "animation not found" }, 404);
      const fit = a.meta?.fit;
      const boxed = fit === "full" ? false : a.meta?.group !== "team";
      const rows = pcs.map((pc) => ({ type: "play_animation", payload: {
        url: a.url, name: a.name, boxed, fit,
        image: a.meta?.image === true, sfxUrl: a.meta?.sfxUrl ?? null, pc } }));
      await sb.from("events").insert(rows);
      return json({ ok: true, name: a.name, pcs });
    }
    /* Same clip, but as a TOGGLE that loops until pressed again. Lives in state,
       not in an event: events are dropped after 20s and replay nothing, so an
       overlay reload would silently lose a running loop. */
    case "play_loop": {
      const a = await findAsset("animation", g("name"));
      if (!a) return json({ error: "animation not found" }, 404);
      const fit = a.meta?.fit ?? null;
      const boxed = fit === "full" ? false : a.meta?.group !== "team";
      const { data, error } = await sb.rpc("loop_fx_toggle", {
        p_pcs: pcs,
        p_fx: { url: a.url, name: a.name, boxed, fit,
                image: a.meta?.image === true, sfxUrl: a.meta?.sfxUrl ?? null,
                crop: a.meta?.crop ?? null },   // makeLoop applies this
        p_writer: "deck",
      });
      if (error) return json({ error: error.message }, 500);
      const mine = (data?.results ?? []).find((r: { pc: number }) => Number(r.pc) === pcs[0])
                 ?? (data?.results ?? [])[0] ?? {};
      if (g("fmt") === "text") {
        return new Response(String(mine.state ?? ""), {
          headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
        });
      }
      return json({ ok: true, name: a.name, pcs, looping: mine.looping, state: mine.state });
    }
    case "banner_skip": {
      await sb.from("events").insert(pcs.map((pc) => ({ type: "banner_skip", payload: { pc } })));
      return json({ ok: true, pcs });
    }
    case "set_background": {
      const a = await findAsset("background", g("name"));
      if (!a) return json({ error: "background not found" }, 404);
      const { error } = await sb.rpc("state_patch", {
        p_pcs: pcs,
        p_patch: { background: { url: a.url, name: a.name, crop: a.meta?.crop ?? null } },
        p_writer: "deck",
      });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, name: a.name, pcs });
    }
    case "board_mode":
    case "board_visible":
      return json({ ok: true, note: "retired in v2 — board is always eliminate-style and visible" });
    default:
      return json({ error: "unknown action" }, 400);
  }
});
