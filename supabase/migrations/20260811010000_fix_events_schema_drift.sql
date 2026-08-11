-- Fix schema drift: the live `events` table is missing the columns that the
-- frontend (js/events.js) sends on every event upsert:
--   pin_id, category, creator_email
--
-- Symptom: every event upsert fails with PostgREST error 42703
-- ("column ... does not exist"), so the events table stays empty. Join
-- requests then fail on the event_inquiries.event_id foreign key, and the
-- creator never receives them (the old client code swallowed the errors).
--
-- Idempotent: safe to run via `supabase db push` or the SQL editor.

alter table public.events
    add column if not exists creator_email text,
    add column if not exists category text,
    add column if not exists pin_id text;

-- Re-assert permissive RLS + grants for the events feature tables (idempotent),
-- in case the policies were never applied to this project.
alter table public.events enable row level security;
grant select, insert, update, delete on public.events to authenticated, anon;

drop policy if exists "Events access" on public.events;
create policy "Events access" on public.events
    for all to authenticated, anon using (true) with check (true);

drop policy if exists "Inquiries access" on public.event_inquiries;
create policy "Inquiries access" on public.event_inquiries
    for all to authenticated, anon using (true) with check (true);

drop policy if exists "Attendees access" on public.event_attendees;
create policy "Attendees access" on public.event_attendees
    for all to authenticated, anon using (true) with check (true);

drop policy if exists "Notifications access" on public.event_notifications;
create policy "Notifications access" on public.event_notifications
    for all to authenticated, anon using (true) with check (true);
