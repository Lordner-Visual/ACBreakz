// ============================================================
// /deck — the Stream Deck endpoint (v2: per-PC targeting).
//
//   GET /deck?key=SECRET&action=team_pick&team=sea[&pc=2]
//   pc=1..6 targets one PC's stream (6 = PC Test); omit pc to hit PCs 1-5 only.
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

/* PostgREST can hand a transient 401/5xx even to a service-role call — measured 16 in
   48h across assets/stream_state/prune_now. Every lookup below used to destructure only
   `data` and drop `error` on the floor, so a blip returned null and the press went
   through with NO stinger: the team left the board, the sfx played, nothing rendered.
   That is indistinguishable from "the clip is missing" and it is why this was invisible.
   Retry once, then give up LOUDLY so it shows up in the function logs. */
async function q1<T>(label: string, run: () => PromiseLike<{ data: T | null; error: unknown }>) {
  let last: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data, error } = await run();
    if (!error) return data;
    last = error;
    console.error(`[acbz] ${label} attempt ${attempt} failed:`, JSON.stringify(error));
    if (attempt === 1) await new Promise((r) => setTimeout(r, 150));
  }
  console.error(`[acbz] ${label} GAVE UP after 2 attempts:`, JSON.stringify(last));
  return null;
}

async function findAsset(kind: string, name?: string, team?: string) {
  const data = await q1<any[]>(`findAsset(${kind},${name ?? ""},${team ?? ""})`, () => {
    let q = sb.from("assets").select("*").eq("kind", kind).order("created_at", { ascending: false });
    if (team) q = q.eq("meta->>team", team);
    if (name) q = q.ilike("name", `%${name}%`);
    return q.limit(1);
  });
  return data?.[0] ?? null;
}
/* The panels prefer an sfx flagged default and fall back to the newest; the deck
   used to just take the newest. One rule now, resolved here. */
async function defaultSfxUrl() {
  const data = await q1<any[]>("defaultSfxUrl", () =>
    sb.from("assets").select("url,meta")
      .eq("kind", "sfx").eq("meta->>default", "true").limit(1));
  if (data?.[0]?.url) return data[0].url;
  return (await findAsset("sfx"))?.url ?? null;
}

/* Each PC picks its own team-animation set and its own variant per deck event, so
   everything below resolves PER PC. Read the rows once, outside any lock. */
async function statesFor(pcs: number[]) {
  const data = await q1<any[]>(`statesFor(${pcs.join(",")})`, () =>
    sb.from("stream_state").select("id,data").in("id", pcs));
  const m = new Map<number, Record<string, any>>();
  for (const r of data ?? []) m.set(r.id, r.data ?? {});
  return m;
}
/* The clip for this team WITHIN one set. Classic Stingers is the set-less set, so a
   new 32-clip upload cannot silently outrank it just by being newer. */
async function teamClipUrl(team: string, setId: string | null) {
  const data = await q1<any[]>(`teamClipUrl(${team},${setId ?? "classic"})`, () => {
    let q = sb.from("assets").select("url,meta").eq("kind", "animation")
      .eq("meta->>team", team).order("created_at", { ascending: false }).limit(1);
    q = setId ? q.eq("meta->>set", setId) : q.is("meta->>set", null);
    return q;
  });
  return data?.[0]?.url ?? null;
}
/* Which asset each PC plays for a deck event name. An explicit per-PC assignment
   wins; otherwise fall back to the legacy newest-matching-name. */
async function oneshotByPc(name: string, pcs: number[]) {
  const states = await statesFor(pcs);
  const ids = [...new Set(pcs.map((pc) => states.get(pc)?.oneshots?.[name]).filter(Boolean))];
  const byId = new Map<string, any>();
  if (ids.length) {
    const data = await q1<any[]>(`oneshotByPc(${name})`, () =>
      sb.from("assets").select("*").in("id", ids as string[]));
    for (const a of data ?? []) if (!a.meta?.deleted) byId.set(a.id, a);
  }
  const fallback = await findAsset("animation", name);
  const out = new Map<number, any>();
  for (const pc of pcs) {
    const id = states.get(pc)?.oneshots?.[name];
    out.set(pc, (id && byId.get(id)) || fallback);
  }
  return out;
}

/* Resolve everything the FX event might need BEFORE calling the RPC — the RPC
   holds a row lock, and no I/O may happen inside that critical section. */
