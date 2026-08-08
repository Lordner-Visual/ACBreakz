// ============================================================
// /panel — keyed write gateway for the control panel (M6 hardening).
// The anon key is read-only after M6; every write the panel makes goes
// through here, authorized by PANEL_KEY (entered once per trusted device
// in the panel's Settings tab, stored in that browser only).
//
//   { key, action:"state",  data }                -> replace stream_state doc
//   { key, action:"event",  type, payload }       -> insert events row
//   { key, action:"asset",  asset:{kind,name,url,meta} } -> insert assets row
//   { key, action:"sign_upload", path }           -> signed upload token for media/<path>
//
// Deploy:  supabase functions deploy panel
// Secrets: supabase secrets set PANEL_KEY=<random32>
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const PANEL_KEY = Deno.env.get("PANEL_KEY") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const body = await req.json().catch(() => ({}));
  if (!PANEL_KEY || body.key !== PANEL_KEY) return json({ error: "bad panel key" }, 401);

  switch (body.action) {
    case "state": {
      if (!body.data || typeof body.data !== "object") return json({ error: "data required" }, 400);
      const { error } = await sb.from("stream_state")
        .update({ data: body.data, updated_at: new Date() }).eq("id", 1);
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    case "event": {
      if (!body.type) return json({ error: "type required" }, 400);
      const { error } = await sb.from("events").insert({ type: body.type, payload: body.payload ?? {} });
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    case "asset": {
      const a = body.asset ?? {};
      if (!a.kind || !a.name) return json({ error: "asset.kind and asset.name required" }, 400);
      const { data, error } = await sb.from("assets")
        .insert({ kind: a.kind, name: a.name, url: a.url ?? null, meta: a.meta ?? {} })
        .select().single();
      return error ? json({ error: error.message }, 500) : json({ ok: true, asset: data });
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
