-- Deliver event chat messages to connected participants as soon as they are
-- inserted. Supabase Postgres Changes only streams tables that belong to the
-- `supabase_realtime` publication; creating a table does not reliably add it
-- to that publication on existing projects.

do $$
begin
    if exists (
        select 1
        from pg_publication
        where pubname = 'supabase_realtime'
    ) and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'event_chat_messages'
    ) then
        alter publication supabase_realtime add table public.event_chat_messages;
    end if;
end
$$;
