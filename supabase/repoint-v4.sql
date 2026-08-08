-- V4: point the boxed one-shots at the content-cropped encodes
update public.assets set url = 'https://jqowngdkgnfhaworyppo.supabase.co/storage/v1/object/public/media/animations/v4/spin-2-pick-1-1786191608420.webm'  where kind='animation' and name ilike '%Spin 2 Pick 1%';
update public.assets set url = 'https://jqowngdkgnfhaworyppo.supabase.co/storage/v1/object/public/media/animations/v4/stash-or-pass-1786191608420.webm' where kind='animation' and name ilike '%Stash or Pass%';
