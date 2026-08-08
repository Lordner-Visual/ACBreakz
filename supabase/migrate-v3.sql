-- V3: split board styles into mix-and-match parts, builtin button animations,
--     sfx linking, per-tab generators.

-- 1) split any combined 'board' style rows into button + background rows
insert into public.assets (kind, name, url, meta)
  select 'style', name || ' — buttons', meta->>'button_url',
         jsonb_build_object('domain','board_button','prompt',meta->>'prompt')
    from public.assets where kind='style' and meta->>'domain'='board'
      and meta ? 'button_url';
insert into public.assets (kind, name, url, meta)
  select 'style', name || ' — background', meta->>'bg_url',
         jsonb_build_object('domain','board_bg','prompt',meta->>'prompt')
    from public.assets where kind='style' and meta->>'domain'='board'
      and meta ? 'bg_url';
delete from public.assets where kind='style' and meta->>'domain'='board';

-- 2) builtin parts (defaults render via CSS, no urls)
insert into public.assets (kind, name, url, meta)
  select 'style','Gold Buttons',null,'{"domain":"board_button","builtin":true}'::jsonb
  where not exists (select 1 from public.assets where kind='style' and name='Gold Buttons'
                      and meta->>'domain'='board_button');
delete from public.assets where kind='style' and name='Gold Buttons' and meta->>'domain' is null;
insert into public.assets (kind, name, url, meta)
  select 'style','Navy Glass Board',null,'{"domain":"board_bg","builtin":true}'::jsonb
  where not exists (select 1 from public.assets where kind='style' and meta->>'domain'='board_bg' and name='Navy Glass Board');
insert into public.assets (kind, name, url, meta)
  select 'style', v.name, null, jsonb_build_object('domain','button_anim','builtin',true,'effect',v.effect,'mode',v.mode)
  from (values ('No Button Animation','none','none'),
               ('Edge Glow (synced)','glow','ambient'),
               ('Glitch Pulse','glitch','ambient'),
               ('Pop & Slam','pop','trigger')) as v(name,effect,mode)
  where not exists (select 1 from public.assets where kind='style' and meta->>'domain'='button_anim' and name=v.name);

-- 3) Classic Stingers style carries the linked pick sound explicitly
update public.assets
   set meta = meta || jsonb_build_object(
     'sfxUrl',(select url from public.assets where kind='sfx' and name='Team Pick Sound' limit 1),
     'sfxName','Team Pick Sound')
 where kind='style' and name='Classic Stingers';

-- 4) state: replace boardStyle with the three-part selection on every PC
update public.stream_state
   set data = (data - 'boardStyle')
              || '{"boardButtons":null,"boardBg":null,"buttonAnim":null}'::jsonb;
