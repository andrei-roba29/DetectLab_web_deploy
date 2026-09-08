-- DetectLab Premium — 48-hour campaign code
--
-- A single promo code grants FORTY-EIGHT (48) hours of Premium to the
-- account that redeems it. Campaign semantics:
--   · kind = 'bonus'      → once per account per code (UNIQUE (code, user_id)),
--     NOT refused while Premium is already active, and it STACKS on top of
--     the current expiry (a user with Premium until next week gets 48 more
--     hours added; the greatest() guard in services/promoCodes.js means a
--     grant can never shorten existing Premium).
--   · starts_at           → campaign opens 9 September 2026, 00:00
--     (Bucharest time, UTC+3).
--   · expires_at          → last moment the code can be redeemed: the whole
--     day of 13 September 2026 (Bucharest time). A redemption made on that
--     last day still grants the full 48 hours from that moment.
--   · max_redemptions     → NULL = unlimited accounts within the window.
--     Set a number here if the campaign is meant for a closed group.
--
-- The code is intentionally NOT published anywhere in the app UI: it is
-- shared privately and entered through the existing generic promo box
-- (membership popup / checkout page). The DB description stays generic so
-- no campaign detail leaks through database dumps either.
--
-- Idempotent — safe to run multiple times. `on conflict do nothing` keeps
-- any manual edits already made from the Supabase SQL editor.
--
-- Housekeeping from the Supabase SQL editor:
--   -- end the campaign early (existing grants are untouched)
--   update public.promo_codes set active = false where code = 'TABARA48';
--   -- give it a redemption cap
--   update public.promo_codes set max_redemptions = 500 where code = 'TABARA48';
--   -- see how the campaign is doing
--   select code, redeemed_count, max_redemptions, starts_at, expires_at
--     from public.promo_codes where code = 'TABARA48';

insert into public.promo_codes
    (code, description, kind, duration_hours, starts_at, expires_at, max_redemptions, active)
values
    ('TABARA48',
     '48-hour Premium bonus campaign, redeemable 9-13 Sep 2026',
     'bonus', 48,
     '2026-09-09T00:00:00+03:00',
     '2026-09-13T23:59:59+03:00',
     null, true)
on conflict (code) do nothing;
