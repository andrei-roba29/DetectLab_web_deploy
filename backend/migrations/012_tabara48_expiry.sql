-- DetectLab Premium — extend the TABARA48 campaign
--
-- Migration 011 seeded TABARA48 with 48 hours of Premium, but its
-- redemption window ended on 13 September 2026. This follow-up changes the
-- window for databases where 011 has already been applied. A redemption made
-- through the end of 1 October 2026 (Bucharest time) still grants 48 hours
-- from the moment of redemption. Existing grants are not changed.
--
-- Keep the campaign's active flag, redemption cap and start time untouched so
-- any operational controls made in the SQL editor are preserved.

update public.promo_codes
   set duration_hours = 48,
       expires_at = '2026-10-01T23:59:59+03:00'::timestamptz,
       description = '48-hour Premium bonus campaign, redeemable 9 Sep-1 Oct 2026'
 where code = 'TABARA48';
