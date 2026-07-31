-- Allow the SAME account to appear as multiple nearby detectorists
-- (e.g. one account signed in on two phones, or two browser tabs).
-- Without this, the second device's upsert overwrites the first (user_id is the
-- primary key), so neither phone can ever see the other.
--
-- Safe to re-run: every statement is guarded with IF EXISTS / IF NOT EXISTS.

alter table if exists public.detector_presence
    add column if not exists device_id text not null default 'web';

-- The default 'web' keeps any pre-existing single row valid; new clients always
-- send a unique per-browser device_id, so two devices of one user get two rows.

alter table if exists public.detector_presence
    drop constraint if exists detector_presence_pkey;

alter table if exists public.detector_presence
    add primary key (user_id, device_id);

-- Keep the geo index for efficient scans (recreate so it reflects the table shape).
drop index if exists detector_presence_location_idx;
create index if not exists detector_presence_location_idx
    on public.detector_presence (latitude, longitude);

-- No RLS policy change needed: the existing policies key off auth.uid() = user_id,
-- which still holds for the composite key.
