-- DetectLab Newsletter — link registration checkbox to DB + differentiate subscribers
--
-- Mirrors backend/migrations/013_newsletter.sql for Supabase local / cloud.
-- Idempotent.

alter table public.profiles
  add column if not exists newsletter_subscribed boolean not null default false;

alter table public.profiles
  add column if not exists newsletter_subscribed_at timestamptz;

alter table public.profiles
  add column if not exists newsletter_unsubscribed_at timestamptz;

create index if not exists idx_profiles_newsletter_subscribed
  on public.profiles (newsletter_subscribed) where newsletter_subscribed = true;

comment on column public.profiles.newsletter_subscribed is
  'True when the user opted-in via the registration checkbox (or later via account panel / newsletter API). GDPR opt-in.';
comment on column public.profiles.newsletter_subscribed_at is
  'Timestamp of the last opt-in (set when newsletter_subscribed flips to true).';
comment on column public.profiles.newsletter_unsubscribed_at is
  'Timestamp of the last opt-out (set when newsletter_subscribed flips to false after having been true).';

create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  preview_text text,
  body_html text not null,
  body_text text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  recipients_count int,
  sent_count int default 0,
  failed_count int default 0
);

create table if not exists public.newsletter_sends (
  id bigserial primary key,
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_newsletter_sends_campaign on public.newsletter_sends (campaign_id);
create index if not exists idx_newsletter_sends_email on public.newsletter_sends (lower(email));
create index if not exists idx_newsletter_sends_status on public.newsletter_sends (status);

comment on table public.newsletter_campaigns is 'Newsletter campaigns — one row per e-mail blast. The first real send is seeded by the backend script.';
comment on table public.newsletter_sends is 'Per-recipient delivery log for each campaign (auditable, retryable).';

create or replace function public.sync_newsletter_from_user_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opt_in boolean;
begin
  v_opt_in := coalesce((new.raw_user_meta_data->>'newsletter_opt_in')::boolean, false);
  insert into public.profiles (id, plan, newsletter_subscribed, newsletter_subscribed_at, updated_at)
  values (
    new.id,
    'free',
    v_opt_in,
    case when v_opt_in then now() else null end,
    now()
  )
  on conflict (id) do update set
    newsletter_subscribed = case
      when v_opt_in = true then true
      else public.profiles.newsletter_subscribed
    end,
    newsletter_subscribed_at = case
      when v_opt_in = true and coalesce(public.profiles.newsletter_subscribed, false) = false
        then now()
      else public.profiles.newsletter_subscribed_at
    end,
    updated_at = now()
  where public.profiles.id = excluded.id;
  return new;
end;
$$;

drop trigger if exists trigger_sync_newsletter_on_user_insert on auth.users;
create trigger trigger_sync_newsletter_on_user_insert
  after insert on auth.users
  for each row execute function public.sync_newsletter_from_user_metadata();

drop trigger if exists trigger_sync_newsletter_on_user_update on auth.users;
create trigger trigger_sync_newsletter_on_user_update
  after update of raw_user_meta_data on auth.users
  for each row
  when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
  execute function public.sync_newsletter_from_user_metadata();

create or replace view public.newsletter_audience as
  select
    p.id as user_id,
    u.email,
    coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)) as full_name,
    p.newsletter_subscribed,
    p.newsletter_subscribed_at,
    p.newsletter_unsubscribed_at,
    p.plan,
    p.premium_expires_at,
    u.created_at as user_created_at,
    u.email_confirmed_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.newsletter_subscribed = true;

comment on view public.newsletter_audience is 'All users currently subscribed to the newsletter (public.profiles.newsletter_subscribed = true). Use for sending.';

alter table public.newsletter_campaigns enable row level security;
alter table public.newsletter_sends enable row level security;

drop policy if exists "profiles_insert_own_newsletter" on public.profiles;
create policy "profiles_insert_own_newsletter"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own_newsletter" on public.profiles;
create policy "profiles_update_own_newsletter"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

insert into public.profiles (id, plan, newsletter_subscribed, updated_at)
select u.id, 'free', false, now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict do nothing;
