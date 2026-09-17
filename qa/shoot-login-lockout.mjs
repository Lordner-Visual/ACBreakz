/* V19 master-control login lockout (supabase/migrate-v19-login-lockout.sql).

   Part 1 — the database functions themselves, on isolated 'test:<run>:' keys (never the live
   counters), run INSIDE the database in one Management API request (qa/sql/login-lockout-test.sql)
   because that API rate-limits a query-per-attempt suite. Always safe to run.
     - anon can neither call login_begin/login_succeed nor read panel_login_guard
     - 10 wrong -> locked 15 min; the 11th is refused even with the right password
     - a second lockout doubles; the cap holds at 24h AND repeats; escalation forgets a day after
       the last lock ended
     - a correct password resets everything, including a lock its own attempt had just tripped
     - the counting window is an hour from the first attempt
     - 50 wrong across many clients pauses every sign-in (scope global); a correct 50th undoes it
     - prune_now drops stale client rows and keeps the global one

   Part 2 (--e2e) — the deployed /panel login, end to end, from THIS machine's IP. It snapshots
   the live rows it touches (this IP and 'global') and restores them afterwards, so it neither
   leaves this network locked out nor erases a real attacker's count. Also drives the Dev master
   control page to check what an operator actually reads.

     node qa/shoot-login-lockout.mjs [--e2e]                                                   */
import { readFileSync } from "fs";

