# DetectLab Premium — One-Time Purchase & Membership

Everything about the Premium feature: a **one-time €5 payment that grants
Premium for one calendar month, with no automatic renewal**,
premium-layer gating, the checkout page, and how **real payments via
Stripe** are wired in — including how to go live and receive payouts.

> **Billing model:** DetectLab used to sell a €5/month auto-renewing Stripe
> subscription. It now sells a **single €5 charge** (Stripe Checkout mode
> `payment`) that grants access for **one calendar month** —
> *August 13 → September 13*, with end-of-month dates clamped
> (*Jan 31 → Feb 28/29*, *May 31 → Jun 30*). Nothing renews and nothing is
> ever charged again unless the user buys another month themselves.
>
> **Legacy subscribers** created before the switch are fully preserved:
> their renewals (`invoice.paid`), cancellations and the Stripe billing
> portal keep working exactly as before.
>
> **Promo codes** are the second way to get Premium: a valid code grants
> access for a fixed number of hours with no payment. Campaigns so far:
> **TRIAL24 — 24 hours free, once per account** and the four **one-year
> gift codes** (`DL1Y-…`, single-use, redeemable until 1 Oct 2026). See
> [Promo codes](#promo-codes-free-trials) below.

---

## What was built

| Requirement | Where |
|---|---|
| Weekly & Yearly plans marked **Not available** (semi-transparent tag, disabled) | `index.html` pricing section + `css/styles.css` (`.plan-unavailable`, `.plan-disabled`) |
| Only the **€5 one-month** product is sold (one-time payment, no renewal) | `js/translations.js` (`prices`, `isMonthly`) |
| **One-time Checkout** (mode `payment`, `STRIPE_ONE_TIME_PRICE_ID`) | `backend/src/services/stripeClient.js` |
| Premium granted for **one calendar month** from the confirmed payment | `backend/src/services/subscriptionEvents.js` (`addCalendarMonth`, `resolveOneTimeExpiry`) |
| Replayed Stripe events **never extend access twice** | `stripe_processed_events` table + `dbMarkEventProcessed()` |
| An account with **unexpired Premium cannot buy another month** | `backend/src/routes/payments.js` (checks `premium_expires_at`) |
| **"Manage subscription" only for legacy recurring subscribers** | `js/subscriptions.js` (`_dlIsLegacySubscriber`), `js/checkout.js`, `js/account-legacy.js` |
| The **Premium tab stays browseable** for free users: every Premium layer is shown with a lock plus a localized membership CTA | `index.html`, `css/styles.css`, `js/subscriptions.js` |
| Trying to enable a **locked premium layer** instantly opens the membership popup | `js/subscriptions.js` (document-level capture click gate + wrapped toggle functions) |
| "Become a premium member / Devino membru premium" and popup "Buy / Cumpără" → **checkout page** | `js/subscriptions.js` (`goToCheckout`) |
| **Buy / Cumpără button in the subscription section** (below the map) → checkout | pricing section button wired to `goToCheckout()` |
| Checkout page → **Stripe Checkout** (cards + Apple Pay + Google Pay handled by Stripe) | `checkout.html`, `js/checkout.js` |
| Checkout session created **server-side** (never trust the browser with prices) | `backend/src/routes/payments.js` → `POST /api/payments/checkout` |
| **Stripe webhook** grants Premium in the `profiles` table | `backend/src/routes/payments.js` → `POST /api/payments/webhook` + `backend/src/services/subscriptionEvents.js` |
| Stripe billing portal — **legacy recurring subscribers only** | `backend/src/routes/payments.js` → `POST /api/payments/portal` (400 `no_subscription` otherwise) |
| **Manage Account** shows plan + expiration + days left + Manage/Renew button | `js/account-legacy.js` + account panel in `index.html` |
| **Promo codes**: redeem a code instead of paying, in the membership popup **and** on the checkout page | `index.html` (`#premPromoWrap`), `checkout.html` (`.co-promo`), `js/subscriptions.js`, `js/checkout.js` |
| Promo redemption is **server-side only**, one per account, enforced by a DB constraint | `backend/src/services/promoCodes.js`, `backend/src/routes/promo.js`, `promo_redemptions` UNIQUE (code, user_id) |

New/changed files (payments):
- `backend/src/routes/payments.js` — checkout / webhook / portal endpoints
- `backend/src/services/stripeClient.js` — minimal Stripe REST client (no SDK dep): Checkout Sessions, subscription/customer lookup, billing portal, webhook signature verification
- `backend/src/services/subscriptionEvents.js` — Stripe event → `profiles` sync logic (pure, unit-tested)
- `backend/src/middleware/requireUser.js` — validates the user's Supabase access token (via Supabase `/auth/v1/user`, so it works regardless of the backend `JWT_SECRET`)
- `backend/migrations/004_stripe_payment_fields.sql` — Stripe columns on `profiles` + drops the client-side UPDATE/INSERT policies
- `supabase/migrations/20260812020000_stripe_payment_fields.sql` — same, for `supabase db push`
- `backend/migrations/005_one_time_premium.sql` — `stripe_processed_events` webhook idempotency table
- `supabase/migrations/20260813010000_one_time_premium.sql` — same, for `supabase db push`
- `backend/scripts/setupStripe.js` — creates the product + **one-time** price and prints your env values
- `checkout.html`, `js/checkout.js`, `js/subscriptions.js`, `js/account-legacy.js`, `js/translations.js`, `css/checkout.css`, `index.html`, `sw.js`
- `test-payments.mjs`, `test-premium-subscription.js`

New/changed files (promo codes):
- `backend/migrations/006_promo_codes.sql` — `promo_codes` + `promo_redemptions` tables, RLS lockdown, seeds `TRIAL24`
- `supabase/migrations/20260814000000_promo_codes.sql` — same, for `supabase db push`
- `backend/src/services/promoCodes.js` — normalisation, the redemption decision table (pure) and the locking transaction
- `backend/src/routes/promo.js` — `POST /api/promo/redeem` + per-account brute-force guard
- `index.html`, `checkout.html`, `js/subscriptions.js`, `js/checkout.js`, `js/translations.js`, `css/styles.css`, `css/checkout.css`
- `test-promo-codes.mjs`

## How the flow works

1. A free (or logged-out) user opens the **Premium / Premium** tab and can
   browse every premium layer — APM 2.0, Roman Empire, Historical maps /
   Josephine +, LIDAR Scanner and Archeological Potential. Every layer has
   a visible lock and the catalogue shows **Become a premium member /
   Devino membru premium**.
2. Trying a locked control opens the **membership popup**. Logged-out users
   get a "Log in / Register" prompt; logged-in users see the benefits and the
   **Buy Premium · €5 for one month** button. A user whose Premium month has
   not expired yet sees their expiration date instead of a buy button.
3. The catalogue CTA or **Buy** → `checkout.html`. Not logged in? You're sent
   through login first and automatically bounced back to checkout afterwards.
4. On checkout, **Pay €5.00** → the frontend asks the backend
   (`POST /api/payments/checkout`, authenticated with the user's Supabase
   token) for a **Stripe Checkout Session in `payment` mode** and redirects
   the user to Stripe's hosted page. Cards, Apple Pay and Google Pay are all
   handled by Stripe — DetectLab never sees card data (PCI scope stays with
   Stripe). The Supabase user id travels in `client_reference_id`, the
   session `metadata`, **and** the PaymentIntent `metadata`.
   If the account still has unexpired Premium the backend answers
   **409 `already_premium`** (decided on `premium_expires_at`, not on a
   subscription status) and the page shows the current expiration date.
5. Stripe confirms the payment and calls the **webhook**
   (`POST /api/payments/webhook`). For the one-time purchase:
   - `checkout.session.completed` with `payment_status: "paid"` → grants
     Premium for **one calendar month from the confirmed payment timestamp**;
   - `checkout.session.async_payment_succeeded` (also only when `paid`) →
     the same grant, for delayed payment methods;
   - a session that is **not** `paid` (`unpaid` / `no_payment_required`) is
     **ignored** — nothing is written.

   The write sets `plan='premium'`, `stripe_subscription_status='one_time_paid'`,
   stores `stripe_customer_id` when Stripe supplied one, and **clears any
   stale `stripe_subscription_id`** (there is no renewal to track). An
   existing later expiry is never shortened.

   Legacy recurring subscribers keep their old handling:
   - `invoice.paid` → renews (extends to the new period end);
   - `invoice.payment_failed` → marks the subscription `past_due`;
   - `customer.subscription.deleted` → revokes Premium;
   - `customer.subscription.updated` → syncs status.

   A late cancellation or update of an **old** subscription can never revoke
   or overwrite a **newer** one-time purchase: both statements are guarded
   against a row that is `one_time_paid` with an unexpired
   `premium_expires_at`.

   **Idempotency:** every handled event id is inserted into
   `public.stripe_processed_events` first. Stripe retries and manual resends
   therefore hit `on conflict do nothing`, are reported as duplicates and
   **never extend access a second time**. If the DB write that follows fails,
   the claim is released so Stripe's retry still succeeds.

   The webhook writes directly to `public.profiles` (server-side DB
   connection, RLS-bypassing on purpose — see security note below).
6. The checkout page polls the user's profile until the webhook lands
   (a few seconds), then shows the success screen with the **exact
   expiration date** and a reminder that nothing renews automatically.
7. **Manage Account** shows a `PREMIUM` badge, `Expires on: dd.mm.yyyy`,
   days left, and the note *"€5 for one month — no automatic renewal"*.
   One-time purchasers get **no "Manage subscription" button** — there is no
   renewal to cancel. Only **legacy recurring subscribers** (a row with a
   `stripe_subscription_id` and a status other than `one_time_paid`) still
   get the Stripe billing portal button.

## Going live with Stripe (get the money into your account)

Stripe fully supports Romanian businesses (launched in RO — payments and
payouts to a Romanian bank account are available).

### 1. Create your Stripe account
- Sign up at <https://dashboard.stripe.com/register> (as a Romanian
  business/individual, your PFA/SRL details).
