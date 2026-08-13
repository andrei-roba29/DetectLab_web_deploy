-- DetectLab event chat: guarantee read access to previous messages
-- =================================================================
-- Symptom: when a user opens an event chat they cannot see the earlier
-- messages of other participants. As soon as they post their own first
-- message, the whole history appears.
--
-- Root cause: the chat tables are RLS-enabled, and in some deployments a
-- more restrictive SELECT policy was put on `event_chat_messages` (e.g.
-- "only my own rows" or "only chats I have already written in"). The app
-- itself is built around cross-account sync and gates chat access in the
-- frontend (only the creator and accepted attendees can open the chat), so
-- reads must not be filtered server-side by "have I posted yet". The chat
-- insert guard trigger (`guard_event_chat_message_insert`, security
-- definer) creates the `event_chats` row on the first message, which is
-- exactly why the history suddenly appears after the user sends a message.
--
-- Fix: drop every existing policy on the two chat tables and recreate the
-- permissive policies from the original events feature migration, then
-- re-assert the grants. Safe to apply on deployments that are already
-- permissive (it recreates the same policy).
-- =================================================================

do $$
declare
    p record;
begin
    for p in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'public'
          and tablename in ('event_chat_messages', 'event_chats')
    loop
        execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    end loop;
end
$$;

alter table public.event_chat_messages enable row level security;
alter table public.event_chats enable row level security;

grant select, insert, update, delete on public.event_chat_messages to authenticated, anon;
grant select, insert, update, delete on public.event_chats to authenticated, anon;

-- Participants (and, for consistency with the rest of the events feature,
-- anon) can always read the full chat history of an event.
drop policy if exists "Chat access" on public.event_chat_messages;
create policy "Chat access"
    on public.event_chat_messages
    for all
    to authenticated, anon
    using (true)
    with check (true);

drop policy if exists "Event chats access" on public.event_chats;
create policy "Event chats access"
    on public.event_chats
    for all
    to authenticated, anon
    using (true)
    with check (true);
