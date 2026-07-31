-- ============================================================================
--  DetectLab — "Nearby detectorists" presence schema (ONE-SHOT, idempotent)
--  Paste this entire file into:  Supabase Dashboard → SQL Editor → Run
--  Safe to run multiple times. Applies to the HOSTED project the app uses.
-- ============================================================================

-- 1) Table (PK on user_id for now; step 3 upgrades it to a composite key)
create table if not exists public.detector_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  latitude double precision not null,
  longitude double precision not null,
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 2) Allow multiple devices / sessions per account (same account on 2 phones)
alter table if exists public.detector_presence
  add column if not exists device_id text not null default 'web';

alter table if exists public.detector_presence drop constraint if exists detector_presence_pkey;
alter table if exists public.detector_presence add primary key (user_id, device_id);

-- 3) Row Level Security — without these, authenticated reads return 0 rows,
--    which is exactly the "can't find each other" symptom.
alter table public.detector_presence enable row level security;

drop policy if exists "detectors can see nearby presence" on public.detector_presence;
create policy "detectors can see nearby presence" on public.detector_presence
  for select to authenticated using (visible = true);

drop policy if exists "users manage own presence" on public.detector_presence;
create policy "users manage own presence" on public.detector_presence
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "users update own presence" on public.detector_presence;
create policy "users update own presence" on public.detector_presence
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete own presence" on public.detector_presence;
create policy "users delete own presence" on public.detector_presence
  for delete to authenticated using (auth.uid() = user_id);

-- 4) Geo index for efficient scans
drop index if exists detector_presence_location_idx;
create index if not exists detector_presence_location_idx
  on public.detector_presence (latitude, longitude);
