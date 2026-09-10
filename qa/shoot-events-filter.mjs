/* V17 — prove Realtime can filter events by pc, BEFORE the overlay depends on it.

   Realtime filters only work on real columns and its grammar is eq/neq/lt/lte/gt/gte/in — no
   "is null". So pc is NOT NULL with 0 meaning broadcast, and a source subscribes to
   pc=in.(0,N): its own PC plus anything addressed to everyone. If `in` were unsupported, or the
   tuple syntax were different, the overlay would silently receive NOTHING and every stinger on
   every PC would stop. That is worth a test of its own rather than a hopeful deploy.

   Uses a made-up event type, so nothing on any live rig reacts: handleEvent switches on type
   and ignores anything it does not know.

     node qa/shoot-events-filter.mjs                                                          */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const MINE = 6;                                  // subscribe as PC Test would
const TYPE = "__filtertest";
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };

const sql = async (q) => {
  const r = await fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: q }),
  });
  if (!r.ok) throw new Error(`SQL ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
const got = [];
const status = await new Promise((res) => {
  sb.channel("filtertest")
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `pc=in.(0,${MINE})` },
        (p) => { if (p.new.type === TYPE) got.push(p.new.pc); })
    .subscribe((s) => { if (s !== "SUBSCRIBING") res(s); });
  setTimeout(() => res("TIMEOUT"), 15000);
});
ok(`the pc=in.(0,${MINE}) filter is accepted by Realtime (status ${status})`, status === "SUBSCRIBED");
if (status !== "SUBSCRIBED") {
  console.log("\nthe filter grammar was rejected — do NOT ship the overlay change.");
  process.exit(1);
}

/* one addressed to us, one broadcast, one for a DIFFERENT pc */
await sql(`insert into public.events(type, payload) values
  ('${TYPE}', '{"pc":${MINE},"k":"mine"}'::jsonb),
  ('${TYPE}', '{"k":"broadcast"}'::jsonb),
  ('${TYPE}', '{"pc":3,"k":"someone else"}'::jsonb)`);
await new Promise(r => setTimeout(r, 5000));

ok("receives events addressed to this PC", got.includes(MINE));
ok("receives broadcast events (pc 0)", got.includes(0));
ok("does NOT receive another PC's events", !got.includes(3));
console.log(`  delivered pc values: [${got.join(", ")}]`);

await sql(`delete from public.events where type = '${TYPE}'`);
console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok — safe to filter the overlay");
process.exit(fails ? 1 : 0);
