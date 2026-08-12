-- ============================================================
-- V11 — atomic, field-scoped state writes.
--
-- Before this, every writer did read -> mutate in JS -> write the WHOLE
-- stream_state.data document, with no lock and no version check. Concurrent
-- Stream Deck presses erased each other (measured: 1 of 12 landed) and a panel
-- push shipped a stale `board` that reverted presses that had landed. The
-- state write and its stinger event were also two separate writes, so the
-- overlay played 12 elimination animations for 1 recorded elimination.
--
-- Now:
--   board_action()  owns data->'board'  — and fires the FX event in the SAME
--                   transaction, only on a real transition.
--   state_patch()   owns every OTHER top-level key; may not carry 'board'.
--   state_replace() legacy whole-doc write, board-protected unless forced.
--
-- All three take `select ... for update` on the row, and lock PCs in ASCENDING
-- id order so multi-PC calls can never deadlock against each other.
--
-- Apply with the Management API:
--   POST https://api.supabase.com/v1/projects/<ref>/database/query
--   Authorization: Bearer $SUPABASE_ACCESS_TOKEN   body: {"query":"<this file>"}
-- ============================================================

-- prune_events() runs a DELETE on EVERY events insert, and that now happens
-- while a board row lock is held. It must not seq-scan.
create index if not exists events_created_at_idx on public.events (created_at);

-- ---------- audit trail ----------
create table if not exists public.deck_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  pc          int  not null,
  action      text not null,
  team        text,
  changed     boolean not null,
  before_val  boolean,
  after_val   boolean,
  writer      text
);
create index if not exists deck_log_at_idx on public.deck_log (at desc);
alter table public.deck_log enable row level security;
create policy "read deck_log" on public.deck_log for select using (true);

create or replace function public.prune_deck_log() returns trigger as $$
begin
  delete from public.deck_log where at < now() - interval '7 days';
  return null;
end; $$ language plpgsql security definer;
drop trigger if exists trg_prune_deck_log on public.deck_log;
create trigger trg_prune_deck_log after insert on public.deck_log
  for each statement execute function public.prune_deck_log();

-- ---------- one place stamps the clock + writer identity ----------
create or replace function public.state_stamp(d jsonb, p_writer text)
returns jsonb language sql immutable as $$
  select coalesce(d, '{}'::jsonb) || jsonb_build_object(
    'updatedAt',  (extract(epoch from clock_timestamp()) * 1000)::bigint,
    'lastWriter', coalesce(nullif(p_writer, ''), 'server'));
$$;