- Complete the account activation: identity verification + business
  details (CUI/CNP, address).
- In **Settings → Payouts**, add your **Romanian bank account (IBAN)**.
  Stripe pays out subscription revenue there on its standard schedule
  (typically ~2 business days after each charge), minus Stripe's
  processing fees.

### 2. Get your API keys
- Dashboard → **Developers → API keys**. You get a **test** set
  (`sk_test_...`) and a **live** set (`sk_live_...`). Keep the secret
  keys server-side only — never in frontend code.

### 3. Create the product + price (run once)
```bash
cd backend
STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripe.js
```
This creates (idempotently) the **DetectLab Premium** product and the
**€5 one-time** price (no `recurring` interval), then prints:
- `STRIPE_ONE_TIME_PRICE_ID=price_xxx` (add to your backend env)
- instructions for the webhook secret (step 5)

> Do the same with your `sk_live_...` key before going live — test and
> live have separate products/prices.

### 4. Set the backend environment variables
On **Railway** (or wherever `backend/` runs) and in `backend/.env`
(local), set:

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx           # from step 5
STRIPE_ONE_TIME_PRICE_ID=price_xxx        # from step 3 — used by new checkouts
STRIPE_SITE_URL=https://your-frontend-host   # checkout return redirects
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key           # same as js/supabase.js
```

`STRIPE_PRICE_ID` (the old recurring €5/month price) is **legacy only**. It
is still read as a fallback when `STRIPE_ONE_TIME_PRICE_ID` is unset, so an
older deployment keeps working, but new deployments should set only
`STRIPE_ONE_TIME_PRICE_ID`.

`STRIPE_SITE_URL` is the public origin of the frontend (e.g. your GitHub
Pages URL). If left empty, the backend falls back to the request's
`Origin` header — fine for local testing.

### 5. Configure the webhook
- **Production:** Stripe Dashboard → **Developers → Webhooks → Add
  endpoint** → URL `https://<your-backend-host>/api/payments/webhook`.
  Events for the one-time purchase: `checkout.session.completed` and
  `checkout.session.async_payment_succeeded`.
  If you still have legacy subscribers, also subscribe to `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated` and
  `customer.subscription.deleted`. After saving, click **Reveal signing
  secret** → copy `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
- **Local dev:** `stripe listen --forward-to localhost:3001/api/payments/webhook`
  (uses the Stripe CLI) — it prints a `whsec_...` to use locally.

### 6. Apply the database migration
```bash
cd backend && npm run migrate          # Stripe columns, RLS policies, event dedupe table, promo codes
```
or run `supabase/migrations/20260812020000_stripe_payment_fields.sql`,
`supabase/migrations/20260813010000_one_time_premium.sql` and
`supabase/migrations/20260814000000_promo_codes.sql` in the Supabase SQL
editor. The second creates `public.stripe_processed_events`, which the
webhook needs for replay protection; the third creates the promo-code
tables and seeds the `TRIAL24` free trial.

### 7. Test end-to-end (test mode)
With `sk_test_...` keys set:
- Go through checkout and pay with Stripe's test card **4242 4242 4242
  4242** (any future expiry, any CVC).
- The webhook fires → your `profiles` row gets `plan='premium'`,
  `stripe_subscription_status='one_time_paid'` and a `premium_expires_at`
  exactly **one calendar month** after the payment.
- Resend the same event from the Stripe dashboard → the expiry must **not**
  move (replay protection).
- Try to check out again while Premium is still active → the API answers
  **409 `already_premium`**.
- No renewal is ever attempted: `mode=payment` creates no subscription.

### 8. Go live
- Switch `STRIPE_SECRET_KEY` to `sk_live_...`, `STRIPE_ONE_TIME_PRICE_ID`
  to the live one-time price id, `STRIPE_WEBHOOK_SECRET` to the live
  endpoint's secret, redeploy.
- Make a small real purchase yourself first (you can refund it from the
  Stripe dashboard).
- Revenue appears in **Stripe Dashboard → Balances**, then is paid out
  to your RO IBAN on the payout schedule.

## Promo codes (free trials)

A promo code is the **no-payment path to Premium**. Redeeming a valid code
writes exactly the same `plan` / `premium_expires_at` fields the Stripe
webhook writes — the rest of the app cannot tell the difference, so every
premium layer unlocks immediately and expires on its own.

### The first campaign: `TRIAL24`

| | |
|---|---|
| Code | `TRIAL24` |
| Grants | **24 hours** of Premium |
| Per account | **once, ever** (see *trial vs. bonus* below) |
| Code validity | **one month** from the moment the migration first ran |
| Global cap | none (`max_redemptions = null`) |

It is seeded by `backend/migrations/006_promo_codes.sql`, so applying the
migration is all that is needed to make it live.

### One-year gift codes: `DL1Y-…` (single-use)

Seeded by `backend/migrations/010_premium_year_gift_codes.sql`
(`supabase/migrations/20260901000000_premium_year_gift_codes.sql` for
`supabase db push`). Four independent, unguessable codes — hand each one
to a specific person, like a gift card:

| | |
|---|---|
| Codes | `DL1Y-3PRY-T5DJ` · `DL1Y-878N-E4S5` · `DL1Y-TPJN-A3GG` · `DL1Y-HRUZ-MH5E` |
| Grants | **one year** (8 760 hours) of Premium, from the moment of redemption |
| Per code | **one redemption, ever** (`max_redemptions = 1` → further attempts get 409 `code_exhausted`) |
| If Premium is already active | **stacks** — the year is added on top of the current expiry (`kind = 'bonus'`) |
| Code validity | redeemable through **1 October 2026** (end of day, UTC); a redemption on the last day still grants the full year |

The codes were generated with `crypto.randomBytes` over an alphabet
without look-alike characters (no `0/O`, `1/I/L`), so they survive being
copied from a chat message.

### Where users redeem

Both entry points call the same endpoint and show the same messages:

- **Membership popup** (`#premiumModal` → *Have a promo code?*) — the box
  sits under the €5 buy button, collapsed by default so the paid product
  stays the primary action. On success the popup shows the new expiry,
  waits ~1.6 s, closes itself and **replays whatever the user was trying to
  do** (e.g. the premium layer they clicked is switched on).
