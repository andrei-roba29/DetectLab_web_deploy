-- Keep event lists in sync across currently open DetectLab clients.
--
-- js/events.js also polls as a fallback, but adding `events` to the Supabase
-- Realtime publication makes a confirmed creator deletion disappear immediately
-- from every connected map. This is idempotent: attempting to add a table that
-- is already in the publication raises duplicate_object, which is ignored.

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.events;
    end if;
exception
    when duplicate_object then null;
end
$$;
