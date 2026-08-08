// ============================================================
// /deck — the Stream Deck endpoint.
// Every button becomes ONE https call (GET or POST) instead of a
// 19-step OBS multi-action. Works from any PC, phone, or automation.
//
//   GET  /deck?key=SECRET&action=team_pick&team=sea
//   GET  /deck?key=SECRET&action=team_restore&team=sea
//   GET  /deck?key=SECRET&action=board_reset
//   GET  /deck?key=SECRET&action=board_mode&mode=fill|eliminate
//   GET  /deck?key=SECRET&action=board_visible&v=0|1
//   GET  /deck?key=SECRET&action=play&name=Stash%20or%20Pass   (matches asset name)
//   GET  /deck?key=SECRET&action=banner_skip
//   GET  /deck?key=SECRET&action=set_background&name=Volcanic
//
// Deploy:  supabase functions deploy deck --no-verify-jwt
// Secrets: supabase secrets set DECK_KEY=pick-a-long-random-string
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

async function getState() {
  const { data } = await sb.from("stream_state").select("data").eq("id", 1).single();
  return data?.data ?? {};
}
async function setState(state: unknown) {
  await sb.from("stream_state").update({ data: state, updated_at: new Date() }).eq("id", 1);
}
async function fire(type: string, payload: unknown) {
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
  const state = await getState();
  state.board ??= { mode: "fill", visible: true, picked: {} };
  state.banners ??= { rotation: [] };

  switch (action) {
    case "team_pick": {
      const team = (g("team") ?? "").toLowerCase();
      if (!team) return json({ error: "team required" }, 400);
      state.board.picked[team] = true;
      const anim = await findAsset("animation", undefined, team);
      const sfxA = await findAsset("sfx");
      await fire("team_pick", { team, animUrl: anim?.url ?? null, sfxUrl: sfxA?.url ?? null });
      await setState(state);
      return json({ ok: true, team });
    }
    case "team_restore": {
      const team = (g("team") ?? "").toLowerCase();
      delete state.board.picked[team];
      await fire("team_restore", { team });
      await setState(state);
      return json({ ok: true });
    }
    case "board_reset":
      state.board.picked = {};
      await fire("board_reset", {});
      await setState(state);
      return json({ ok: true });
    case "board_mode":
      state.board.mode = g("mode") === "eliminate" ? "eliminate" : "fill";
      await setState(state);
      return json({ ok: true, mode: state.board.mode });
    case "board_visible":
      state.board.visible = g("v") !== "0";
      await setState(state);
      return json({ ok: true });
    case "play": {
      const a = await findAsset("animation", g("name"));
      if (!a) return json({ error: "animation not found" }, 404);
      const sfxA = a.meta?.sfxUrl ? { url: a.meta.sfxUrl } : null;
      await fire("play_animation", { url: a.url, sfxUrl: sfxA?.url ?? null, name: a.name });
      return json({ ok: true, name: a.name });
    }
    case "banner_skip":
      await fire("banner_skip", {});
      return json({ ok: true });
    case "set_background": {
      const a = await findAsset("background", g("name"));
      if (!a) return json({ error: "background not found" }, 404);
      state.background = { url: a.url, name: a.name };
      await setState(state);
      return json({ ok: true, name: a.name });
    }
    default:
      return json({ error: "unknown action" }, 400);
  }
});
