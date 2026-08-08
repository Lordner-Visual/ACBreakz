-- M6 hardening: anon becomes read-only; writes live in keyed edge functions.
drop policy if exists "write state"      on public.stream_state;
drop policy if exists "insert assets"    on public.assets;
drop policy if exists "insert events"    on public.events;
drop policy if exists "anon upload media" on storage.objects;