-- ---------- the board ----------
create or replace function public.board_action(
  p_pcs         int[],
  p_action      text,
  p_team        text    default null,
  p_fx          jsonb   default '{}'::jsonb,   -- {defaultSfxUrl, teamAnimUrl} pre-resolved
  p_writer      text    default null,
  p_return_data boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  pc int; d jsonb; b jsonb; style jsonb; payload jsonb;
  was_out boolean; was_hl boolean; now_out boolean; now_hl boolean; changed boolean;
  is_hl_action boolean;
  results jsonb := '[]'::jsonb;
begin
  perform set_config('lock_timeout', '3000', true);   -- never hang a key press

  if p_action not in ('team_toggle','team_pick','team_restore','board_reset',
                      'highlight','unhighlight','highlight_toggle','highlight_clear') then
    raise exception 'unknown board action %', p_action using errcode = '22023';
  end if;
  if p_action in ('team_toggle','team_pick','team_restore',
                  'highlight','unhighlight','highlight_toggle')
     and coalesce(p_team,'') = '' then
    raise exception 'team required for %', p_action using errcode = '22023';
  end if;
  is_hl_action := p_action in ('highlight','unhighlight','highlight_toggle','highlight_clear');

  for pc in select distinct x from unnest(p_pcs) x where x between 1 and 5 order by 1
  loop
    select data into d from stream_state where id = pc for update;   -- <<< the critical section
    if not found then continue; end if;
    d := coalesce(d, '{}'::jsonb);

    b := coalesce(d->'board', '{}'::jsonb);
    b := b || jsonb_build_object('picked',      coalesce(b->'picked','{}'::jsonb),
                                 'highlighted', coalesce(b->'highlighted','{}'::jsonb));

    was_out := coalesce((b->'picked'      ->> p_team)::boolean, false);
    was_hl  := coalesce((b->'highlighted' ->> p_team)::boolean, false);
    now_out := was_out; now_hl := was_hl; changed := false;

    if p_action = 'board_reset' then
      changed := (b->'picked') <> '{}'::jsonb;
      b := jsonb_set(b, '{picked}', '{}'::jsonb);
      now_out := false;

    elsif p_action = 'highlight_clear' then
      changed := (b->'highlighted') <> '{}'::jsonb;
      b := jsonb_set(b, '{highlighted}', '{}'::jsonb);
      now_hl := false;

    elsif p_action in ('highlight','unhighlight','highlight_toggle') then
      -- highlight NEVER restores an eliminated team: 'picked' is untouched here
      now_hl  := case p_action when 'highlight'   then true
                               when 'unhighlight' then false
                               else not was_hl end;
      changed := now_hl <> was_hl;
      b := jsonb_set(b, '{highlighted}',
             case when now_hl then (b->'highlighted') || jsonb_build_object(p_team, true)
                  else (b->'highlighted') - p_team end);

    else  -- team_toggle | team_pick | team_restore
      -- eliminating KEEPS highlighted[team]; the overlay hides it via .hl = hl && !picked
      now_out := case p_action when 'team_pick'    then true
                               when 'team_restore' then false
                               else not was_out end;
      changed := now_out <> was_out;
      b := jsonb_set(b, '{picked}',
             case when now_out then (b->'picked') || jsonb_build_object(p_team, true)
                  else (b->'picked') - p_team end);
    end if;

    d := state_stamp(jsonb_set(d, '{board}', b, true), p_writer);
    update stream_state set data = d, updated_at = now() where id = pc;

    -- ---- the FX event, in the SAME transaction as the state change ----
    -- team_toggle fires only on a real transition; team_pick keeps its existing
    -- "always fire" semantics so it stays usable as a replay key.
    if p_action in ('team_toggle','team_pick') and now_out
       and (changed or p_action = 'team_pick') then
      style := d->'animStyle';
      if jsonb_typeof(style) = 'object'
         and coalesce((style->'meta'->>'per_team')::boolean, false) = false
         and coalesce(style->>'url', style->'meta'->>'base_url') is not null then
        payload := jsonb_build_object(
          'team', p_team, 'pc', pc,
          'styleUrl',    coalesce(style->>'url', style->'meta'->>'base_url'),
          'styleImage',  coalesce((style->'meta'->>'image')::boolean, false),
          'styleFit',    coalesce(style->'meta'->>'fit', 'box'),
          'logoOverlay', true);
      else
        payload := jsonb_build_object('team', p_team, 'pc', pc,
                                      'animUrl', p_fx->'teamAnimUrl');
      end if;
      -- a linked sound wins; an explicit JSON null means "No SoundFX"
      payload := payload || jsonb_build_object('sfxUrl',
        case when jsonb_typeof(style->'meta') = 'object'
                  and jsonb_exists(style->'meta', 'sfxUrl')
             then style->'meta'->'sfxUrl'
             else coalesce(p_fx->'defaultSfxUrl', 'null'::jsonb) end);
      insert into events(type, payload) values ('team_pick', payload);

    elsif p_action in ('team_toggle','team_restore') and not now_out and changed then
      insert into events(type, payload)
        values ('team_restore', jsonb_build_object('team', p_team, 'pc', pc));

    elsif p_action = 'board_reset' then
      insert into events(type, payload) values ('board_reset', jsonb_build_object('pc', pc));
    end if;

    insert into deck_log(pc, action, team, changed, before_val, after_val, writer)
      values (pc, p_action, p_team, changed,
              case when is_hl_action then was_hl else was_out end,
              case when is_hl_action then now_hl else now_out end,
              p_writer);

    results := results || jsonb_build_array(jsonb_build_object(
      'pc', pc, 'team', p_team, 'action', p_action,
      'changed', changed, 'wasPicked', was_out,
      'picked', now_out, 'highlighted', now_hl,
      -- the token a Stream Deck key will paint its icon from
      'state', case when is_hl_action then case when now_hl  then 'hl'  else 'off' end
                    else                    case when now_out then 'out' else 'in'  end end,
      'board', b,
      'updatedAt', d->'updatedAt',
      'data', case when p_return_data then d else null end));
  end loop;

  return jsonb_build_object('ok', true, 'results', results);
end $$;

-- ---------- every other top-level key ----------
create or replace function public.state_patch(
  p_pcs int[], p_patch jsonb, p_writer text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare pc int; d jsonb; docs jsonb := '{}'::jsonb;
begin
  perform set_config('lock_timeout', '3000', true);
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be a json object' using errcode = '22023';
  end if;
  if jsonb_exists(p_patch, 'board') then
    raise exception 'board is owned by board_action(); a patch may not carry it'
      using errcode = '22023';
  end if;
  for pc in select distinct x from unnest(p_pcs) x where x between 1 and 5 order by 1
  loop
    select data into d from stream_state where id = pc for update;
    if not found then continue; end if;
    d := state_stamp(coalesce(d,'{}'::jsonb) || p_patch, p_writer);   -- shallow top-level merge
    update stream_state set data = d, updated_at = now() where id = pc;
    docs := docs || jsonb_build_object(pc::text, d);
  end loop;
  return docs;
end $$;

-- ---------- legacy whole-doc write ----------
create or replace function public.state_replace(
  p_pcs int[], p_doc jsonb, p_writer text default null, p_force boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare pc int; d jsonb; docs jsonb := '{}'::jsonb;
begin
  perform set_config('lock_timeout', '3000', true);
  for pc in select distinct x from unnest(p_pcs) x where x between 1 and 5 order by 1
  loop
    select data into d from stream_state where id = pc for update;
    if not found then continue; end if;
    -- A stale whole-document push can no longer revert the board: unless the caller
    -- explicitly forces it (QA snapshot restore), the live board is preserved.
    d := state_stamp(
           case when p_force then p_doc
                else (p_doc - 'board')
                     || jsonb_build_object('board',
                          coalesce(d->'board', p_doc->'board', '{}'::jsonb)) end,
           p_writer);
    update stream_state set data = d, updated_at = now() where id = pc;
    docs := docs || jsonb_build_object(pc::text, d);
  end loop;
  return docs;
end $$;

-- ---------- SECURITY ----------
-- Postgres grants EXECUTE to PUBLIC by default. Without these revokes the public
-- anon key could write state over PostgREST and undo the M6 read-only hardening.
revoke execute on function public.state_stamp(jsonb,text)                          from public, anon, authenticated;
revoke execute on function public.board_action(int[],text,text,jsonb,text,boolean) from public, anon, authenticated;
revoke execute on function public.state_patch(int[],jsonb,text)                    from public, anon, authenticated;
revoke execute on function public.state_replace(int[],jsonb,text,boolean)          from public, anon, authenticated;
grant  execute on function public.board_action(int[],text,text,jsonb,text,boolean) to service_role;
grant  execute on function public.state_patch(int[],jsonb,text)                    to service_role;
grant  execute on function public.state_replace(int[],jsonb,text,boolean)          to service_role;
