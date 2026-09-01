-- DetectLab Premium — one-year gift codes (single-use)
--
-- Four unique, unguessable codes, each granting ONE YEAR (8 760 hours) of
-- Premium to the account that redeems it. Gift-card semantics:
--   · max_redemptions = 1 → exactly ONE account can redeem each code, ever
--     (further attempts get 409 code_exhausted).
--   · kind = 'bonus'      → once per account per code (UNIQUE (code, user_id)),
--     it is NOT refused while Premium is already active and it STACKS on top
--     of the current expiry (a user with Premium until Dec gets a year added
--     on top; the greatest() guard in services/promoCodes.js means a grant
--     can never shorten existing Premium).
--   · expires_at          → last moment the code can be redeemed: the whole
--     day of 1 October 2026 (UTC). A redemption made on that last day still
--     grants the full year from that moment.
--
-- Codes were generated with crypto.randomBytes over an alphabet without
-- look-alike characters (no 0/O, 1/I/L), so they can be shared as text
-- without misreading.
--
-- Idempotent — safe to run multiple times. `on conflict do nothing` keeps
-- any manual edits already made from the Supabase SQL editor.
--
-- Housekeeping from the Supabase SQL editor:
--   -- end a code early (it stops redeeming, existing grants are untouched)
--   update public.promo_codes set active = false where code = 'DL1Y-3PRY-T5DJ';
--   -- give a code more uses
--   update public.promo_codes set max_redemptions = null where code = 'DL1Y-3PRY-T5DJ';
--   -- see how the campaign is doing
--   select code, redeemed_count, max_redemptions, expires_at
--     from public.promo_codes where code like 'DL1Y-%';

insert into public.promo_codes
    (code, description, kind, duration_hours, starts_at, expires_at, max_redemptions, active)
values
    ('DL1Y-3PRY-T5DJ',
     'One year of Premium - single-use gift code, redeemable until 1 Oct 2026',
     'bonus', 8760, now(), '2026-10-01T23:59:59+00:00', 1, true),
    ('DL1Y-878N-E4S5',
     'One year of Premium - single-use gift code, redeemable until 1 Oct 2026',
     'bonus', 8760, now(), '2026-10-01T23:59:59+00:00', 1, true),
    ('DL1Y-TPJN-A3GG',
     'One year of Premium - single-use gift code, redeemable until 1 Oct 2026',
     'bonus', 8760, now(), '2026-10-01T23:59:59+00:00', 1, true),
    ('DL1Y-HRUZ-MH5E',
     'One year of Premium - single-use gift code, redeemable until 1 Oct 2026',
     'bonus', 8760, now(), '2026-10-01T23:59:59+00:00', 1, true)
on conflict (code) do nothing;