- **Checkout page** (`checkout.html` → *Have a promo code?*) — same box
  under the pay button. On success the page swaps to a dedicated
  “Promo code redeemed!” card with a *Start exploring the map* button.
  `checkout.html?promo=TRIAL24` (or `?code=`) deep-links with the field
  pre-filled and the box already open, which is what a marketing link
  should point at.

Input is normalised on both sides (`normalizeCode` / `_dlNormalizePromoCode`):
uppercased, whitespace stripped, anything outside `A-Z 0-9 - _` removed. So
`" trial 24 "` and `trial24` both work.

### API

```
POST /api/promo/redeem        Authorization: Bearer <supabase access token>
{ "code": "TRIAL24" }

200 { ok: true, code: "TRIAL24", duration_hours: 24,
      premium_expires_at: "2026-08-15T12:00:00.000Z" }
```

Errors are `{ "error": "<code>" }`; the frontend maps each one to a
localized message (`promo_err_*` keys).

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_code` | empty / malformed input |
| 404 | `invalid_code` | unknown or deactivated code |
| 409 | `code_not_started` | campaign has not opened yet |
| 409 | `code_expired` | campaign is over |
| 409 | `code_exhausted` | global cap reached |
| 409 | `already_redeemed` | this account already used **this** code |
| 409 | `trial_already_used` | this account already used its free trial |
| 409 | `already_premium` | Premium is still active |
| 429 | `too_many_attempts` | 10 failed guesses in 10 min, per account |
| 500 | `redeem_failed` | unexpected server error |

### Rules & why they exist

- **One redemption per account** is enforced by
  `UNIQUE (code, user_id)` on `promo_redemptions`, not by app logic — a
  double-clicked button or two parallel tabs cannot both win. The insert
  uses `on conflict … do nothing`, so a lost race returns a clean 409.
- **The whole redemption is one transaction** that starts with
  `select … from promo_codes … for update`. Concurrent redemptions of a
  capped code are serialised, so `redeemed_count` can never exceed
  `max_redemptions`.
- **`kind = 'trial'` → one free trial per account *ever*.** Publishing
  `TRIAL24B` next month does not hand a second free day to everyone who
  already tried the product. Use **`kind = 'bonus'`** for campaigns that
  should be repeatable per code (a bonus is refused only if that exact
  code was already used by the account).
- **A trial is refused while Premium is active** (`already_premium`) so a
  paying user does not burn their single free day on top of a paid month.
  A **bonus stacks**: it is added on top of the current expiry.
- **A grant never shortens existing Premium** — the profile update uses
  the same `greatest(...)` guard as the Stripe webhook.
- **Only the backend can read codes or write redemptions.** Both tables
  have RLS enabled with **no policies**, so anon/authenticated Supabase
  clients get zero rows; the API reaches them over a direct Postgres
  connection, which bypasses RLS. The browser can never self-grant Premium
  and cannot enumerate valid codes.
- **Promo Premium is not a subscription.** It sets
  `stripe_subscription_status = 'promo_trial'`, which — like
  `'one_time_paid'` — is excluded from the “Manage subscription” button
  and from `POST /api/payments/portal` (400 `no_subscription`).

### Managing codes from Supabase

Everything is plain SQL in the Supabase dashboard — there is no admin UI
or CLI script by design.

```sql
-- See the campaigns and how they're doing
select code, kind, duration_hours, starts_at, expires_at,
       max_redemptions, redeemed_count, active
  from public.promo_codes order by created_at desc;

