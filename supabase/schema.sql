-- ============================================================
-- ACBreakz Stream System — Supabase schema
-- Run with: supabase db push   (or paste into the SQL editor)
-- ============================================================

-- Single-row document holding the live overlay state for ALL PCs
create table if not exists public.stream_state (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{
    "background": null,
    "banners": {"rotation": []},
    "board": {"mode": "fill", "visible": true, "picked": {}}
  }'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.stream_state (id) values (1) on conflict (id) do nothing;

-- Template library: backgrounds, banners, animations, sfx, logos
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('background','banner','animation','sfx','logo')),
  name text not null,
  url text,                       -- null for pure text banners
  meta jsonb not null default '{}'::jsonb,  -- {type:'upload'|'ai'|'text', text, prompt, team, durationSec, default}
  created_at timestamptz not null default now()
);

-- One-shot triggers (team picks, animation plays) — insert-only event log
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Realtime: overlays subscribe to state UPDATEs and event INSERTs
alter publication supabase_realtime add table public.stream_state;
alter publication supabase_realtime add table public.events;

-- ---------- MVP access policy ----------
-- Ship-tonight posture: anon key can read everything and write state/assets/events.
-- The anon key + project URL act as the shared secret; keep the control panel URL private.
-- HARDENING (agent task M6): move writes behind edge functions + Supabase Auth,
-- then drop the anon insert/update policies below.
alter table public.stream_state enable row level security;
alter table public.assets       enable row level security;
alter table public.events       enable row level security;

create policy "read state"    on public.stream_state for select using (true);
create policy "write state"   on public.stream_state for update using (true) with check (id = 1);
create policy "read assets"   on public.assets for select using (true);
create policy "insert assets" on public.assets for insert with check (true);
create policy "read events"   on public.events for select using (true);
create policy "insert events" on public.events for insert with check (true);

-- Auto-prune events older than 1 day (keeps realtime snappy)
create or replace function public.prune_events() returns trigger as $$
begin
  delete from public.events where created_at < now() - interval '1 day';
  return null;
end; $$ language plpgsql security definer;
drop trigger if exists trg_prune_events on public.events;
create trigger trg_prune_events after insert on public.events
  for each statement execute function public.prune_events();

-- ---------- Storage ----------
insert into storage.buckets (id, name, public) values ('media','media', true)
  on conflict (id) do nothing;
create policy "public read media"  on storage.objects for select using (bucket_id = 'media');
create policy "anon upload media"  on storage.objects for insert with check (bucket_id = 'media');
