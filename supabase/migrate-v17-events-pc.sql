/* V17 — give events a real `pc` column so Realtime can filter it per PC.

   THE PROBLEM. Realtime filters only work on real columns, and events keeps its pc inside the
   jsonb payload, so every overlay source subscribes UNFILTERED and receives all five PCs'
   events to discard four fifths of them. Delivery is capped around 10 messages/second per
   client (server-side — raising the client eventsPerSecond does not lift it; measured: at 100/s
   the peak still pinned to exactly 10/s), so that wasted fan-out is spending a scarce budget.
   With five PCs busy this is the difference between one PC's traffic and five PCs' traffic.

   WHY A TRIGGER AND NOT AN EDIT TO board_action. Every insert site would otherwise need
   changing — three inside board_action plus the panel function's event action — which means
   rewriting the atomic core and redeploying edge functions for what is bookkeeping. A BEFORE
   INSERT FOR EACH ROW trigger populates it for every writer, present and future, with no
   caller changes at all.

   This does NOT breach the "never hold a lock for housekeeping" rule. That rule exists because
   the old STATEMENT triggers ran DELETEs over events/deck_log — global rows, taking locks a
   five-PC tap and a single-PC press could deadlock on. This trigger touches NEW and nothing
   else: no other row, no other table, no lock, O(1).

   pc = 0 MEANS BROADCAST. Realtime's filter grammar supports eq/neq/lt/lte/gt/gte/in and has
   no "is null", so a nullable column could not express "mine or everyone's" in one filter. A
   NOT NULL column with 0 for broadcast lets a source subscribe with pc=in.(0,N) and keep the
   exact semantics the client-side check had.                                                */

/* ---- 1. the column ---- */
alter table public.events add column if not exists pc smallint not null default 0;

/* ---- 2. backfill what is still retained ---- */
update public.events
   set pc = coalesce(nullif(payload->>'pc', '')::smallint, 0)
 where pc = 0 and payload ? 'pc';

/* ---- 3. keep it true for every future insert, whoever writes it ---- */
create or replace function public.events_set_pc() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  /* a payload without a pc is a deliberate broadcast; 0 is the value every source subscribes to */
  new.pc := coalesce(nullif(new.payload->>'pc', '')::smallint, 0);
  return new;
end $$;

drop trigger if exists events_set_pc_trg on public.events;
create trigger events_set_pc_trg
  before insert on public.events
  for each row execute function public.events_set_pc();

/* ---- 4. prove it, through the real writer ---- */
do $$
declare got smallint; bcast smallint;
begin
  perform board_action(array[6], 'board_reset', null, '{}'::jsonb, 'v17check');
  select pc into got from public.events
    where type = 'board_reset' and payload->>'pc' = '6'
    order by created_at desc limit 1;
  if got is distinct from 6 then
    raise exception 'trigger did not populate pc from board_action (got %)', got;
  end if;

  insert into public.events(type, payload) values ('__v17probe', '{"note":"no pc"}'::jsonb);
  select pc into bcast from public.events where type = '__v17probe' limit 1;
  if bcast is distinct from 0 then
    raise exception 'a payload with no pc must land as 0 (broadcast), got %', bcast;
  end if;
  delete from public.events where type = '__v17probe';

  raise notice 'events.pc populated: board_action -> 6, no-pc payload -> 0';
end $$;
