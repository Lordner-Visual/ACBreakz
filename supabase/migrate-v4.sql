-- V4: grid style + spacing + highlight set on every PC's state.
update public.stream_state
   set data = data
     || jsonb_build_object('boardGrid', coalesce(data->>'boardGrid','buttons'))
     || jsonb_build_object('boardGap', coalesce((data->>'boardGap')::int, 0))
     || jsonb_build_object('board',
          coalesce(data->'board','{}'::jsonb)
          || jsonb_build_object('highlighted', coalesce(data->'board'->'highlighted','{}'::jsonb)));
