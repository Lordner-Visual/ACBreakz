/* Part 1 of qa/shoot-login-lockout.mjs: the V19 lockout functions, exercised inside the database
   in ONE request (the Management API rate-limits a query-per-attempt suite). Every key lives under
   a unique 'test:<run>:' prefix, never the live counters, and is deleted at the end. The whole block
   is one transaction, so now() is constant — time is moved by rewriting the stored timestamps
   relative to it, exactly like the expiries the functions compare against.

   The model under test: login_begin COUNTS every attempt as wrong and trips any lock itself; a
   wrong password needs nothing further; login_succeed refunds a correct one. Each scenario uses
   its own prefix so its GLOBAL counter starts at zero (a shared one tripped the backstop mid-test
   in the first cut — correct behaviour, wrong test). PL/pgSQL names are case-insensitive, so no
   variable may differ from another only by case. */
create temp table if not exists lockout_results (n serial, name text, pass boolean, detail text);
truncate lockout_results;

do $$
declare
  P   text := 'test:' || md5(clock_timestamp()::text) || ':';
  pa  text := P || 'a:';  pb text := P || 'b:';  pc text := P || 'c:';  pd text := P || 'd:';
  pe  text := P || 'e:';  pf text := P || 'f:';  pg text := P || 'g:';  ph text := P || 'h:';
  px  text := P || 'x:';   -- the decay case: pa has spent 41 global attempts by then, and 10 more trip the backstop
  beg jsonb; k int; cl int; j int; lefts text := ''; note text;
