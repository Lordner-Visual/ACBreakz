-- V2 migration: per-PC state, board eliminate-only, styles, banner templates.

-- 1) stream_state becomes one row per PC (1..5)
alter table public.stream_state drop constraint if exists stream_state_id_check;
alter table public.stream_state add constraint stream_state_id_check check (id between 1 and 5);
insert into public.stream_state (id, data)
  select gs, (select data from public.stream_state where id = 1)
  from generate_series(2,5) gs
  on conflict (id) do nothing;

-- 2) allow 'style' assets
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check
  check (kind in ('background','banner','animation','sfx','logo','style'));

-- 3) the three art-only banners become composer templates (not rotation banners)
update public.assets set meta = meta || '{"template":true}'::jsonb
 where kind = 'banner' and name in ('NFL Mosaic','Gold Frame','Stadium Strip');

-- 4) tag animation groups
update public.assets set meta = meta || '{"group":"team"}'::jsonb
 where kind = 'animation' and meta ? 'team';
update public.assets set meta = meta || '{"group":"oneshot"}'::jsonb
 where kind = 'animation' and not (meta ? 'team');

-- 5) built-in styles
insert into public.assets (kind, name, url, meta)
  select 'style','Classic Stingers',null,'{"domain":"team_anim","per_team":true,"builtin":true}'::jsonb
  where not exists (select 1 from public.assets where kind='style' and name='Classic Stingers');
insert into public.assets (kind, name, url, meta)
  select 'style','Gold Buttons',null,'{"domain":"board","builtin":true}'::jsonb
  where not exists (select 1 from public.assets where kind='style' and name='Gold Buttons');

-- 6) reset every PC's state to the v2 shape (eliminate-only board, single art banner,
--    classic stingers, default board style)
update public.stream_state set data = jsonb_build_object(
  'background', (select jsonb_build_object('url', url, 'name', name)
                   from public.assets where kind='background' and name='TV Background (loop)' limit 1),
  'banners', jsonb_build_object('rotation',
     coalesce((select jsonb_agg(to_jsonb(a)) from
       (select * from public.assets where kind='banner' and name='Band – Navy Steel' limit 1) a),
       '[]'::jsonb)),
  'board', jsonb_build_object('picked','{}'::jsonb),
  'animStyle', (select to_jsonb(a) from
     (select * from public.assets where kind='style' and name='Classic Stingers' limit 1) a),
  'boardStyle', null);
