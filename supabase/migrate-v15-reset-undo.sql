/* V15 — undoable board reset and highlight clear.

   A reset is one press that wipes up to 32 teams, and it was the single largest source of
   deck/board drift before the plugin (measured: 900 cycles stranding ~6.1 keys each). Making
   it reversible is what turns an accidental press from a show-stopping mistake into a
   non-event.

   The snapshot lives in stream_state.data.undo, NEVER in the deck. A plugin-side undo would
   be wrong the moment anyone reset from a panel, and would evaporate on a plugin restart —
   the same class of local-state drift the icons already had. Server-side, every deck and
   panel agrees, and the toggle survives a reload.

   One level deep, deliberately: reset -> eliminate three teams -> reset snapshots THOSE three
   and the original set is gone. Anything deeper needs a real history and nobody asked for one.

   Note data.undo is ephemeral by design: state_replace() preserves only 'board' on a legacy
   whole-doc push, so a panel Apply can drop it. That is acceptable for a convenience key and
   is not worth widening the atomic core to protect.                                        */

create or replace function public.board_action(
  p_pcs integer[], p_action text, p_team text default null,
  p_fx jsonb default '{}'::jsonb, p_writer text default null,
  p_return_data boolean default false)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  pc int; d jsonb; b jsonb; style jsonb; payload jsonb; fx jsonb; undo jsonb;
  was_out boolean; was_hl boolean; now_out boolean; now_hl boolean; changed boolean;
  is_hl_action boolean; cleared boolean;
  results jsonb := '[]'::jsonb;
begin
  perform set_config('lock_timeout', '3000', true);   -- never hang a key press

  if p_action not in ('team_toggle','team_pick','team_restore','board_reset',
                      'highlight','unhighlight','highlight_toggle','highlight_clear',
                      'board_reset_toggle','highlight_clear_toggle') then
    raise exception 'unknown board action %', p_action using errcode = '22023';
  end if;
  if p_action in ('team_toggle','team_pick','team_restore',
                  'highlight','unhighlight','highlight_toggle')
     and coalesce(p_team,'') = '' then
    raise exception 'team required for %', p_action using errcode = '22023';
  end if;
  is_hl_action := p_action in ('highlight','unhighlight','highlight_toggle',
                               'highlight_clear','highlight_clear_toggle');

  for pc in select distinct x from unnest(p_pcs) x where x between 1 and 5 order by 1
  loop
    select data into d from stream_state where id = pc for update;   -- <<< the critical section
    if not found then continue; end if;
    d := coalesce(d, '{}'::jsonb);
    /* per-PC FX when the caller supplies it, flat object otherwise (back-compatible) */
    fx := coalesce(p_fx -> pc::text, p_fx, '{}'::jsonb);

    b := coalesce(d->'board', '{}'::jsonb);
    b := b || jsonb_build_object('picked',      coalesce(b->'picked','{}'::jsonb),
                                 'highlighted', coalesce(b->'highlighted','{}'::jsonb));

    was_out := coalesce((b->'picked'      ->> p_team)::boolean, false);
    was_hl  := coalesce((b->'highlighted' ->> p_team)::boolean, false);
    now_out := was_out; now_hl := was_hl; changed := false; cleared := false;

    if p_action = 'board_reset' then
      changed := (b->'picked') <> '{}'::jsonb;
      b := jsonb_set(b, '{picked}', '{}'::jsonb);
      now_out := false;

    elsif p_action = 'highlight_clear' then
      changed := (b->'highlighted') <> '{}'::jsonb;
      b := jsonb_set(b, '{highlighted}', '{}'::jsonb);
      now_hl := false;

    /* ---- the two undoable keys ---- */
    elsif p_action in ('board_reset_toggle','highlight_clear_toggle') then
      declare
        slot text := case when p_action = 'board_reset_toggle' then 'picked' else 'highlighted' end;
        live jsonb;
      begin
        undo := coalesce(d->'undo', '{}'::jsonb);
        live := coalesce(b->slot, '{}'::jsonb);
        if live <> '{}'::jsonb then
          /* clearing — stash exactly what was on the board so the same key restores it */
          undo    := jsonb_set(undo, array[slot], live, true);
          b       := jsonb_set(b, array[slot], '{}'::jsonb);
          changed := true; cleared := true;
        elsif coalesce(undo->slot, '{}'::jsonb) <> '{}'::jsonb then
          /* undoing — put it back and spend the snapshot, so a third press clears again */
          b       := jsonb_set(b, array[slot], undo->slot);
          undo    := undo - slot;
          changed := true;
        end if;
        /* nothing live and nothing stashed = a no-op press, and changed stays false so no
           event fires and deck_log records it truthfully */
        d := jsonb_set(d, '{undo}', undo, true);
        if p_action = 'board_reset_toggle' then now_out := false; else now_hl := false; end if;
      end;

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
          'styleCrop',   style->'meta'->'crop',      -- reframe pan/zoom, v13
          'logoOverlay', true);
      else
        payload := jsonb_build_object('team', p_team, 'pc', pc,
                                      'animUrl', fx->'teamAnimUrl');
      end if;
      -- a linked sound wins; an explicit JSON null means "No SoundFX"
      payload := payload || jsonb_build_object('sfxUrl',
        case when jsonb_typeof(style->'meta') = 'object'
                  and jsonb_exists(style->'meta', 'sfxUrl')
             then style->'meta'->'sfxUrl'
             else coalesce(fx->'defaultSfxUrl', 'null'::jsonb) end);
      insert into events(type, payload) values ('team_pick', payload);

    elsif p_action in ('team_toggle','team_restore') and not now_out and changed then
      insert into events(type, payload)
        values ('team_restore', jsonb_build_object('team', p_team, 'pc', pc));

    elsif p_action = 'board_reset' then
      insert into events(type, payload) values ('board_reset', jsonb_build_object('pc', pc));

    /* Only the CLEARING half emits board_reset — that handler clears every dim timer.
       The undo half deliberately emits nothing: applyState sees not-out -> out for each
       restored team, parks it and arms its own 900ms dim. Emitting team_pick here instead
       would fire a stinger per team, i.e. up to 32 at once for one press. */
    elsif p_action = 'board_reset_toggle' and cleared then
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
      -- so a reset key can paint RESET vs UNDO from the press response, without
      -- waiting for realtime and without keeping any state of its own
      'undo', coalesce(d->'undo', '{}'::jsonb),
      'updatedAt', d->'updatedAt',
      'data', case when p_return_data then d else null end));
  end loop;

  return jsonb_build_object('ok', true, 'results', results);
end $function$;

/* unchanged posture: service_role only, anon must stay denied */
revoke all on function public.board_action(integer[], text, text, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.board_action(integer[], text, text, jsonb, text, boolean) to service_role;
