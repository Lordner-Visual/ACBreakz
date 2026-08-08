// ============================================================
// /generate-asset — the AI generator behind the control panel.
//
// Images  -> fal FLUX [dev]          (~$0.03, seconds, answered inline)
// Sound   -> fal stable-audio        (~$0.05, 1-4 min)
// Video   -> fal Kling               standard v1.6 (~$0.25) | best v2 master (~$1.40)
//
// Sound and video run through fal's QUEUE so a slow job can never hit the edge
// function's wall clock: the panel calls mode:"submit", then polls mode:"poll".
//
//   {key, kind, prompt}                    -> inline (images) {ok, asset|url}
//   {key, kind, prompt, mode:"submit"}     -> {ok, request_id, model}
//   {key, mode:"poll", request_id, model, kind, as} -> {ok, status} | {ok, asset}
//
// Callers pass either a panel session token (browsers) or PANEL_KEY (scripts).
//
// Deploy:  supabase functions deploy generate-asset
// Secrets: FAL_KEY, PANEL_KEY, PANEL_PASSWORD
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorized } from "../_shared/auth.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const FAL_KEY = Deno.env.get("FAL_KEY") ?? "";

const BRAND =
  "AC Breakz sports card breaking stream graphic. Deep navy #0B1E33 to steel-blue " +
  "gradient, dark teal glass panels, brushed copper and gold #D9A441 trim, bone-white " +
  "graffiti shatter accents, electric blue #35A7FF energy highlights, cinematic rim " +
  "lighting, ultra clean professional esports broadcast quality, no text, no watermark. ";

