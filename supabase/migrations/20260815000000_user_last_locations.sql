-- ══════════════════════════════════════════════════════════════════════════
-- Last known (broad) location per user
-- ══════════════════════════════════════════════════════════════════════════
--
-- `detector_presence` only holds LIVE positions and is wiped/hidden as soon as
-- a user turns off Detect or live location, so we lose every trace of where a
-- detectorist was. This table remembers, per user, the *broad* place they were
-- last seen at (nearest city / town + county), plus the last coordinates.
--
-- It powers two features:
--   1. "See other detectorists" also lists OFFLINE users from the same county
--      (rendered as black/white bubbles).
--   2. When an event is created in a county, every user whose last location is
--      in that county (or within 50 km of the event) gets a notification.
--
-- Idempotent: safe to re-run.

create table if not exists public.user_last_locations (
    user_id     uuid primary key references auth.users(id) on delete cascade,
    full_name   text not null default '',
    email       text not null default '',
    latitude    double precision,
    longitude   double precision,
    city        text,
    county      text,
    country     text,
    label       text,
    updated_at  timestamptz not null default now()
);

-- Older deployments may already have the table without the newer columns.
alter table public.user_last_locations
    add column if not exists full_name  text not null default '',
    add column if not exists email      text not null default '',
    add column if not exists latitude   double precision,
    add column if not exists longitude  double precision,
    add column if not exists city       text,
    add column if not exists county     text,
    add column if not exists country    text,
    add column if not exists label      text,
    add column if not exists updated_at timestamptz not null default now();

create index if not exists user_last_locations_county_idx
    on public.user_last_locations (county);
create index if not exists user_last_locations_city_idx
    on public.user_last_locations (city);
create index if not exists user_last_locations_coords_idx
    on public.user_last_locations (latitude, longitude);

alter table public.user_last_locations enable row level security;

grant select, insert, update, delete on public.user_last_locations to authenticated;
grant select on public.user_last_locations to anon;

-- Every signed-in detectorist may read the broad last locations (that is the
-- whole point of the offline bubbles + county notifications), but may only
-- write their own row.
drop policy if exists "Anyone signed in can read last locations" on public.user_last_locations;
create policy "Anyone signed in can read last locations"
    on public.user_last_locations for select to authenticated, anon using (true);

drop policy if exists "Users insert own last location" on public.user_last_locations;
create policy "Users insert own last location"
    on public.user_last_locations for insert to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "Users update own last location" on public.user_last_locations;
create policy "Users update own last location"
    on public.user_last_locations for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete own last location" on public.user_last_locations;
create policy "Users delete own last location"
    on public.user_last_locations for delete to authenticated
    using (auth.uid() = user_id);

-- ── Notification kind ──────────────────────────────────────────────────────
-- Lets the client tell "an event was created near you" notifications apart
-- from join requests / accept / decline, so it can render the "See event"
-- button that zooms the map onto the event.
alter table public.event_notifications
    add column if not exists kind text;

create index if not exists event_notifications_kind_idx
    on public.event_notifications (kind);
