-- ============================================================
-- V12 — looping one-shot animations.
--
-- The four Stream Deck animation keys (Stash or Pass, Spin 2/3 Pick 1, PYT)
-- become toggles: press once to start the clip looping on stream, press again to
-- fade it out. That state has to be a STATE key, not an event: events are dropped
-- after 20s and replay nothing, so an overlay reload would silently lose the loop.
--
--   data.loopFx = {url,name,boxed,fit,image,sfxUrl} | null
--
-- Toggling is a read-modify-write, so it gets the same `select ... for update`
-- treatment as board_action() — two rapid presses can't both read "off".
-- Pressing a DIFFERENT clip while one is looping switches straight to it.
--
-- Apply with the Management API (see migrate-v11-atomic.sql for the call shape).
-- ============================================================

create or replace function public.loop_fx_toggle(
  p_pcs int[], p_fx jsonb, p_writer text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare pc int; d jsonb; cur jsonb; on_now boolean; results jsonb := '[]'::jsonb;
begin
  perform set_config('lock_timeout', '3000', true);
  if jsonb_typeof(p_fx) <> 'object' or coalesce(p_fx->>'url','') = '' then
    raise exception 'p_fx must be an object with a url' using errcode = '22023';
  end if;
  for pc in select distinct x from unnest(p_pcs) x where x between 1 and 5 order by 1
  loop
    select data into d from stream_state where id = pc for update;
    if not found then continue; end if;
    d := coalesce(d, '{}'::jsonb);
    cur := d->'loopFx';
    /* same clip already looping -> stop; anything else -> start this one */
    on_now := not (jsonb_typeof(cur) = 'object' and cur->>'url' = p_fx->>'url');
    d := state_stamp(
           jsonb_set(d, '{loopFx}',
                     case when on_now then p_fx else 'null'::jsonb end, true),
           p_writer);
    update stream_state set data = d, updated_at = now() where id = pc;
    results := results || jsonb_build_array(jsonb_build_object(
      'pc', pc, 'looping', on_now,
      'state', case when on_now then 'on' else 'off' end));
  end loop;
  return jsonb_build_object('ok', true, 'results', results);
end $$;

revoke execute on function public.loop_fx_toggle(int[],jsonb,text) from public, anon, authenticated;
grant  execute on function public.loop_fx_toggle(int[],jsonb,text) to service_role;
