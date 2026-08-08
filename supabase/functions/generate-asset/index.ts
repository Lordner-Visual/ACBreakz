// ============================================================
// /generate-asset — the "AI chat box" behind the control panel.
// Takes {kind, prompt}, wraps it in the AC Breakz brand formula,
// generates via fal.ai FLUX [dev] (~$0.03/image), stores the file in
// the media bucket, and inserts an assets row so it appears in the
// template library instantly.
//
// Deploy:  supabase functions deploy generate-asset
// Secrets: supabase secrets set FAL_KEY=xxxx   (fal.ai dashboard)
//
// Size strategy (providers can't do 11:1 strips):
//   background      -> 1344x576, overlay crops to 1080x480 via object-fit:cover
//   banner          -> 1344x576 art; panel's banner composer crops the
//                      1080x97 band + adds text (agent task M4)
//   animation_still -> 1080x1350 concept frame (turn into motion with
//                      Runway/Kling later — see PROMPT_KIT.md)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

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
  board_button: { width: 1024, height: 1024 },   // team-board button texture
  board_bg: { width: 1344, height: 384 },        // team-board band background
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, apikey, x-client-info" } });

  const { kind = "background", prompt = "", key = "", no_row = false, as = null } =
    await req.json().catch(() => ({}));
  const PANEL_KEY = Deno.env.get("PANEL_KEY") ?? "";
  if (!PANEL_KEY || key !== PANEL_KEY) return json({ error: "bad panel key" }, 401); // M6: spend gate
  if (!prompt.trim()) return json({ error: "prompt required" }, 400);
  if (!FAL_KEY) return json({ error: "FAL_KEY not configured" }, 500);

  const size = SIZES[kind] ?? SIZES.background;

  // fal.ai FLUX [dev] — simple sync REST call
  const gen = await fetch("https://fal.run/fal-ai/flux/dev", {
    method: "POST",
    headers: { Authorization: `Key ${FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: BRAND + prompt,
      image_size: size,
      num_inference_steps: 28,
      num_images: 1,
    }),
  });
  if (!gen.ok) return json({ error: "generation failed: " + (await gen.text()) }, 502);
  const out = await gen.json();
  const imgUrl = out?.images?.[0]?.url;
  if (!imgUrl) return json({ error: "no image returned" }, 502);

  // Pull the image and persist it in our own storage (fal URLs expire)
  const bytes = new Uint8Array(await (await fetch(imgUrl)).arrayBuffer());
  const path = `${kind}/ai-${Date.now()}.png`;
  const { error: upErr } = await sb.storage.from("media")
    .upload(path, bytes, { contentType: "image/png" });
  if (upErr) return json({ error: "storage failed: " + upErr.message }, 500);
  const { data: pub } = sb.storage.from("media").getPublicUrl(path);

  if (no_row) return json({ ok: true, url: pub.publicUrl, path });

  const row = {
    kind: as?.kind ?? (kind === "animation_still" ? "background" : kind),
    name: as?.name ?? "AI: " + prompt.slice(0, 48),
    url: pub.publicUrl,
    meta: { type: "ai", prompt, ...(as?.meta ?? {}) },
  };
  const { data: asset, error: dbErr } = await sb.from("assets").insert(row).select().single();
  if (dbErr) return json({ error: dbErr.message }, 500);

  return json({ ok: true, asset });
});
