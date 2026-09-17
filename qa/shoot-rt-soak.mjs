/* Control experiment: do long-lived realtime websockets drop from THIS network with no OBS/browser involved?
   2026-09-17 result from the office network: 7 sockets x 55 min, 0 drops, 0 missed heartbeats, max 23ms —
   while the Dev OBS on the same network dropped once in ~1.3 source-hours.
     node qa/shoot-rt-soak.mjs [minutes] [logfile]
   A) 4 supabase-js 2.116 clients (same library the overlays pin), each subscribed to postgres_changes on the Dev row
   B) 3 raw WebSockets speaking Phoenix directly, with our own 25s heartbeat — isolates the library
   Logs every open/close (code, reason, wasClean), heartbeat round-trips and misses, for MINUTES. */
import { readFileSync, appendFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
const MINUTES = Number(process.argv[2] || 55);
const OUT = process.argv[3];
const cfg = readFileSync("C:/ACBreakz-Cloud/overlay/config.js", "utf8");
const URL = cfg.match(/SUPABASE_URL:\s*"([^"]+)"/)[1], ANON = cfg.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)[1];
const T0 = Date.now();
const log = (s) => { const line = `${new Date().toISOString().slice(11, 19)}Z +${((Date.now() - T0) / 60000).toFixed(1)}m  ${s}`; console.log(line); if (OUT) appendFileSync(OUT, line + "\n"); };
const stats = {};

for (let i = 1; i <= 4; i++) {
  const name = `lib${i}`; stats[name] = { closes: 0, opens: 0 };
  const sb = createClient(URL, ANON, { realtime: { logger: (kind, msg, data) => {
    if (kind === "transport" && /close|error|heartbeat timeout/i.test(msg)) log(`${name} transport: ${msg} ${data ? JSON.stringify(data).slice(0, 200) : ""}`);
  } } });
  const sock = sb.realtime.socketAdapter.socket;
  sock.onOpen(() => { stats[name].opens++; if (stats[name].opens > 1) log(`${name} socket re-opened (#${stats[name].opens})`); });
  sock.onClose((e) => { stats[name].closes++; log(`${name} socket CLOSED code=${e?.code} reason="${e?.reason ?? ""}" clean=${e?.wasClean}`); });
  sock.onError((e) => log(`${name} socket error ${e?.message ?? e?.type ?? ""}`));
  sb.channel(`soak-${name}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "stream_state", filter: "id=eq.7" }, () => {})
    .subscribe((st) => { if (st !== "SUBSCRIBED") log(`${name} channel ${st}`); });
}

const wsUrl = `${URL.replace("https", "wss")}/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`;
function raw(name) {
  stats[name] ??= { closes: 0, opens: 0, hbMiss: 0, maxRtt: 0 };
  const ws = new WebSocket(wsUrl);
  let ref = 0, pending = null, timer = null;
  ws.onopen = () => {
    stats[name].opens++; if (stats[name].opens > 1) log(`${name} raw re-opened (#${stats[name].opens})`);
    ws.send(JSON.stringify({ topic: `realtime:soak-${name}`, event: "phx_join", payload: { config: {} }, ref: String(++ref) }));
    timer = setInterval(() => {
      if (pending) { stats[name].hbMiss++; log(`${name} raw heartbeat NOT answered within 25s`); }
      pending = { ref: String(++ref), at: Date.now() };
      ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: pending.ref }));
    }, 25000);
  };
  ws.onmessage = (m) => { try { const j = JSON.parse(m.data);
    if (pending && j.ref === pending.ref) { const rtt = Date.now() - pending.at; stats[name].maxRtt = Math.max(stats[name].maxRtt, rtt); pending = null; }
    if (j.event === "phx_error" || j.event === "phx_close" || j.event === "system") log(`${name} raw server msg ${j.event} ${JSON.stringify(j.payload).slice(0, 200)}`);
  } catch (e) {} };
  ws.onclose = (e) => { clearInterval(timer); stats[name].closes++; log(`${name} raw CLOSED code=${e.code} reason="${e.reason}" clean=${e.wasClean}`); setTimeout(() => raw(name), 2000); };
  ws.onerror = () => {};
}
for (let i = 1; i <= 3; i++) raw(`raw${i}`);

log(`soak started: 4 library clients + 3 raw sockets for ${MINUTES} min`);
setInterval(() => log(`status ${JSON.stringify(stats)}`), 10 * 60000);
setTimeout(() => { log(`DONE ${JSON.stringify(stats)}`); process.exit(0); }, MINUTES * 60000);
