/* V16 — a sixth per-PC row, id 6, "PC Test": a staging rig that changes get proved on before
   they reach the four live streams.

   Three things have to change together, and the order matters:

   1. stream_state_id_check is CHECK (id >= 1 AND id <= 5) — a hard constraint, so the row
      cannot even be inserted until it is widened.
   2. board_action / state_patch / state_replace / loop_fx_toggle each validate their pcs array
      with `where x between 1 and 5`, so without widening they would silently DROP pc 6 —
      writes would return 200 having done nothing, which is the worst possible failure here.
   3. assets_deselect and assets_propagate_meta need NO change: they iterate
      `select id from stream_state order by id`, so they pick a new row up on their own. That
      matters more than it sounds — those are the functions that clear dangling references, and
      a per-PC slot they did not know about is exactly how a purged asset leaves a board
      pointing at a file that no longer exists.

   The four clamps are rewritten from their own live definitions with the literal swapped,
   rather than re-pasting ~200 lines of function bodies into this file. Re-transcribing them is
   how a migration silently reverts an unrelated fix, and board_action alone has had four
   revisions (V11/V12/V13/V15). The guard below refuses to touch a function whose text does not
   contain exactly one occurrence of the expected literal.

   NOTE the "all PCs" default is NOT widened. A /deck press with no ?pc= and a master-panel
   "ALL PCs" write both still mean PCs 1-5; the test rig is opted out on purpose, so a
   production broadcast never disturbs a test in progress and vice versa. That default lives in
   the edge functions (deck/index.ts, panel/index.ts), not here.                             */

/* ---- 1. widen the constraint ---- */
alter table public.stream_state drop constraint if exists stream_state_id_check;
alter table public.stream_state add constraint stream_state_id_check check (id >= 1 and id <= 6);

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
    hits := (length(def) - length(replace(def, 'between 1 and 5', ''))) / length('between 1 and 5');
    if hits <> 1 then
      raise exception '%: expected exactly 1 "between 1 and 5", found %', f.proname, hits;
    end if;
    execute replace(def, 'between 1 and 5', 'between 1 and 6');
    raise notice 'widened %', f.proname;
  end loop;
end $$;

/* ---- 3. seed the row ----
   Seeded from PC1 so the test rig LOOKS like a production PC — testing a board change against
   default styling proves very little. Board, undo and loopFx are dropped: those are live show
   state, not configuration. */
insert into public.stream_state (id, data)
select 6, state_stamp(
         (select data from public.stream_state where id = 1)
           - 'board' - 'undo' - 'loopFx'
           || jsonb_build_object('board', jsonb_build_object('picked', '{}'::jsonb,
                                                             'highlighted', '{}'::jsonb)),
         'server')
where not exists (select 1 from public.stream_state where id = 6);

/* ---- 4. prove it ---- */
do $$
declare n int; ok boolean;
begin
  select count(*) into n from public.stream_state where id = 6;
  if n <> 1 then raise exception 'PC Test row missing'; end if;
  /* a write must actually land on 6, not be silently dropped by a stale clamp */
  perform state_patch(array[6], '{"__v16check": true}'::jsonb, 'server');
  select coalesce((data->>'__v16check')::boolean, false) into ok
    from public.stream_state where id = 6;
  if not ok then raise exception 'state_patch did not reach pc 6 — a clamp is still 1..5'; end if;
  update public.stream_state set data = data - '__v16check' where id = 6;
  raise notice 'pc 6 present and writable';
end $$;