const E2E = process.argv.includes("--e2e");
const env = Object.fromEntries(readFileSync("C:/ACBreakz-Cloud/.env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
let fails = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n}${x !== "" ? "   " + x : ""}`); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function sql(q) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch("https://api.supabase.com/v1/projects/jqowngdkgnfhaworyppo/database/query", {
      method: "POST", headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }) });
    if (r.status === 429) { await sleep(2000 * (i + 1)); continue; }
    const t = await r.text();
    if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
    return JSON.parse(t);
  }
  throw new Error("SQL rate-limited");
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const near = (v, target, slack = 5) => typeof v === "number" && Math.abs(v - target) <= slack;

try {
  console.log("\n== part 1: database functions (isolated test keys) ==");

  /* ---- nobody but the server can touch it ---- */
  const H = { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, "content-type": "application/json" };
  const rpcSucceed = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/login_succeed`, { method: "POST", headers: H,
    body: JSON.stringify({ p_client: "1.2.3.4" }) });
  ok("anon cannot call login_succeed (which would erase a lockout)", rpcSucceed.status >= 400, String(rpcSucceed.status));
  const rpcBegin = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/login_begin`, { method: "POST", headers: H,
    body: JSON.stringify({ p_client: "1.2.3.4" }) });
  ok("anon cannot call login_begin", rpcBegin.status >= 400, String(rpcBegin.status));
  const read = await fetch(`${env.SUPABASE_URL}/rest/v1/panel_login_guard?select=*`, { headers: H });
  const readBody = await read.text();
  ok("anon cannot read the counters", read.status >= 400 || readBody.trim() === "[]", `${read.status} ${readBody.slice(0, 60)}`);

  /* ---- the rest runs inside the database, in one request: see qa/sql/login-lockout-test.sql ---- */
  const rows = await sql(readFileSync("C:/ACBreakz-Cloud/qa/sql/login-lockout-test.sql", "utf8"));
  if (!Array.isArray(rows) || !rows.length) { ok("the in-database checks ran", false, JSON.stringify(rows).slice(0, 200)); }
  for (const r of rows) ok(r.name, r.pass === true, r.pass ? "" : r.detail);
} finally {
  await sql(`delete from public.panel_login_guard where key like 'test:%'`).catch(() => {});
}

/* ======================= part 2: the deployed login ======================= */
if (E2E) {
  console.log("\n== part 2: deployed /panel login, from this machine ==");
  const { chromium } = await import("playwright");
  const myIp = (await fetch("https://api.ipify.org").then(r => r.text())).trim();
  const keys = [`ip:${myIp}`, "global"];
  const snap = await sql(`select * from public.panel_login_guard where key in (${keys.map(lit).join(",")})`);
  const restore = async () => {
    await sql(`delete from public.panel_login_guard where key in (${keys.map(lit).join(",")})`);
    for (const r of snap)
      await sql(`insert into public.panel_login_guard (key, fails, window_start, locked_until, lockouts, last_lock_at, updated_at)
        values (${lit(r.key)}, ${r.fails}, ${lit(r.window_start)}, ${r.locked_until ? lit(r.locked_until) : "null"}, ${r.lockouts},
                ${r.last_lock_at ? lit(r.last_lock_at) : "null"}, ${lit(r.updated_at)})`);
  };
  const H = { "content-type": "application/json", apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${env.SUPABASE_ANON_KEY}` };
  const login = (password) => fetch(`${env.SUPABASE_URL}/functions/v1/panel`, { method: "POST", headers: H,
    body: JSON.stringify({ action: "login", password }) }).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
  const WRONG = "0000" === env.PANEL_PASSWORD ? "1111" : "0000";
  try {
    await sql(`delete from public.panel_login_guard where key = ${lit(`ip:${myIp}`)}`);
    const seq = [];
    for (let i = 1; i <= 10; i++) seq.push(await login(WRONG));
    ok("wrong passwords answer 401 with a countdown",
      seq.slice(0, 9).every((r, i) => r.s === 401 && r.j.error === "wrong password" && r.j.triesLeft === 9 - i),
      JSON.stringify(seq.slice(0, 9).map(r => r.j.triesLeft)));
    ok("the 10th says the client is now locked, with a readable reason",
      seq[9].s === 401 && seq[9].j.locked === true && near(seq[9].j.retryAfter, 900) && /try again in 15 minutes/.test(seq[9].j.detail ?? ""),
      JSON.stringify(seq[9].j));
    const blocked = await login(env.PANEL_PASSWORD);
    ok("even the RIGHT password is refused while locked (429)",
      blocked.s === 429 && blocked.j.locked === true && /try again in 15 minutes/.test(blocked.j.error), JSON.stringify(blocked.j));

    await sql(`delete from public.panel_login_guard where key = ${lit(`ip:${myIp}`)}`);
    const burst = await Promise.all(Array.from({ length: 25 }, () => login(WRONG)));
    const checked = burst.filter(r => r.s === 401).length, refused = burst.filter(r => r.s === 429).length;
    ok("25 simultaneous wrong logins: at most 10 are checked, the rest refused", checked <= 10 && checked + refused === 25,
      `${checked} checked, ${refused} refused`);

    await sql(`delete from public.panel_login_guard where key = ${lit(`ip:${myIp}`)}`);
    await sql(`insert into public.panel_login_guard (key, locked_until) values ('global', now() + interval '20 seconds')
               on conflict (key) do update set locked_until = excluded.locked_until`);
    const paused = await login(env.PANEL_PASSWORD);
    ok("a global pause says new sign-ins are paused and existing devices keep working",
      paused.s === 429 && paused.j.scope === "global" && /Devices already signed in keep working/.test(paused.j.error), JSON.stringify(paused.j));
    await restore();

    const fine = await login(env.PANEL_PASSWORD);
    ok("with counters restored, the right password signs in", fine.s === 200 && !!fine.j.token, String(fine.s));

    /* what an operator actually reads, on the Dev copy of master control */
    await sql(`delete from public.panel_login_guard where key = ${lit(`ip:${myIp}`)}`);
    const b = await chromium.launch(); const p = await b.newPage();
    await p.goto("https://lordner-visual.github.io/ACBreakz/dev/control/", { waitUntil: "load" });
    const msgs = [];
    for (let i = 1; i <= 10; i++) {
      await p.fill("#lockPw", WRONG); await p.click("#lockGo");
      await p.waitForFunction(() => document.querySelector("#lockGo").textContent === "Unlock" && document.querySelector("#lockMsg").textContent, null, { timeout: 15000 });
      msgs.push(await p.innerText("#lockMsg"));
      await p.evaluate(() => { document.querySelector("#lockMsg").textContent = ""; });
    }
    await p.fill("#lockPw", env.PANEL_PASSWORD); await p.click("#lockGo");
    await p.waitForFunction(() => document.querySelector("#lockGo").textContent === "Unlock" && document.querySelector("#lockMsg").textContent, null, { timeout: 15000 });
    const lockedMsg = await p.innerText("#lockMsg");
    await b.close();
    ok("the page says plain 'Wrong password.' early on", msgs[0] === "Wrong password.", msgs[0]);
    ok("it warns in the last three tries", msgs[6] === "Wrong password — 3 tries left before sign-in locks." &&
       msgs[8] === "Wrong password — 1 try left before sign-in locks.", `${msgs[6]} | ${msgs[8]}`);
    ok("the 10th tells the operator how long the lock is", /Wrong password\. Too many wrong passwords — try again in 15 minutes\./.test(msgs[9]), msgs[9]);
    ok("then the right password shows the lock instead of signing in", /try again in 15 minutes/.test(lockedMsg), lockedMsg);
  } finally {
    await restore().catch((e) => console.log("RESTORE FAILED — clear by hand:", e.message));
  }
}

console.log(fails ? `\nDONE with ${fails} FAILURES` : "\nDONE all ok");
process.exit(fails ? 1 : 0);