const SIZES: Record<string, { width: number; height: number }> = {
  background: { width: 1344, height: 576 },
  banner: { width: 1344, height: 576 },
  animation_still: { width: 1080, height: 1350 },
  board_button: { width: 1024, height: 1024 },
  board_bg: { width: 1344, height: 384 },
};
const AUDIO_KINDS = new Set(["sfx"]);
const VIDEO_KINDS = new Set(["board_bg_anim", "button_anim", "background_anim"]);
const ASPECT: Record<string, string> = {
  button_anim: "1:1", board_bg_anim: "16:9", background_anim: "16:9",
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", ...CORS } });

function modelFor(kind: string, quality?: string) {
  if (AUDIO_KINDS.has(kind)) return "fal-ai/stable-audio";
  if (VIDEO_KINDS.has(kind))
    return quality === "best"
      ? "fal-ai/kling-video/v2/master/text-to-video"
      : "fal-ai/kling-video/v1.6/standard/text-to-video";
  return "fal-ai/flux/dev";
}
const NO_TEXT = "text, letters, words, captions, subtitles, watermark, logo, signage, " +
  "people, hands, faces, blurry, low quality, distorted";

function payloadFor(kind: string, prompt: string) {
  if (AUDIO_KINDS.has(kind))
    return { prompt: prompt + ", clean punchy broadcast sound effect, no music bed", seconds_total: 5 };

  if (VIDEO_KINDS.has(kind)) {
    /* Effect overlays must be an ISOLATED effect on black so they can be blended over a
       button — the brand scene prompt would turn them into branded hero objects. */
    const isEffect = kind === "button_anim";
    const p = isEffect
      ? `${prompt}. Isolated visual effect on a pure solid black background. ` +
        "Only the effect is visible, no objects, no scene, no surface, no text. " +
        "Centered, macro, high contrast glow, seamless loop, locked-off camera."
      : `${BRAND}${prompt}. Wide establishing plate, seamless loop, locked-off camera, ` +
        "no text anywhere in frame.";
    return { prompt: p, negative_prompt: NO_TEXT,
             duration: "5", aspect_ratio: ASPECT[kind] ?? "16:9" };
  }
  return { prompt: BRAND + prompt, image_size: SIZES[kind] ?? SIZES.background,
           num_inference_steps: 28, num_images: 1 };
}
const pickUrl = (out: Record<string, any>) =>
  out?.images?.[0]?.url ?? out?.video?.url ?? out?.video_url ??
  out?.audio_file?.url ?? out?.audio?.url ?? out?.audio_url;

/* store the finished media in our bucket (fal URLs expire) and optionally insert a row */
async function persist(kind: string, prompt: string, mediaUrl: string,
                       no_row: boolean, as: Record<string, any> | null) {
  const res = await fetch(mediaUrl);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let contentType = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  let ext = contentType.includes("mp4") ? "mp4" : contentType.includes("webm") ? "webm"
    : contentType.includes("wav") ? "wav" : contentType.includes("mpeg") ? "mp3"
    : contentType.includes("png") ? "png" : contentType.includes("jpeg") ? "jpg" : "bin";
  if (ext === "bin") {                                   // fall back to the source extension
    const m = new URL(mediaUrl).pathname.match(/\.(\w{2,4})$/);
    if (m) { ext = m[1]; contentType = ext === "mp4" ? "video/mp4" : ext === "wav" ? "audio/wav" : contentType; }
  }
  const path = `${kind}/ai-${Date.now()}.${ext}`;
  const { error: upErr } = await sb.storage.from("media")
    .upload(path, bytes, { contentType, cacheControl: "31536000" });
  if (upErr) return { error: "storage failed: " + upErr.message };
  const { data: pub } = sb.storage.from("media").getPublicUrl(path);
  if (no_row) return { url: pub.publicUrl, path };

  const row = {
    kind: as?.kind ?? (kind === "animation_still" ? "background" : kind),
    name: as?.name ?? "AI: " + prompt.slice(0, 48),
    url: pub.publicUrl,
    meta: { type: "ai", prompt, ...(as?.meta ?? {}) },
  };
  const { data: asset, error: dbErr } = await sb.from("assets").insert(row).select().single();
  if (dbErr) return { error: dbErr.message };
  return { asset };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = await req.json().catch(() => ({}));
  const { kind = "background", prompt = "", key = "", no_row = false, as = null,
          mode = "inline", quality = "standard", request_id = "", model: modelIn = "" } = body;
  if (!await authorized({ key, token: body.token })) return json({ error: "signed out" }, 401);
  if (!FAL_KEY) return json({ error: "FAL_KEY not configured" }, 500);

  /* ---- poll an already-submitted queue job ----
     fal's queue lives under owner/app even for nested model paths
     (fal-ai/kling-video/v1.6/... -> fal-ai/kling-video/requests/...), so prefer the
     status_url/response_url fal handed back at submit time. */
  if (mode === "poll") {
    if (!request_id) return json({ error: "request_id required" }, 400);
    const base = modelIn ? modelIn.split("/").slice(0, 2).join("/") : "";
    const statusUrl = body.status_url ?? `https://queue.fal.run/${base}/requests/${request_id}/status`;
    const resultUrl = body.response_url ?? `https://queue.fal.run/${base}/requests/${request_id}`;
    const st = await fetch(statusUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
    if (!st.ok) return json({ error: `status check failed (${st.status}): ${await st.text()}` }, 502);
    const status = await st.json();
    if (status.status !== "COMPLETED") return json({ ok: true, status: status.status ?? "IN_PROGRESS" });

    const rr = await fetch(resultUrl, { headers: { Authorization: `Key ${FAL_KEY}` } });
    if (!rr.ok) return json({ error: "result fetch failed: " + (await rr.text()) }, 502);
    const out = await rr.json();
    const mediaUrl = pickUrl(out);
    if (!mediaUrl) return json({ error: "no media in result" }, 502);
    const done = await persist(kind, prompt, mediaUrl, no_row, as);
    if (done.error) return json({ error: done.error }, 500);
    return json({ ok: true, status: "COMPLETED", ...done });
  }

  if (!String(prompt).trim()) return json({ error: "prompt required" }, 400);
  const model = modelFor(kind, quality);
  const payload = payloadFor(kind, prompt);

  /* ---- submit to the queue (slow kinds) ---- */
  if (mode === "submit") {
    const q = await fetch(`https://queue.fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${FAL_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!q.ok) return json({ error: "submit failed: " + (await q.text()) }, 502);
    const out = await q.json();
    if (!out.request_id) return json({ error: "no request_id returned" }, 502);
    return json({ ok: true, request_id: out.request_id, model,
                  status_url: out.status_url, response_url: out.response_url });
  }

  /* ---- inline (images) ---- */
  const gen = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!gen.ok) return json({ error: "generation failed: " + (await gen.text()) }, 502);
  const mediaUrl = pickUrl(await gen.json());
  if (!mediaUrl) return json({ error: "no media returned" }, 502);
  const done = await persist(kind, prompt, mediaUrl, no_row, as);
  if (done.error) return json({ error: done.error }, 500);
  return json({ ok: true, ...done });
});