async function boardCall(pcs: number[], action: string, team?: string) {
  const needsFx = action === "team_toggle" || action === "team_pick";
  const fxByPc: Record<string, unknown> = {};
  if (needsFx) {
    const [sfx, states] = await Promise.all([defaultSfxUrl(), statesFor(pcs)]);
    const setOf = (pc: number) => states.get(pc)?.animStyle?.meta?.set ?? null;
    /* one lookup per distinct set, not per PC */
    const sets = [...new Set(pcs.map(setOf))];
    const urls = new Map<string | null, string | null>();
    await Promise.all(sets.map(async (setId) =>
      urls.set(setId, team ? await teamClipUrl(team, setId) : null)));
    for (const pc of pcs)
      fxByPc[String(pc)] = { defaultSfxUrl: sfx, teamAnimUrl: urls.get(setOf(pc)) ?? null };
  }
  const { data, error } = await sb.rpc("board_action", {
    p_pcs: pcs,
    p_action: action,
    p_team: team ?? null,
    p_fx: fxByPc,
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

  /* History pruning used to run as a trigger on every events/deck_log insert — i.e.
     INSIDE board_action's row lock, taking locks on rows shared by all five PCs. It
     happens out here now, on a small fraction of calls, in its own transaction, and
     crucially NOT awaited: a press must never wait on, or fail because of, maintenance. */
  if (Math.random() < 0.02) {
    const job = (async () => { try { await sb.rpc("prune_now"); } catch (_) { /* best effort */ } })();
    try { (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
      .EdgeRuntime?.waitUntil?.(job); } catch (_) { /* not available: it still runs */ }
  }

  const action = g("action");
  const pcRaw = parseInt(g("pc") ?? "", 10);
  /* pc=6 is PC Test: addressable by name, but excluded from the no-pc broadcast so a
     production press never lands on a staging rig mid-test (and vice versa). */
  const pcs = pcRaw >= 1 && pcRaw <= 6 ? [pcRaw] : [1, 2, 3, 4, 5];
  const team = (g("team") ?? "").toLowerCase();

  /* Board actions all share one atomic path. `state` is the token a Stream Deck
     key can paint its icon from: out|in for the board, hl|off for highlights. */
  const BOARD = ["team_toggle", "team_pick", "team_restore", "board_reset",
                 "highlight", "unhighlight", "highlight_toggle", "highlight_clear",
                 /* v15: the undoable deck keys — press once to clear, again to put it back.
                    The snapshot lives in stream_state.data.undo, never in the deck. */
                 "board_reset_toggle", "highlight_clear_toggle"];
  if (action && BOARD.includes(action)) {
    const TEAMLESS = ["board_reset", "highlight_clear",
                      "board_reset_toggle", "highlight_clear_toggle"];
    const needsTeam = !TEAMLESS.includes(action);
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
      const name = g("name") ?? "";
      const chosen = await oneshotByPc(name, pcs);
      const rows = [];
      for (const pc of pcs) {
        const a = chosen.get(pc);
        if (!a) continue;
        const fit = a.meta?.fit;
        const boxed = fit === "full" ? false : a.meta?.group !== "team";
        rows.push({ type: "play_animation", payload: {
          url: a.url, name: a.name, boxed, fit,
          image: a.meta?.image === true, sfxUrl: a.meta?.sfxUrl ?? null,
          crop: a.meta?.crop ?? null, pc } });
      }
      if (!rows.length) return json({ error: "animation not found" }, 404);
      await sb.from("events").insert(rows);
      return json({ ok: true, name, pcs });
    }
    /* Same clip, but as a TOGGLE that loops until pressed again. Lives in state,
       not in an event: events are dropped after 20s and replay nothing, so an
       overlay reload would silently lose a running loop. */
    case "play_loop": {
      const name = g("name") ?? "";
      const chosen = await oneshotByPc(name, pcs);
      const results: Array<Record<string, unknown>> = [];
      for (const pc of pcs) {
        const a = chosen.get(pc);
        if (!a) continue;
        const fit = a.meta?.fit ?? null;
        const boxed = fit === "full" ? false : a.meta?.group !== "team";
        const { data, error } = await sb.rpc("loop_fx_toggle", {
          p_pcs: [pc],
          p_fx: { url: a.url, name: a.name, boxed, fit,
                  image: a.meta?.image === true, sfxUrl: a.meta?.sfxUrl ?? null,
                  crop: a.meta?.crop ?? null },   // makeLoop applies this
          p_writer: "deck",
        });
        if (error) return json({ error: error.message }, 500);
        results.push(...(data?.results ?? []));
      }
      if (!results.length) return json({ error: "animation not found" }, 404);
      const mine = results.find((r) => Number(r.pc) === pcs[0]) ?? results[0] ?? {};
      if (g("fmt") === "text") {
        return new Response(String(mine.state ?? ""), {
          headers: { "content-type": "text/plain", "access-control-allow-origin": "*" },
        });
      }
      return json({ ok: true, name, pcs, looping: mine.looping, state: mine.state });
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
