/* V19 — lock the master-control login after 10 wrong passwords.

   Why: PANEL_PASSWORD became a 4-digit PIN (2026-09-17, user's choice) and /panel's login had no
   attempt limit, so the whole space was ~10,000 requests against a public URL — and master
   control can upload, purge files and spend fal.ai credit.

   Two counters, both enforced atomically under row locks:

   - PER CLIENT ('ip:<addr>'): 10 wrong passwords within an hour of the first one locks that
     client out for 15 minutes; each further lockout doubles it (30m, 1h, ... capped at 24h), and
     that escalation clears once a day has passed since the last lock ENDED. A correct password
     resets the client completely. The key comes from Cloudflare's cf-connecting-ip, which measured
     UNFORGEABLE (a client-supplied one is refused with 1000/403, and client X-Forwarded-For values
     are discarded — whereas True-Client-IP passes straight through and must never be used).
     IPv6 is keyed by /56 in the edge function, the prefix a household is typically delegated.
   - GLOBAL ('global'): 50 wrong passwords across ALL clients within an hour pauses every new
     sign-in for 1 hour, doubling to a 6h cap. This is what stops a distributed guesser, which a
     per-client limit alone cannot. The cost is that a sustained attack can keep NEW sign-ins
     paused; every device already signed in keeps its 30-day session, and nothing else (per-PC
     dashboards, Stream Decks, PANEL_KEY scripts) uses the password. Manual unlock:
       delete from public.panel_login_guard;

   EVERY ATTEMPT IS COUNTED AS WRONG THE MOMENT IT BEGINS, and the lock trips right there; only a
   correct password (login_succeed) takes it back. That is deliberate, and it replaced a first cut
   that reserved an attempt and settled it afterwards: an adversarial review found that a settle
   step which errored left the guess uncounted while its verdict had already been decided, and
   that orphaned reservations kept alive by ongoing traffic could stop the global lock from ever
   tripping. Counting up front makes both impossible — a lost call can only ever over-count, which
   errs safe — and a burst of simultaneous guesses still serialises on the row lock, so at most 10
   passwords get compared per lock period.

   Both functions lock 'global' before the client row, every time, so they cannot deadlock each
   other. They are SECURITY DEFINER and executable by service_role ONLY: if anon could call
   login_succeed it could simply erase its own lockout.

   p_prefix namespaces the keys so tests can exercise the real functions on 'test:' rows without
   touching the live counters. The edge function always passes ''.                           */

