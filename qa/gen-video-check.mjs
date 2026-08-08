/* One real video generation through the queue, to verify the new model end to end
   and to eyeball whether Kling fixes the "weird look" LTX-Video produced. */
import { readFileSync, writeFileSync } from "fs";
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const call = async (body) => (await fetch(`${env.SUPABASE_URL}/functions/v1/generate-asset`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
             "content-type": "application/json" },
  body: JSON.stringify({ key: env.PANEL_KEY, ...body }) })).json();

const job = { kind: "button_anim",
  prompt: "electric blue lightning crawling around the rim of a square button, glowing energy",
  quality: "standard",
  as: { kind: "style", name: "Btn anim: lightning rim",
        meta: { domain: "button_anim", mode: "trigger" } } };

const sub = await call({ ...job, mode: "submit" });
console.log("submitted:", sub.model, sub.request_id);
const t0 = Date.now();
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const p = await call({ ...job, mode: "poll", request_id: sub.request_id, model: sub.model,
    status_url: sub.status_url, response_url: sub.response_url });
  if (p.error) { console.log("ERROR:", p.error); break; }
  if (p.asset) {
    console.log(`COMPLETED in ${Math.round((Date.now()-t0)/1000)}s -> ${p.asset.url}`);
    const bytes = new Uint8Array(await (await fetch(p.asset.url)).arrayBuffer());
    writeFileSync("C:/ACBreakz-Cloud/media-staging/btn-anim-check.mp4", bytes);
    console.log("saved", (bytes.length/1048576).toFixed(2), "MB");
    break;
  }
  process.stdout.write(`${p.status ?? "?"} `);
}
