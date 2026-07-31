-- Coordinates saved from the map's pin-location popup.
-- Run this migration in the same Supabase project used by js/supabase.js.

create table if not exists public.saved_coordinates (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    title text,
    description text,
    created_at timestamptz not null default now()
);

comment on table public.saved_coordinates is
    'Map coordinates saved by authenticated DetectLab users.';
comment on column public.saved_coordinates.user_id is
    'The Supabase Auth user who saved this coordinate.';

create index if not exists saved_coordinates_user_created_idx
    on public.saved_coordinates (user_id, created_at desc);

alter table public.saved_coordinates enable row level security;

-- Explicit grants are needed by newer Supabase projects where new public
-- tables are not automatically exposed through the Data API.
revoke all on table public.saved_coordinates from anon;
grant select, insert, delete on table public.saved_coordinates to authenticated;

-- Each signed-in user can only read, create, or remove their own saved points.
drop policy if exists "Users can read their saved coordinates" on public.saved_coordinates;
create policy "Users can read their saved coordinates"
    on public.saved_coordinates
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can save their own coordinates" on public.saved_coordinates;
create policy "Users can save their own coordinates"
    on public.saved_coordinates
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their saved coordinates" on public.saved_coordinates;
create policy "Users can delete their saved coordinates"
    on public.saved_coordinates
    for delete
    to authenticated
    using ((select auth.uid()) = user_id);
