-- DetectLab Premium — one-time €5 purchase (no automatic renewal)
--
-- The €5/month Stripe subscription was replaced by a single €5 payment
-- that grants Premium for one calendar month. Two things are needed:
--
-- 1) Stripe event de-duplication. Stripe retries webhooks (and they can be
--    resent manually), so the SAME event must never extend Premium twice.
--    The webhook inserts the event id here first; a conflict means "already
--    processed, skip".
-- 2) `stripe_subscription_status` now also carries the value
--    'one_time_paid', which distinguishes a one-time purchase from a legacy
--    recurring subscription (only legacy subscribers get the billing
--    portal / "Manage subscription" button).
--
-- Idempotent — safe to run multiple times.

create table if not exists public.stripe_processed_events (
    event_id text primary key,
    event_type text,
    processed_at timestamptz not null default now()
);

create index if not exists stripe_processed_events_processed_at_idx
    on public.stripe_processed_events (processed_at);

comment on table public.stripe_processed_events is
    'Stripe webhook idempotency guard: one row per handled event id.';

comment on column public.profiles.stripe_subscription_status is
    'Stripe subscription status for legacy recurring subscribers, or '
    '''one_time_paid'' for the current one-time €5 monthly purchase.';
