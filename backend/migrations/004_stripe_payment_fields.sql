-- DetectLab Premium — real payments (Stripe)
--
-- 1) Add Stripe columns to public.profiles so the webhook can track the
--    customer / subscription that a user is paying with.
-- 2) Drop the client-side INSERT/UPDATE policies: with real payments, the
--    Stripe webhook (server-side, direct DB connection, bypasses RLS) is
--    the ONLY writer of plan / premium_expires_at. Keeping the old UPDATE
--    policy would let anyone flip their own row to 'premium' for free.
--
-- Idempotent — safe to run multiple times.

alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists stripe_subscription_status text;

drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;

-- Select policy stays: the app still reads the user's own subscription
-- status to render the PREMIUM badge / expiration date.