-- Extend / end the current campaign
update public.promo_codes set expires_at = '2026-12-31T23:59:59Z' where code = 'TRIAL24';
update public.promo_codes set active = false                      where code = 'TRIAL24';

-- End one of the one-year gift codes early (grants already made are untouched)
update public.promo_codes set active = false where code = 'DL1Y-3PRY-T5DJ';

-- A new 7-day bonus, capped at 500 redemptions, running for two weeks
insert into public.promo_codes
  (code, description, kind, duration_hours, starts_at, expires_at, max_redemptions)
values
  ('SUMMER7', 'Summer campaign - 7 days of Premium', 'bonus', 168,
   now(), now() + interval '14 days', 500);

-- Who redeemed what
select code, user_id, granted_until, redeemed_at
  from public.promo_redemptions order by redeemed_at desc limit 50;

-- Let one specific account redeem a code again (support/testing)
delete from public.promo_redemptions where code = 'TRIAL24' and user_id = '<uuid>';
```

> `redeemed_count` is maintained by the API. If you delete redemption rows
> by hand, correct it too:
> `update public.promo_codes c set redeemed_count = (select count(*) from public.promo_redemptions r where r.code = c.code);`

### Applying the migration

```bash
cd backend && npm run migrate     # runs 006_promo_codes.sql
```
or paste `supabase/migrations/20260814000000_promo_codes.sql` into the
Supabase SQL editor. It is idempotent and the `TRIAL24` seed uses
`on conflict do nothing`, so re-running it will not reset the campaign.

## ⚠️ Security notes

- **The Stripe webhook is the ONLY writer of `plan`/`premium_expires_at`.**
  The old demo mode let the browser write its own `profiles` row; with
  real payments that would let anyone grant themselves Premium. Migration
  `20260812020000` drops the client-side `profiles_update_own` and
  `profiles_insert_own` policies. The `select` policy stays (the app reads
  your own subscription status).
- **`backend/.env` is no longer tracked in git** (it contained the live
  database password). Use `backend/.env.example` as the template and set
  real values via your host's env config. Keep Stripe secret keys
  server-side only.
- Stripe webhook requests are **signature-verified** (HMAC-SHA256) before
  any DB write; the checkout endpoint requires a **valid Supabase token**
  and re-checks the user server-side.
- **Promo codes never reach the browser.** `promo_codes` and
  `promo_redemptions` have RLS enabled with no policies, so the only way
  to redeem is `POST /api/promo/redeem` with a valid Supabase token. Wrong
  guesses are rate-limited (10 failures per account per 10 minutes) and
  unknown codes always answer the same `invalid_code`, so the endpoint
  cannot be used to enumerate live campaigns.

## Local dev checklist

1. `cp backend/.env.example backend/.env` and fill in values.
2. `cd backend && npm install && npm run migrate`.
3. `stripe listen --forward-to localhost:3001/api/payments/webhook` and
   put the printed secret in `STRIPE_WEBHOOK_SECRET`.
4. `npm run dev` in `backend/`, serve the site root (`python3 -m http.server`),
   open `checkout.html`, pay with test card `4242 4242 4242 4242`.
5. To exercise the free path instead, open `checkout.html?promo=TRIAL24`
   (or the *Have a promo code?* box in the membership popup) and redeem.
   To try again on the same account:
   `delete from public.promo_redemptions where user_id = '<uuid>';`

## Translations

All strings are in `js/translations.js` under the `prem_*`, `co_*` and
`acct_*` keys (English + Romanian). The monthly-subscription /
automatic-renewal / cancel-anytime wording was replaced everywhere by:

| | English | Romanian |
|---|---|---|
| Price line | *€5 for one month — no automatic renewal* | *5 € pentru o lună — fără reînnoire automată* |
| Buy button | *Buy Premium · €5 for one month* | *Cumpără Premium · 5 € pentru o lună* |
| Pricing note | *One-time payment* | *Plată unică* |
| Success screen | *No automatic renewal — you will not be charged again.* | *Fără reînnoire automată — nu vei mai fi taxat.* |

`test-premium-subscription.js` asserts that no cancel-anytime /
auto-renewal / `/month` wording survives in either language.

The promo-code UI adds the `promo_*` family (19 keys in each language) —
the box labels plus one message per API error code, so the user always
gets a specific reason rather than “something went wrong”:

| | English | Romanian |
|---|---|---|
| Toggle | *Have a promo code?* | *Ai un cod promoțional?* |
| Button | *Redeem* | *Activează* |
| Hint | *Unlock Premium instantly — no payment needed.* | *Deblochează Premium instant — fără plată.* |
| Success | *Code redeemed! Premium is active until {date}.* | *Cod activat! Premium este activ până pe {date}.* |
| Trial used | *Your account has already used its free trial.* | *Contul tău a folosit deja perioada gratuită de probă.* |

## Tests

```bash
node test-payments.mjs              # 82 assertions — backend (Stripe)
node test-promo-codes.mjs           # 84 assertions — backend (promo codes)
node test-premium-subscription.js   # 72 assertions — frontend (needs `npm i jsdom`)
```

`test-payments.mjs` covers webhook signature verification, event
classification, **paid one-time Checkout activation**, **unpaid sessions
being ignored**, **async payment success**, **calendar-month expiry
including end-of-month clamping**, **event-replay idempotency**, legacy
subscription compatibility, Checkout Session parameters (mode `payment`,
one-time price, user id in `client_reference_id` / session metadata /
PaymentIntent metadata, no `subscription_data`) and the auth middleware.

`test-promo-codes.mjs` covers code normalisation (including junk/SQL-ish
input), expiry maths (trial from now vs. bonus stacked on live Premium,
bad durations), the full `evaluateRedemption` decision table with its
check *order* (an unknown code never leaks “already redeemed”), and the
whole redemption transaction against a stubbed pg client: the happy path
writes redemption + count + grant with `greatest()` and `for update`,
every refusal writes **nothing**, and a lost `UNIQUE` race returns
`already_redeemed` without granting Premium twice.

`test-premium-subscription.js` covers pricing wording, the browseable
locked catalogue, layer gating, the Stripe redirect flow, and the one-time
UI rules: no *"Manage subscription"* for one-time purchasers (but still
present for legacy subscribers), an unexpired Premium account cannot buy
another month, and the exact expiration date is always displayed.
