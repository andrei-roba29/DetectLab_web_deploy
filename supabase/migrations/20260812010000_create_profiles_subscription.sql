-- DetectLab Premium subscriptions
--
-- One row per auth user, holding the subscription status that the
-- checkout flow writes after a successful payment.
--
-- NOTE (production): the demo checkout writes this row directly from the
-- browser (RLS below only lets a user touch their own row). When a real
-- payment provider (Stripe etc.) is wired in, the server-side webhook must
-- be the ONLY writer of plan/premium_expires_at; the UPDATE policy below
-- can then be dropped and replaced by an upsert done with the service_role
-- key from the webhook edge function.

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    plan text not null default 'free' check (plan in ('free', 'premium')),
    premium_expires_at timestamptz,
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own subscription status (needed by the app to
-- render the PREMIUM badge / expiration date in Manage Account).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
    on public.profiles for select
    using (auth.uid() = id);

-- Users can insert their own row (first purchase).
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
    on public.profiles for insert
    with check (auth.uid() = id);

-- Users can update their own row (demo checkout / renewal).
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);
