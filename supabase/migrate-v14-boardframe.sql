-- v14: assets_deselect must clear boardFrame too (see scripts/migrate-v14-boardframe.mjs)
CREATE OR REPLACE FUNCTION public.assets_deselect(p_id text, p_url text DEFAULT NULL::text, p_writer text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    foreach k in array array['animStyle', 'boardButtons', 'boardBg', 'boardFrame', 'buttonAnim'] loop
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
end $function$
;
