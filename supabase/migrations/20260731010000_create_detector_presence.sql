create table if not exists public.detector_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null default '',
  latitude double precision not null,
  longitude double precision not null,
  visible boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.detector_presence enable row level security;
drop policy if exists "detectors can see nearby presence" on public.detector_presence;
create policy "detectors can see nearby presence" on public.detector_presence for select to authenticated using (visible = true);
drop policy if exists "users manage own presence" on public.detector_presence;
create policy "users manage own presence" on public.detector_presence for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "users update own presence" on public.detector_presence;
create policy "users update own presence" on public.detector_presence for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users delete own presence" on public.detector_presence;
create policy "users delete own presence" on public.detector_presence for delete to authenticated using (auth.uid() = user_id);
create index if not exists detector_presence_location_idx on public.detector_presence (latitude, longitude);