begin
  /* ---- 10 wrong, then locked ---- */
  for k in 1..10 loop
    beg := public.login_begin('10.0.0.1', pa);
    if k < 10 then lefts := lefts || (beg->>'tries_left') || ','; end if;
  end loop;
  insert into lockout_results(name, pass, detail) values
    ('wrong passwords 1-9 count down tries left 9..1', lefts = '9,8,7,6,5,4,3,2,1,', lefts),
    ('the 10th attempt is still checked, and a wrong one locks the client for 15 minutes',
      (beg->>'allowed')::boolean and (beg->>'locked')::boolean and beg->>'scope' = 'client'
      and (beg->>'retry_after')::int = 900 and (beg->>'tries_left')::int = 0, beg::text);
  beg := public.login_begin('10.0.0.1', pa);
  insert into lockout_results(name, pass, detail) values
    ('the 11th attempt is refused before any password is checked',
      not (beg->>'allowed')::boolean and beg->>'scope' = 'client' and (beg->>'retry_after')::int = 900, beg::text);
  beg := public.login_begin('10.0.0.2', pa);
  insert into lockout_results(name, pass, detail) values
    ('a different client is unaffected', (beg->>'allowed')::boolean and (beg->>'tries_left')::int = 9, beg::text);

  /* ---- doubling, cap, cap repeats, decay ---- */
  update public.panel_login_guard set locked_until = now() - interval '1 second' where key = pa || 'ip:10.0.0.1';
  beg := public.login_begin('10.0.0.1', pa);
  insert into lockout_results(name, pass, detail) values ('once the lock expires the client may try again', (beg->>'allowed')::boolean, beg::text);
  for k in 2..10 loop beg := public.login_begin('10.0.0.1', pa); end loop;
  insert into lockout_results(name, pass, detail) values
    ('a second lockout doubles to 30 minutes', (beg->>'locked')::boolean and (beg->>'retry_after')::int = 1800, beg::text);
  update public.panel_login_guard set locked_until = now() - interval '1 second', lockouts = 10 where key = pa || 'ip:10.0.0.1';
  for k in 1..10 loop beg := public.login_begin('10.0.0.1', pa); end loop;
  insert into lockout_results(name, pass, detail) values
    ('lockouts cap at 24 hours', (beg->>'locked')::boolean and (beg->>'retry_after')::int = 86400, beg::text);
  update public.panel_login_guard set locked_until = now() - interval '1 second', last_lock_at = now() - interval '24 hours 1 second', lockouts = 8
   where key = pa || 'ip:10.0.0.1';
  for k in 1..10 loop beg := public.login_begin('10.0.0.1', pa); end loop;
  insert into lockout_results(name, pass, detail) values
    ('a 24h lock that just ended is followed by another 24h lock, not 15 minutes (review finding)',
      (beg->>'locked')::boolean and (beg->>'retry_after')::int = 86400, beg::text);
  beg := public.login_begin('10.0.0.1', px);
  update public.panel_login_guard set fails = 0, locked_until = now() - interval '25 hours', lockouts = 4 where key = px || 'ip:10.0.0.1';
  for k in 1..10 loop beg := public.login_begin('10.0.0.1', px); end loop;
  insert into lockout_results(name, pass, detail) values
    ('a day after the last lock ENDED, escalation forgets: back to 15 minutes',
      (beg->>'locked')::boolean and (beg->>'retry_after')::int = 900, beg::text);

  /* ---- a correct password resets, even on the attempt that tripped the lock ---- */
  for k in 1..7 loop beg := public.login_begin('10.0.0.3', pb); end loop;
  beg := public.login_begin('10.0.0.3', pb); perform public.login_succeed('10.0.0.3', (beg->>'tripped_global')::boolean, pb);
  beg := public.login_begin('10.0.0.3', pb);
  insert into lockout_results(name, pass, detail) values
    ('a correct password resets the count', (beg->>'tries_left')::int = 9, beg::text);
  for k in 1..9 loop beg := public.login_begin('10.0.0.4', pc); end loop;
  beg := public.login_begin('10.0.0.4', pc);
  note := beg::text;
  perform public.login_succeed('10.0.0.4', (beg->>'tripped_global')::boolean, pc);
  beg := public.login_begin('10.0.0.4', pc);
  insert into lockout_results(name, pass, detail) values
    ('a correct 10th password undoes the lock that attempt had tripped',
      note like '%"locked": true%' and (beg->>'allowed')::boolean and (beg->>'tries_left')::int = 9, note || ' then ' || beg::text);

  /* ---- the counting window ---- */
  for k in 1..9 loop beg := public.login_begin('10.0.0.5', pd); end loop;
  update public.panel_login_guard set window_start = now() - interval '61 minutes' where key = pd || 'ip:10.0.0.5';
  beg := public.login_begin('10.0.0.5', pd);
  insert into lockout_results(name, pass, detail) values
    ('attempts older than an hour from the first no longer count',
      (beg->>'tries_left')::int = 9 and not (beg->>'locked')::boolean, beg::text);

  /* ---- global backstop ---- */
  k := 0;
  <<outer>>
  for cl in 1..8 loop
    for j in 1..9 loop
      beg := public.login_begin('10.1.0.' || cl, pe);
      exit outer when not (beg->>'allowed')::boolean;
      k := k + 1;
      exit outer when (beg->>'tripped_global')::boolean;
    end loop;
  end loop;
  insert into lockout_results(name, pass, detail) values
    ('50 wrong passwords across many clients pause every sign-in for an hour',
      k = 50 and beg->>'scope' = 'global' and (beg->>'retry_after')::int = 3600, 'after ' || k || ': ' || beg::text);
  beg := public.login_begin('10.9.9.9', pe);
  insert into lockout_results(name, pass, detail) values
    ('a client that never guessed is refused too (scope global)', not (beg->>'allowed')::boolean and beg->>'scope' = 'global', beg::text);

  /* a correct 50th attempt must undo the pause it tripped, and the refund must be exact */
  for cl in 1..49 loop beg := public.login_begin('10.2.0.' || (cl % 6), pf); end loop;
  beg := public.login_begin('10.2.0.9', pf);
  note := beg::text;
  perform public.login_succeed('10.2.0.9', (beg->>'tripped_global')::boolean, pf);
  beg := public.login_begin('10.2.0.8', pf);
  insert into lockout_results(name, pass, detail) values
    ('a correct 50th password undoes the global pause it tripped, and the next wrong one re-trips it',
      note like '%"tripped_global": true%' and (beg->>'allowed')::boolean and (beg->>'tripped_global')::boolean,
      note || ' then ' || beg::text);

  /* ---- a correct login does not erase other clients' guesses from the global count ---- */
  for cl in 1..30 loop beg := public.login_begin('10.3.0.' || (cl % 4), pg); end loop;
  beg := public.login_begin('10.3.0.7', pg); perform public.login_succeed('10.3.0.7', false, pg);
  insert into lockout_results(name, pass, detail)
    select 'a correct login refunds only its own attempt from the global count',
           fails = 30, 'global fails = ' || fails from public.panel_login_guard where key = pg || 'global';

  /* ---- housekeeping ---- */
  beg := public.login_begin('10.4.0.1', ph);
  update public.panel_login_guard set updated_at = now() - interval '8 days' where key = ph || 'ip:10.4.0.1';
  perform public.prune_now();
  insert into lockout_results(name, pass, detail)
    select 'prune_now drops a week-stale client row and keeps the global one',
           not exists (select 1 from public.panel_login_guard where key = ph || 'ip:10.4.0.1')
           and exists (select 1 from public.panel_login_guard where key = ph || 'global'), '';

  delete from public.panel_login_guard where key like 'test:%';
end $$;

select name, pass, detail from lockout_results order by n;
