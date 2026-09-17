/* V18 — a seventh per-PC row, id 7, "Dev": the rig all testing happens on from now on.

   Why a new row instead of re-using 6: row 6 ("PC Test") was installed on a real streamer's
   machine at short notice, so it is a PRODUCTION PC now that merely still carries its test-rig
   name (it gets renamed PC6 later, together with his OBS/Stream Deck naming). Testing on it
   would mean testing on someone's live stream.

   Same shape as V16, and the same traps:
   1. stream_state_id_check is a hard CHECK — widen before inserting.
   2. board_action / state_patch / state_replace / loop_fx_toggle each clamp their pcs array with
      `between 1 and 6`; a stale clamp silently DROPS pc 7 and returns success having written
      nothing. Rewritten from their own live definitions with the literal swapped, guarded to
      touch only a function containing exactly one occurrence.
   3. assets_deselect / assets_propagate_meta iterate `select id from stream_state`, so they pick
      row 7 up by themselves. events_set_pc copies payload.pc with no range check — nothing to do.

   The broadcast default ("ALL PCs", a deck call with no pc) lives in the edge functions and
   moves from 1-5 to 1-6 there: PC6 is a real stream now, and Dev is the one rig kept out. */

/* ---- 1. widen the constraint ---- */
alter table public.stream_state drop constraint if exists stream_state_id_check;
alter table public.stream_state add constraint stream_state_id_check check (id >= 1 and id <= 7);

/* ---- 2. widen the four pcs clamps, in place, from the live definitions ---- */
do $$
declare
  f record; def text; hits int;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('board_action', 'state_patch', 'state_replace', 'loop_fx_toggle')
    order by p.proname
  loop
    def  := pg_get_functiondef(f.oid);
    hits := (length(def) - length(replace(def, 'between 1 and 6', ''))) / length('between 1 and 6');
    if hits <> 1 then
      raise exception '%: expected exactly 1 "between 1 and 6", found %', f.proname, hits;
    end if;
    execute replace(def, 'between 1 and 6', 'between 1 and 7');
    raise notice 'widened %', f.proname;
  end loop;
end $$;

/* ---- 3. seed the row ----
   From PC Test (row 6), which is itself a production-shaped board, so Dev looks like a real PC.
   Board, undo, loopFx and cmd are dropped: live show state and remote commands, not setup. */
insert into public.stream_state (id, data)
select 7, state_stamp(
         (select data from public.stream_state where id = 6)
           - 'board' - 'undo' - 'loopFx' - 'cmd'
           || jsonb_build_object('board', jsonb_build_object('picked', '{}'::jsonb,
                                                             'highlighted', '{}'::jsonb)),
         'server')
where not exists (select 1 from public.stream_state where id = 7);

/* ---- 4. prove it ---- */
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.stream_state where id = 7;
  if n <> 1 then raise exception 'Dev row missing'; end if;
  perform state_patch(array[7], '{"__v18check": true}'::jsonb, 'server');
  select coalesce((data->>'__v18check')::boolean, false) into ok
    from public.stream_state where id = 7;
  if not ok then raise exception 'state_patch did not reach pc 7 — a clamp is still 1..6'; end if;
  update public.stream_state set data = data - '__v18check' where id = 7;
  raise notice 'pc 7 present and writable';
end $$;
