-- Drop rotation entries whose asset no longer exists (or is in the trash), on every PC.
update public.stream_state s
   set data = jsonb_set(
     s.data,
     '{banners,rotation}',
     coalesce((
       select jsonb_agg(b)
         from jsonb_array_elements(s.data->'banners'->'rotation') b
        where exists (
          select 1 from public.assets a
           where a.id::text = b->>'id'
             and coalesce((a.meta->>'deleted')::boolean, false) = false
             and coalesce((a.meta->>'hideRotation')::boolean, false) = false)
     ), '[]'::jsonb))
 where s.data ? 'banners'
   and jsonb_typeof(s.data->'banners'->'rotation') = 'array';

-- Report what each PC is left with.
select id,
       jsonb_array_length(data->'banners'->'rotation') as banners_selected
  from public.stream_state order by id;
