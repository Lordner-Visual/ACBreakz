// ============================================================
// /panel — keyed write gateway for the control panel (M6 hardening).
// The anon key is read-only after M6; every write the panel makes goes
// through here.
//
// M7: the panel signs in with a password and gets a session token, so no
// device ever holds PANEL_KEY. See _shared/auth.ts for why.
//
//   { action:"login", password }                    -> { token } (30 days)
//   { token, action:"state",  data }                -> replace stream_state doc
//   { token, action:"event",  type, payload }       -> insert events row
//   { token, action:"asset",  asset:{kind,name,url,meta} } -> insert assets row
//   { token, action:"sign_upload", path }           -> signed upload token for media/<path>
//
// Server-side scripts may still pass { key: PANEL_KEY } instead of a token.
//
// Deploy:  supabase functions deploy panel
// Secrets: supabase secrets set PANEL_KEY=<random32> PANEL_PASSWORD=<password>
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorized, configured, issueToken, passwordOk } from "../_shared/auth.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));

  if (!configured()) return json({ error: "panel auth not configured on the server" }, 500);

  /* login is the one unauthenticated action — it is what mints the token */
  if (body.action === "login") {
    if (!passwordOk(body.password)) return json({ error: "wrong password" }, 401);
    return json({ ok: true, token: await issueToken() });
  }
  /* Operator scope: the per-PC dashboards ship an OP_KEY so they work with no login.
     It can ONLY change what its own PC is showing — never assets, uploads, deletes,
     AI spend, or another PC. Checked before the normal gate so it can stand alone. */
  const OP_KEY = Deno.env.get("OP_KEY") ?? "";
  const isOperator = !!OP_KEY && body.op === OP_KEY;
  if (isOperator) {
    const n = parseInt(String(body.pc), 10);
    if (!(n >= 1 && n <= 5)) return json({ error: "operator calls must name one PC" }, 400);
    const allowed =
      body.action === "state" || body.action === "patch" || body.action === "board" ||
      /* FX triggers (stingers, sounds, one-shots) for its own PC */
      body.action === "event" ||
      /* the banner composer: save a composed strip and register it, nothing else */
      (body.action === "sign_upload" && /^banners\/composed-[\w.-]+$/.test(String(body.path))) ||
      (body.action === "asset" && body.asset?.kind === "banner" && !body.asset?.meta?.template);
    if (!allowed) return json({ error: "operator scope: state and banner composer only" }, 403);
  } else if (!await authorized(body)) {
    return json({ error: "signed out" }, 401);
  }

  /* Anything that disappears must also stop being SELECTED, on every PC — otherwise a
     deleted banner keeps its slot in a rotation and renders as a blank frame. */
  async function deselectEverywhere(id: string, url?: string | null) {
    const { data: rows } = await sb.from("stream_state").select("id,data");
    for (const row of rows ?? []) {
      const d = row.data ?? {}; let touched = false;
      if (Array.isArray(d.banners?.rotation)) {
        const before = d.banners.rotation.length;
        d.banners.rotation = d.banners.rotation.filter(
          (b: { id?: string; url?: string }) => b?.id !== id && (!url || b?.url !== url));
        touched ||= d.banners.rotation.length !== before;
      }
      if (d.background && ((d.background.id && d.background.id === id) ||
          (url && d.background.url === url))) { d.background = null; touched = true; }
      for (const k of ["animStyle", "boardButtons", "boardBg", "buttonAnim"])
        if (d[k]?.id === id) { d[k] = null; touched = true; }
      if (Array.isArray(d.buttonAnims)) {
        const before = d.buttonAnims.length;
        d.buttonAnims = d.buttonAnims.filter((a: { id?: string }) => a?.id !== id);
        touched ||= d.buttonAnims.length !== before;
      }
      if (touched) await sb.from("stream_state").update({ data: d, updated_at: new Date() }).eq("id", row.id);
    }
  }

  const pcList = (v: unknown) => {
    const n = parseInt(String(v), 10);
    return n >= 1 && n <= 5 ? [n] : [1, 2, 3, 4, 5];   // 'all' or missing -> every PC
  };

  /* "File into any section" makes a NEW ROW POINTING AT THE SAME FILE, so a storage
     object can have several owners. Purging must only remove files that no surviving
     row still references — v9 lost two AI clips this way (the filed copy went blank
     when the original was purged). */
  const storagePath = (u: unknown): string | null => {
    if (typeof u !== "string") return null;
    const p = u.split("/storage/v1/object/public/media/")[1];
    return p ? decodeURIComponent(p) : null;
  };
  type AssetLike = { id?: string; url?: string | null; meta?: Record<string, unknown> | null };
  const fileRefs = (a: AssetLike): string[] =>
    [a.url, a.meta?.base_url, a.meta?.button_url, a.meta?.bg_url, a.meta?.poster, a.meta?.sfxUrl]
      .map(storagePath).filter((p): p is string => !!p);
  async function unreferencedFiles(purging: AssetLike[]): Promise<string[]> {
    const purgingIds = new Set(purging.map((a) => a.id));
    const { data: rows } = await sb.from("assets").select("id,url,meta");
    const inUse = new Set<string>();
    for (const r of rows ?? []) if (!purgingIds.has(r.id)) fileRefs(r).forEach((p) => inUse.add(p));
    const out = new Set<string>();
    for (const a of purging)
      for (const p of fileRefs(a)) if (!inUse.has(p)) out.add(p);
    return [...out];
  }

  switch (body.action) {
    /* V11 — three ways to write state, all of them atomic and field-scoped.
       `patch` and `board` are what the panels use now. `state` is the legacy
       whole-document write: it can no longer carry `board` unless explicitly
       forced (QA snapshot restore), so a page running old code, or one whose
       in-memory copy is stale, can never revert a Stream Deck press again. */
    case "patch": {
      if (!body.patch || typeof body.patch !== "object") return json({ error: "patch required" }, 400);
      const { data, error } = await sb.rpc("state_patch", {
        p_pcs: pcList(body.pc), p_patch: body.patch, p_writer: body.clientId ?? null });
      return error ? json({ error: error.message }, 400) : json({ ok: true, docs: data });
    }
    case "board": {
      const act = String(body.boardAction ?? "");
      const team = String(body.team ?? "").toLowerCase() || null;
      /* resolve the FX assets BEFORE the RPC — it holds a row lock and must not do I/O */
      let fx: Record<string, unknown> = {};
      if (act === "team_toggle" || act === "team_pick") {
        const [{ data: dflt }, { data: anim }] = await Promise.all([
          sb.from("assets").select("url").eq("kind", "sfx").eq("meta->>default", "true").limit(1),
          team ? sb.from("assets").select("url").eq("kind", "animation")
                   .eq("meta->>team", team).order("created_at", { ascending: false }).limit(1)
               : Promise.resolve({ data: [] }),
        ]);
        let sfxUrl = dflt?.[0]?.url ?? null;
        if (!sfxUrl) {
          const { data: newest } = await sb.from("assets").select("url")
            .eq("kind", "sfx").order("created_at", { ascending: false }).limit(1);
          sfxUrl = newest?.[0]?.url ?? null;
        }
        fx = { defaultSfxUrl: sfxUrl, teamAnimUrl: anim?.[0]?.url ?? null };
      }
      const { data, error } = await sb.rpc("board_action", {
        p_pcs: pcList(body.pc), p_action: act, p_team: team,
        p_fx: fx, p_writer: body.clientId ?? null, p_return_data: true });
      return error ? json({ error: error.message }, 400)
                   : json({ ok: true, results: data?.results ?? [] });
    }
    case "state": {
      if (!body.data || typeof body.data !== "object") return json({ error: "data required" }, 400);
      const { data, error } = await sb.rpc("state_replace", {
        p_pcs: pcList(body.pc), p_doc: body.data,
        p_writer: body.clientId ?? null, p_force: body.force === true });
      return error ? json({ error: error.message }, 500) : json({ ok: true, docs: data });
    }
    case "event": {
      if (!body.type) return json({ error: "type required" }, 400);
      const payload = { ...(body.payload ?? {}) };
      const n = parseInt(String(body.pc), 10);
      if (n >= 1 && n <= 5) payload.pc = n;
      const { error } = await sb.from("events").insert({ type: body.type, payload });
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    case "update_asset": {
      if (!body.id) return json({ error: "id required" }, 400);
      const { data: cur, error: gErr } = await sb.from("assets").select("*").eq("id", body.id).single();
      if (gErr || !cur) return json({ error: gErr?.message ?? "asset not found" }, 404);
      const meta = { ...cur.meta, ...(body.meta ?? {}) };
      const { data: upd, error } = await sb.from("assets").update({ meta }).eq("id", body.id).select().single();
      if (error) return json({ error: error.message }, 500);
      /* propagate the new meta into every PC's rotation copies / active background */
      const { data: rows } = await sb.from("stream_state").select("id,data");
      for (const row of rows ?? []) {
        let touched = false;
        const d = row.data ?? {};
        const rot = d.banners?.rotation;
        if (Array.isArray(rot)) rot.forEach((b: Record<string, unknown>, i: number) => {
          if (b?.id === body.id) { rot[i] = { ...b, meta }; touched = true; }
        });
        if (d.background?.url && d.background.url === cur.url) {
          d.background.crop = meta.crop ?? null; touched = true;
        }
        if (touched) await sb.from("stream_state").update({ data: d, updated_at: new Date() }).eq("id", row.id);
      }
      /* hiding it from the rotation list must also unselect it on every PC */
      if (body.meta?.hideRotation) await deselectEverywhere(body.id, cur.url);
      return json({ ok: true, asset: upd });
    }
    case "asset": {
      const a = body.asset ?? {};
      if (!a.kind || !a.name) return json({ error: "asset.kind and asset.name required" }, 400);
      const { data, error } = await sb.from("assets")
        .insert({ kind: a.kind, name: a.name, url: a.url ?? null, meta: a.meta ?? {} })
        .select().single();
      return error ? json({ error: error.message }, 500) : json({ ok: true, asset: data });
    }
    /* Deleting moves an asset to the trash: the row and its files stay, so it can be
       restored. `purge_asset` is the irreversible one. */
    case "delete_asset": {
      if (!body.id) return json({ error: "id required" }, 400);
      const { data: a, error: gErr } = await sb.from("assets").select("*").eq("id", body.id).single();
      if (gErr || !a) return json({ error: gErr?.message ?? "asset not found" }, 404);
      if (a.meta?.builtin) return json({ error: "built-in styles cannot be deleted" }, 400);
      const meta = { ...a.meta, deleted: true, deletedAt: new Date().toISOString() };
      const { error: uErr } = await sb.from("assets").update({ meta }).eq("id", body.id);
      if (uErr) return json({ error: uErr.message }, 500);
      await deselectEverywhere(body.id, a.url);
      return json({ ok: true });
    }
    case "restore_asset": {
      if (!body.id) return json({ error: "id required" }, 400);
      const { data: a, error: gErr } = await sb.from("assets").select("*").eq("id", body.id).single();
      if (gErr || !a) return json({ error: gErr?.message ?? "asset not found" }, 404);
      /* restoring brings it back to every list it belongs to */
      const meta = { ...a.meta };
      delete meta.deleted; delete meta.deletedAt;
      delete meta.hideComposer; delete meta.hideRotation;
      const { data: upd, error } = await sb.from("assets")
        .update({ meta }).eq("id", body.id).select().single();
      return error ? json({ error: error.message }, 500) : json({ ok: true, asset: upd });
    }
    case "purge_asset": {
      if (!body.id) return json({ error: "id required" }, 400);
      const { data: a, error: gErr } = await sb.from("assets").select("*").eq("id", body.id).single();
      if (gErr || !a) return json({ error: gErr?.message ?? "asset not found" }, 404);
      if (a.meta?.builtin) return json({ error: "built-in styles cannot be deleted" }, 400);
      /* remove only the files no OTHER row still points at */
      const paths = await unreferencedFiles([a]);
      if (paths.length) await sb.storage.from("media").remove(paths);
      const { error } = await sb.from("assets").delete().eq("id", body.id);
      if (error) return json({ error: error.message }, 500);
      await deselectEverywhere(body.id, a.url);   // a purged asset must not stay selected
      return json({ ok: true });
    }
    case "empty_trash": {
      const { data: rows } = await sb.from("assets").select("*").eq("meta->>deleted", "true");
      const paths = await unreferencedFiles(rows ?? []);
      if (paths.length) await sb.storage.from("media").remove(paths);
      for (const a of rows ?? []) await deselectEverywhere(a.id, a.url);
      const { error } = await sb.from("assets").delete().eq("meta->>deleted", "true");
      return error ? json({ error: error.message }, 500)
                   : json({ ok: true, purged: (rows ?? []).length });
    }
    case "sign_upload": {
      const path = String(body.path ?? "");
      if (!/^[\w\-/][\w\-. /]*$/.test(path) || path.includes("..")) return json({ error: "bad path" }, 400);
      const { data, error } = await sb.storage.from("media").createSignedUploadUrl(path);
      return error ? json({ error: error.message }, 500)
                   : json({ ok: true, path: data.path, token: data.token });
    }
    default:
      return json({ error: "unknown action" }, 400);
  }
});
