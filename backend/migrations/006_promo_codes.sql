-- DetectLab Premium — promo codes (free trials & future campaigns)
--
-- Users can enter a promo code instead of paying: a valid code grants
-- Premium for `duration_hours` with no payment involved.
--
-- First campaign (seeded at the bottom of this file):
--     TRIAL24 · 24 hours of Premium · one redemption per account ·
--     the code itself stays redeemable for one month.
--
-- Design notes
--   · `code` is stored UPPERCASE with no spaces; the backend normalises
--     whatever the user types before looking it up.
--   · `promo_redemptions` has UNIQUE (code, user_id): the "one redemption
--     per account" rule is enforced by the database, not by app logic
--     that could race with a double-clicked button.
--   · `kind = 'trial'` is stricter still — the backend refuses a trial
--     code if the account has ever redeemed ANY trial code, so publishing
--     TRIAL24B tomorrow does not hand a second free day to everybody.
--     Use `kind = 'bonus'` for campaigns that should be repeatable.
--   · Both tables have RLS enabled with NO policies: anon/authenticated
--     clients get zero rows. Only the backend (direct Postgres connection,
--     which bypasses RLS) can read the code list or write a redemption, so
--     the browser can never self-grant Premium.
--
-- Idempotent — safe to run multiple times.

/* ── Codes ──────────────────────────────────────────────────────────── */

create table if not exists public.promo_codes (
    code             text primary key,
    description      text,
    kind             text not null default 'trial'
                         check (kind in ('trial', 'bonus')),
    -- How much Premium the code grants, in hours (24 = one day).
    duration_hours   integer not null check (duration_hours > 0),
    -- Campaign window. expires_at NULL = the code never stops working.
    starts_at        timestamptz not null default now(),
    expires_at       timestamptz,
    -- Global cap across all accounts (NULL = unlimited).
    max_redemptions  integer check (max_redemptions is null or max_redemptions > 0),
    redeemed_count   integer not null default 0 check (redeemed_count >= 0),
    active           boolean not null default true,
    created_at       timestamptz not null default now()
);

comment on table public.promo_codes is
    'Redeemable promo codes. A valid code grants Premium for duration_hours with no payment.';
comment on column public.promo_codes.kind is
    '''trial'' = one free trial per account ever; ''bonus'' = once per account per code.';
comment on column public.promo_codes.duration_hours is
    'Hours of Premium granted on redemption (24 = the one-day free trial).';
comment on column public.promo_codes.expires_at is
    'Last moment the code can be redeemed (campaign end); NULL = no end.';
comment on column public.promo_codes.max_redemptions is
    'Global redemption cap across all accounts; NULL = unlimited.';

/* ── Redemptions (one row per account per code) ─────────────────────── */

-- user_id is deliberately NOT a foreign key: this file also runs from the
-- backend migration runner, which may connect with a role that has no
-- rights on the auth schema. Rows are only ever written by the API for an
-- authenticated user id.
create table if not exists public.promo_redemptions (
    id              bigserial primary key,
    code            text not null references public.promo_codes(code) on delete cascade,
    user_id         uuid not null,
    kind            text,
    duration_hours  integer,
    granted_until   timestamptz not null,
    redeemed_at     timestamptz not null default now(),
    constraint promo_redemptions_once_per_account unique (code, user_id)
);

create index if not exists promo_redemptions_user_idx
    on public.promo_redemptions (user_id);
create index if not exists promo_redemptions_user_kind_idx
    on public.promo_redemptions (user_id, kind);

comment on table public.promo_redemptions is
    'One row per (code, account). The UNIQUE constraint enforces "one redemption per account".';

/* ── Profiles ───────────────────────────────────────────────────────── */

-- stripe_subscription_status also carries 'promo_trial' now: Premium that
-- came from a promo code rather than a payment. Like 'one_time_paid' it is
-- NOT a legacy recurring subscription, so no billing portal is offered.
comment on column public.profiles.stripe_subscription_status is
    'Stripe status for legacy recurring subscribers, ''one_time_paid'' for the '
    'one-time EUR 5 purchase, or ''promo_trial'' for promo-code Premium.';

/* ── Lock down: backend-only tables ─────────────────────────────────── */

alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
-- No policies on purpose. See the design notes at the top of this file.

/* ── Seed: the 24-hour free trial ───────────────────────────────────── */

-- One day of Premium, one redemption per account, redeemable for one
-- month from the moment this migration first runs.
--
-- To extend / end the campaign later, from the Supabase SQL editor:
--   update public.promo_codes set expires_at = '2026-12-31T23:59:59Z' where code = 'TRIAL24';
--   update public.promo_codes set active = false                      where code = 'TRIAL24';
insert into public.promo_codes
    (code, description, kind, duration_hours, starts_at, expires_at, max_redemptions, active)
values
    ('TRIAL24',
     '24-hour free Premium trial - one per account, redeemable for one month',
     'trial', 24, now(), now() + interval '1 month', null, true)
on conflict (code) do nothing;
