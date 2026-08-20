-- ============================================================
-- V13 — the last two unlocked writers become atomic and field-scoped.
--
-- deselectEverywhere() and the update_asset propagation loop in the panel edge
-- function read all five stream_state rows and wrote whole documents back, with
-- no lock. A Stream Deck press landing inside that loop was silently erased
-- AFTER the API had returned ok, the stinger had played, the deck icon had
-- flipped and deck_log had recorded it.
--
-- Measured before this migration (qa/shoot-multipc.mjs, 8 rounds, five PCs
-- pressed simultaneously while one update_asset swept them): presses lost in
-- 8 of 8 rounds, twice losing all five. Reached by delete_asset, purge_asset,
-- empty_trash, hideRotation, and the Reframe "Save crop" button.
--
-- These two functions only ever touch asset-SELECTION keys. They are
-- structurally incapable of writing board / loopFx / oneshots, which is what
-- makes a press impossible to lose here.
--
-- Also drops the prune triggers: they ran a DELETE over global (not per-PC)
-- history rows while a board row lock was held, coupling every PC's presses to
-- every other PC's. Pruning now happens outside any transaction, from the deck
-- function, on a small fraction of calls.
--
-- Apply with the Management API (see migrate-v11-atomic.sql for the call shape).
-- ============================================================

-- ---------- remove one asset from every PC's selections ----------
create or replace function public.assets_deselect(
  p_id text, p_url text default null, p_writer text default null
) returns int
language plpgsql security invoker set search_path = public as $$
declare
  pc int; d jsonb; rot jsonb; kept jsonb; bg jsonb; anims jsonb;
  touched boolean; n int := 0; k text;
begin
  perform set_config('lock_timeout', '3000', true);
  for pc in select id from stream_state order by id            -- ascending, like every other writer
  loop
    select data into d from stream_state where id = pc for update;
    if not found then continue; end if;
    d := coalesce(d, '{}'::jsonb);
    touched := false;

    /* banner rotation — drop copies of this asset by id, or by url when given */
    rot := d #> '{banners,rotation}';
    if jsonb_typeof(rot) = 'array' then
      select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into kept
        from jsonb_array_elements(rot) with ordinality t(e, ord)
       where coalesce(e->>'id', '') <> p_id
         and (p_url is null or coalesce(e->>'url', '') <> p_url);
      if kept <> rot then
        d := jsonb_set(d, '{banners,rotation}', kept, true);
        touched := true;
      end if;
    end if;

    /* the streamer background is stored by url as well as id */
    bg := d->'background';
    if jsonb_typeof(bg) = 'object'
       and (coalesce(bg->>'id', '') = p_id
            or (p_url is not null and coalesce(bg->>'url', '') = p_url)) then
      d := jsonb_set(d, '{background}', 'null'::jsonb, true);
      touched := true;
    end if;

    /* single-asset style slots */
    foreach k in array array['animStyle', 'boardButtons', 'boardBg', 'buttonAnim'] loop
      if jsonb_typeof(d->k) = 'object' and coalesce(d->k->>'id', '') = p_id then
        d := jsonb_set(d, array[k], 'null'::jsonb, true);
        touched := true;
      end if;
    end loop;

    /* multi-select button animations */
    anims := d->'buttonAnims';
    if jsonb_typeof(anims) = 'array' then
      select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into kept
        from jsonb_array_elements(anims) with ordinality t(e, ord)
       where coalesce(e->>'id', '') <> p_id;
      if kept <> anims then
        d := jsonb_set(d, '{buttonAnims}', kept, true);
        touched := true;
      end if;
    end if;

    if touched then
      d := state_stamp(d, p_writer);
      update stream_state set data = d, updated_at = now() where id = pc;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------- push edited meta into every PC's copies of an asset ----------
create or replace function public.assets_propagate_meta(
  p_id text, p_url text, p_meta jsonb, p_writer text default null
) returns int
language plpgsql security invoker set search_path = public as $$
declare pc int; d jsonb; rot jsonb; nrot jsonb; touched boolean; n int := 0;
begin
  perform set_config('lock_timeout', '3000', true);
  for pc in select id from stream_state order by id
  loop
    select data into d from stream_state where id = pc for update;
    if not found then continue; end if;
    d := coalesce(d, '{}'::jsonb);
    touched := false;

    /* rotation entries are snapshots of the asset row — refresh their meta.
       `with ordinality` keeps the rotation ORDER, which the operator chose. */
    rot := d #> '{banners,rotation}';
    if jsonb_typeof(rot) = 'array' then
      select coalesce(jsonb_agg(
               case when coalesce(e->>'id', '') = p_id
                    then e || jsonb_build_object('meta', p_meta) else e end
               order by ord), '[]'::jsonb)
        into nrot
        from jsonb_array_elements(rot) with ordinality t(e, ord);
      if nrot <> rot then
        d := jsonb_set(d, '{banners,rotation}', nrot, true);
        touched := true;
      end if;
    end if;

    /* the live background keeps only the crop */
    if jsonb_typeof(d->'background') = 'object' and p_url is not null
       and coalesce(d->'background'->>'url', '') = p_url then
      d := jsonb_set(d, '{background,crop}', coalesce(p_meta->'crop', 'null'::jsonb), true);
      touched := true;
    end if;

    if touched then
      d := state_stamp(d, p_writer);
      update stream_state set data = d, updated_at = now() where id = pc;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------- prune off the hot path ----------
-- These ran on EVERY events/deck_log insert, i.e. inside board_action's row lock,
-- taking locks on global history rows and coupling all five PCs together.
drop trigger if exists trg_prune_events   on public.events;
drop trigger if exists trg_prune_deck_log on public.deck_log;

/* returns a COUNT, not void: a void function answers 204 with an empty body, which the
   client cannot parse — that threw past the caller's .catch() and 500'd the deck function
   on exactly the calls where the prune fired (measured 4 failures in 200 presses). */
drop function if exists public.prune_now();
create or replace function public.prune_now() returns int
language plpgsql security definer set search_path = public as $$
declare n int; m int;
begin
  delete from public.events   where created_at < now() - interval '1 day';
  get diagnostics n = row_count;
  delete from public.deck_log where at         < now() - interval '7 days';
  get diagnostics m = row_count;
  return n + m;
end $$;

-- ---------- SECURITY: same posture as V11/V12 ----------
revoke execute on function public.assets_deselect(text,text,text)              from public, anon, authenticated;
revoke execute on function public.assets_propagate_meta(text,text,jsonb,text)  from public, anon, authenticated;
revoke execute on function public.prune_now()                                  from public, anon, authenticated;
grant  execute on function public.assets_deselect(text,text,text)              to service_role;
grant  execute on function public.assets_propagate_meta(text,text,jsonb,text)  to service_role;
grant  execute on function public.prune_now()                                  to service_role;
