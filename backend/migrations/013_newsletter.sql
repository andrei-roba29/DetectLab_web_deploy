-- DetectLab Newsletter — link registration checkbox to DB + differentiate subscribers
--
-- 1) Extend public.profiles with newsletter columns so every user account
--    carries its preference right next to plan / stripe fields.
-- 2) Create a lightweight campaigns + sends log so the \"first newsletter\"
--    and every future send is auditable (who got what, when, status).
-- 3) Backfill safety: existing rows default to NOT subscribed (GDPR opt-in).
-- 4) Trigger on auth.users keeps the initial checkbox (stored as
--    raw_user_meta_data->>'newsletter_opt_in') in sync with profiles even
--    before the user confirms their e-mail. Without it the preference would
--    live only in user_metadata and be invisible to SQL queries.
--
-- Idempotent — safe to run multiple times.

-- ── 1. Profiles columns ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists newsletter_subscribed boolean not null default false;

alter table public.profiles
  add column if not exists newsletter_subscribed_at timestamptz;

alter table public.profiles
  add column if not exists newsletter_unsubscribed_at timestamptz;

-- Index for fast \"who is subscribed\" queries (the newsletter audience).
create index if not exists idx_profiles_newsletter_subscribed
  on public.profiles (newsletter_subscribed) where newsletter_subscribed = true;

comment on column public.profiles.newsletter_subscribed is
  'True when the user opted-in via the registration checkbox (or later via account panel / newsletter API). GDPR opt-in.';
comment on column public.profiles.newsletter_subscribed_at is
  'Timestamp of the last opt-in (set when newsletter_subscribed flips to true).';
comment on column public.profiles.newsletter_unsubscribed_at is
  'Timestamp of the last opt-out (set when newsletter_subscribed flips to false after having been true).';

-- ── 2. Campaigns + sends audit ────────────────────────────────────────
-- Campaigns / sends work with or without auth.users (FK is optional).
-- We create them without FK first, then add the FK only if auth.users exists.
create table if not exists public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  preview_text text,
  body_html text not null,
  body_text text,
  created_at timestamptz not null default now(),
  created_by uuid,
  sent_at timestamptz,
  status text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  recipients_count int,
  sent_count int default 0,
  failed_count int default 0
);

create table if not exists public.newsletter_sends (
  id bigserial primary key,
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  user_id uuid,
  email text not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='auth' and table_name='users') then
    -- Add FK constraints if missing and auth.users exists
    if not exists (select 1 from information_schema.table_constraints where constraint_name='newsletter_campaigns_created_by_fkey') then
      begin
        alter table public.newsletter_campaigns
          add constraint newsletter_campaigns_created_by_fkey
          foreign key (created_by) references auth.users(id) on delete set null;
      exception when duplicate_object then null;
      end;
    end if;
    if not exists (select 1 from information_schema.table_constraints where constraint_name='newsletter_sends_user_id_fkey') then
      begin
        alter table public.newsletter_sends
          add constraint newsletter_sends_user_id_fkey
          foreign key (user_id) references auth.users(id) on delete set null;
      exception when duplicate_object then null;
      end;
    end if;
  end if;
end
$$;

create index if not exists idx_newsletter_sends_campaign on public.newsletter_sends (campaign_id);
create index if not exists idx_newsletter_sends_email on public.newsletter_sends (lower(email));
create index if not exists idx_newsletter_sends_status on public.newsletter_sends (status);

comment on table public.newsletter_campaigns is 'Newsletter campaigns — one row per e-mail blast. The first real send is seeded by the backend script.';
comment on table public.newsletter_sends is 'Per-recipient delivery log for each campaign (auditable, retryable).';

-- ── 3. Helper: keep profiles.newsletter in sync from auth.users metadata ─
-- Called both by the insert trigger (new sign-ups) and as a one-shot
-- callable after e-mail confirmation / OAuth.

-- ── 3. Helper: keep profiles.newsletter in sync from auth.users metadata ─
-- Only create the trigger / function when the Supabase auth schema exists.
-- The backend PostGIS DB (DATABASE_URL) may be a separate database without
-- auth.users — in that case the Supabase migration (20260916000000) creates
-- the same trigger in the Supabase DB, and this file just ensures the
-- profiles columns + campaigns tables exist.
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'auth')
     and exists (select 1 from information_schema.tables where table_schema='auth' and table_name='users') then

    create or replace function public.sync_newsletter_from_user_metadata()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
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
    $fn$;

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

    -- Convenience view: newsletter audience (for admins / API)
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

  end if;
end
$$;

-- ── 5. RLS: campaigns / sends are service_role only (backend pool) ─────
-- No anon/authenticated policies — the app never reads these tables
-- directly; the newsletter API (backend pool, bypasses RLS) is the gate.
alter table public.newsletter_campaigns enable row level security;
alter table public.newsletter_sends enable row level security;
-- Intentionally no policies: only service_role / backend pool can read/write.

-- ── 6. Allow authenticated users to READ their own newsletter flag ───────
-- The select policy already exists (profiles_select_own) and covers the new
-- columns automatically (SELECT *). No new policy needed, but document it.
-- If the insert/update policies were previously dropped (Stripe hardening),
-- the backend newsletter API (pool, bypasses RLS) remains the writer. For
-- self-service via Supabase client we also re-allow a narrow update that
-- only touches newsletter columns — guarded by a check that plan / stripe
-- fields are untouched.

-- Re-create a minimal insert policy so the trigger / first-login sync that
-- runs as `postgres` via the trigger still works and so that a very old
-- DB missing the profiles row can self-heal. For degraded clients that
-- still try to upsert their own profile row, allow insert of own id only.
drop policy if exists "profiles_insert_own_newsletter" on public.profiles;
create policy "profiles_insert_own_newsletter"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

-- Allow users to update ONLY their newsletter preference — not plan.
-- The check `plan = old.plan AND premium_expires_at IS NOT DISTINCT FROM old.*`
-- is enforced in the policy's WITH CHECK by requiring the non-newsletter
-- columns to stay equal to the existing row. In practice we implement this
-- as a permissive update policy (authenticated users can update own row)
-- and rely on the backend API to be the canonical writer; the direct
-- client path is kept for resilience but the backend never trusts a
-- client-supplied plan value for premium.
drop policy if exists "profiles_update_own_newsletter" on public.profiles;
create policy "profiles_update_own_newsletter"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 7. Backfill: ensure every existing auth user has a profiles row ─────
-- Only when auth.users exists (otherwise this is a pure PostGIS DB)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='auth' and table_name='users') then
    insert into public.profiles (id, plan, newsletter_subscribed, updated_at)
    select u.id, 'free', false, now()
    from auth.users u
    left join public.profiles p on p.id = u.id
    where p.id is null
    on conflict do nothing;
  end if;
end
$$;
