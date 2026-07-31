-- GPS paths saved by the map tracking control.
-- Run this migration in the same Supabase project used by js/supabase.js.

create table if not exists public.user_tracks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    path jsonb not null,
    started_at timestamptz,
    ended_at timestamptz,
    auto_stopped boolean not null default false,
    created_at timestamptz not null default now()
);

-- Keep this migration safe if a partial/manual table was already created.
alter table public.user_tracks
    add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete cascade,
    add column if not exists path jsonb,
    add column if not exists started_at timestamptz,
    add column if not exists ended_at timestamptz,
    add column if not exists auto_stopped boolean not null default false,
    add column if not exists created_at timestamptz not null default now();

-- Make sure manually-created tables also get the auth.uid() default needed
-- by inserts that do not send user_id from the browser.
alter table public.user_tracks
    alter column user_id set default auth.uid();

comment on table public.user_tracks is
    'GPS paths recorded by authenticated DetectLab users.';
comment on column public.user_tracks.user_id is
    'The Supabase Auth user who recorded this path.';
comment on column public.user_tracks.path is
    'Array of [lat, lng] points recorded by the tracking control.';

create index if not exists user_tracks_user_started_idx
    on public.user_tracks (user_id, started_at desc);

alter table public.user_tracks enable row level security;

revoke all on table public.user_tracks from anon;
grant select, insert, delete on table public.user_tracks to authenticated;

-- Each signed-in user can only read, create, or remove their own tracks.
drop policy if exists "Users can read their saved tracks" on public.user_tracks;
create policy "Users can read their saved tracks"
    on public.user_tracks
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can save their own tracks" on public.user_tracks;
create policy "Users can save their own tracks"
    on public.user_tracks
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their saved tracks" on public.user_tracks;
create policy "Users can delete their saved tracks"
    on public.user_tracks
    for delete
    to authenticated
    using ((select auth.uid()) = user_id);