create table if not exists public.panel_login_guard (
  key          text primary key,                     -- 'global' | 'ip:<client>' (with prefix)
  fails        int  not null default 0,              -- attempts counted this window (wrong until proven right)
  window_start timestamptz not null default now(),   -- first counted attempt of the current window
  locked_until timestamptz,
  lockouts     int  not null default 0,              -- consecutive lockouts -> doubling
  last_lock_at timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.panel_login_guard drop column if exists pending;   -- the first cut's reservation count
alter table public.panel_login_guard enable row level security;       -- no policies: only the definer functions
revoke all on public.panel_login_guard from public, anon, authenticated;
drop function if exists public.login_finish(text, boolean, text);

/* ---------------- login_begin ---------------- */
create or replace function public.login_begin(p_client text, p_prefix text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  IP_MAX constant int := 10;
  G_MAX  constant int := 50;
  gkey text := p_prefix || 'global';
  ckey text := p_prefix || 'ip:' || coalesce(nullif(p_client, ''), 'unknown');
  g public.panel_login_guard%rowtype;
  c public.panel_login_guard%rowtype;
  tripped_c boolean := false;
  tripped_g boolean := false;
begin
  insert into public.panel_login_guard (key) values (gkey) on conflict (key) do nothing;
  insert into public.panel_login_guard (key) values (ckey) on conflict (key) do nothing;
  select * into g from public.panel_login_guard where key = gkey for update;   -- ALWAYS global first
  select * into c from public.panel_login_guard where key = ckey for update;

  /* an hour after the first counted attempt the window is over */
  if g.fails > 0 and g.window_start < now() - interval '1 hour' then g.fails := 0; end if;
  if c.fails > 0 and c.window_start < now() - interval '1 hour' then c.fails := 0; end if;
  /* escalation is forgotten a full day after the last lock ENDED (measured from its start, a
     lock at the 24h cap would wipe its own escalation the instant it expired) */
  if g.lockouts > 0 and coalesce(g.locked_until, '-infinity') < now() - interval '24 hours' then g.lockouts := 0; end if;
  if c.lockouts > 0 and coalesce(c.locked_until, '-infinity') < now() - interval '24 hours' then c.lockouts := 0; end if;

  if coalesce(g.locked_until, '-infinity') > now() or coalesce(c.locked_until, '-infinity') > now() then
    update public.panel_login_guard set fails = g.fails, lockouts = g.lockouts, updated_at = now() where key = gkey;
    update public.panel_login_guard set fails = c.fails, lockouts = c.lockouts, updated_at = now() where key = ckey;
    return jsonb_build_object('allowed', false,
      'scope', case when coalesce(g.locked_until, '-infinity') >= coalesce(c.locked_until, '-infinity')
                    then 'global' else 'client' end,
      'retry_after', greatest(1, ceil(extract(epoch from greatest(
          coalesce(g.locked_until, now()), coalesce(c.locked_until, now())) - now()))::int));
  end if;

  /* count it now; login_succeed refunds it if the password turns out to be right */
  if g.fails = 0 then g.window_start := now(); end if;
  if c.fails = 0 then c.window_start := now(); end if;
  g.fails := g.fails + 1;
  c.fails := c.fails + 1;
  if c.fails >= IP_MAX then
    c.locked_until := now() + least(interval '24 hours', interval '15 minutes' * power(2, least(c.lockouts, 10)));
    c.lockouts := c.lockouts + 1; c.last_lock_at := now(); c.fails := 0; tripped_c := true;
  end if;
  if g.fails >= G_MAX then
    g.locked_until := now() + least(interval '6 hours', interval '1 hour' * power(2, least(g.lockouts, 10)));
    g.lockouts := g.lockouts + 1; g.last_lock_at := now(); g.fails := 0; tripped_g := true;
  end if;

  update public.panel_login_guard set fails = g.fails, window_start = g.window_start, locked_until = g.locked_until,
    lockouts = g.lockouts, last_lock_at = g.last_lock_at, updated_at = now() where key = gkey;
  update public.panel_login_guard set fails = c.fails, window_start = c.window_start, locked_until = c.locked_until,
    lockouts = c.lockouts, last_lock_at = c.last_lock_at, updated_at = now() where key = ckey;

  /* what to tell the caller IF the password turns out wrong */
  return jsonb_build_object('allowed', true,
    'tries_left', case when tripped_c then 0 else IP_MAX - c.fails end,
    'locked', tripped_c or tripped_g,
    'tripped_global', tripped_g,
    'scope', case when tripped_g and (not tripped_c or g.locked_until > c.locked_until) then 'global'
                  when tripped_c then 'client' end,
    'retry_after', case when tripped_c or tripped_g then ceil(extract(epoch from greatest(
                     case when tripped_g then g.locked_until else now() end,
                     case when tripped_c then c.locked_until else now() end) - now()))::int end);
end $$;

/* ---------------- login_succeed ----------------
   The password was right: the client starts clean, and the attempt login_begin charged to the
   global counter is refunded — including undoing a global pause that this very attempt tripped. */
create or replace function public.login_succeed(p_client text, p_tripped_global boolean default false,
                                                p_prefix text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  G_MAX constant int := 50;
  gkey text := p_prefix || 'global';
  ckey text := p_prefix || 'ip:' || coalesce(nullif(p_client, ''), 'unknown');
begin
  perform 1 from public.panel_login_guard where key = gkey for update;   -- same order as login_begin
  perform 1 from public.panel_login_guard where key = ckey for update;
  if p_tripped_global then
    update public.panel_login_guard
       set locked_until = null, lockouts = greatest(0, lockouts - 1), fails = G_MAX - 1, updated_at = now()
     where key = gkey;
  else
    update public.panel_login_guard set fails = greatest(0, fails - 1), updated_at = now() where key = gkey;
  end if;
  update public.panel_login_guard
     set fails = 0, lockouts = 0, locked_until = null, updated_at = now()
   where key = ckey;
  return jsonb_build_object('ok', true);
end $$;

/* service_role only — new functions are EXECUTE-able by PUBLIC by default */
revoke all on function public.login_begin(text, text) from public, anon, authenticated;
revoke all on function public.login_succeed(text, boolean, text) from public, anon, authenticated;
grant execute on function public.login_begin(text, text) to service_role;
grant execute on function public.login_succeed(text, boolean, text) to service_role;

/* rows for clients that have not tried in a week are noise; pruned by prune_now() (which the deck
   function already calls opportunistically, outside any lock) */
create or replace function public.prune_now()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int; m int; k int;
begin
  delete from public.events   where created_at < now() - interval '1 day';
  get diagnostics n = row_count;
  delete from public.deck_log where at         < now() - interval '7 days';
  get diagnostics m = row_count;
  delete from public.panel_login_guard
   where key not like '%global' and updated_at < now() - interval '7 days'
     and coalesce(locked_until, '-infinity') < now();
  get diagnostics k = row_count;
  return n + m + k;
end $$;
