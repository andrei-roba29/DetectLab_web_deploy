# DetectLab Premium — Paid Subscription & Membership

Everything about the subscription feature: monthly membership (€5/month),
premium-layer gating, the checkout page, and how **real payments via
Stripe** are wired in — including how to go live and receive payouts.

---

## What was built

| Requirement | Where |
|---|---|
| Weekly & Yearly plans marked **Not available** (semi-transparent tag, disabled) | `index.html` pricing section + `css/styles.css` (`.plan-unavailable`, `.plan-disabled`) |
| Only **Monthly €5** is sold (prices locked to monthly) | `js/translations.js` (`prices`, `isMonthly`) |
| Trying to enable a **premium layer** (or open the Premium tab) instantly opens the membership popup | `js/subscriptions.js` (document-level capture click gate + wrapped toggle functions) |
| Popup "Buy / Cumpără" → **checkout page** | `js/subscriptions.js` (`goToCheckout`) |
| **Buy / Cumpără button in the subscription section** (below the map) → checkout | pricing section button wired to `goToCheckout()` |
| Checkout page → **Stripe Checkout** (cards + Apple Pay + Google Pay handled by Stripe) | `checkout.html`, `js/checkout.js` |
| Checkout session created **server-side** (never trust the browser with prices) | `backend/src/routes/payments.js` → `POST /api/payments/checkout` |
| **Stripe webhook** activates / renews / revokes Premium in the `profiles` table | `backend/src/routes/payments.js` → `POST /api/payments/webhook` + `backend/src/services/subscriptionEvents.js` |
| **Manage / cancel / renew** via the Stripe billing portal | `backend/src/routes/payments.js` → `POST /api/payments/portal` |
| **Manage Account** shows plan + expiration + days left + Manage/Renew button | `js/account-legacy.js` + account panel in `index.html` |

New/changed files (payments):
- `backend/src/routes/payments.js` — checkout / webhook / portal endpoints
- `backend/src/services/stripeClient.js` — minimal Stripe REST client (no SDK dep): Checkout Sessions, subscription/customer lookup, billing portal, webhook signature verification
- `backend/src/services/subscriptionEvents.js` — Stripe event → `profiles` sync logic (pure, unit-tested)
- `backend/src/middleware/requireUser.js` — validates the user's Supabase access token (via Supabase `/auth/v1/user`, so it works regardless of the backend `JWT_SECRET`)
- `backend/migrations/004_stripe_payment_fields.sql` — Stripe columns on `profiles` + drops the client-side UPDATE/INSERT policies
- `supabase/migrations/20260812020000_stripe_payment_fields.sql` — same, for `supabase db push`
- `backend/scripts/setupStripe.js` — creates the product/price and prints your env values
- `checkout.html`, `js/checkout.js`, `js/subscriptions.js`, `js/account-legacy.js`, `js/translations.js`, `css/checkout.css`, `index.html`, `sw.js`
- `test-payments.mjs`, `test-premium-subscription.js`

## How the flow works

1. A free (or logged-out) user tries to switch on any premium layer — APM
   2.0, Roman Empire, Historical maps / Josephine +, LIDAR Scanner,
   Archeological Potential — or clicks the **Premium / Premium** tab.
2. The **membership popup** appears instantly. Logged-out users get a
   "Log in / Register" prompt; logged-in users see the benefits and the
   **Buy Premium · €5/month** button.
3. **Buy** → `checkout.html`. Not logged in? You're sent through login
   first and automatically bounced back to checkout afterwards.
4. On checkout, **Pay €5.00** → the frontend asks the backend
   (`POST /api/payments/checkout`, authenticated with the user's Supabase
   token) for a **Stripe Checkout Session** and redirects the user to
   Stripe's hosted page. Cards, Apple Pay and Google Pay are all handled
   by Stripe — DetectLab never sees card data (PCI scope stays with Stripe).
5. Stripe confirms the payment and calls the **webhook**
   (`POST /api/payments/webhook`). The server:
   - `checkout.session.completed` → activates Premium until the end of the billing period;
   - `invoice.paid` → renews (extends to the new period end) — automatic monthly renewals;
   - `invoice.payment_failed` → marks the subscription `past_due` (access kept until period end);
   - `customer.subscription.deleted` → revokes Premium (access ends).
   The webhook writes directly to `public.profiles` (server-side DB
   connection, RLS-bypassing on purpose — see security note below).
6. The checkout page polls the user's profile until the webhook lands
   (a few seconds), then shows the success screen with the exact
   expiration date.
7. **Manage Account** shows a `PREMIUM` badge, `Expires on: dd.mm.yyyy`,
   days left, and a **Manage subscription** button that opens the Stripe
   billing portal (change card, cancel, renew — no billing UI to build).

## Going live with Stripe (get the money into your account)

Stripe fully supports Romanian businesses (launched in RO — Billing,
subscriptions and payouts to a Romanian bank account are available).

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

### 3. Create the product + price (one-time)
```bash
cd backend
STRIPE_SECRET_KEY=sk_test_xxx node scripts/setupStripe.js
```
This creates (idempotently) the **DetectLab Premium** product and the
**€5/month** recurring price, then prints:
- `STRIPE_PRICE_ID=price_xxx` (add to your backend env)
- instructions for the webhook secret (step 5)

> Do the same with your `sk_live_...` key before going live — test and
> live have separate products/prices.

### 4. Set the backend environment variables
On **Railway** (or wherever `backend/` runs) and in `backend/.env`
(local), set:

```
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx        # from step 5
STRIPE_PRICE_ID=price_xxx              # from step 3
STRIPE_SITE_URL=https://your-frontend-host   # checkout return redirects
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key        # same as js/supabase.js
```

`STRIPE_SITE_URL` is the public origin of the frontend (e.g. your GitHub
Pages URL). If left empty, the backend falls back to the request's
`Origin` header — fine for local testing.

### 5. Configure the webhook
- **Production:** Stripe Dashboard → **Developers → Webhooks → Add
  endpoint** → URL `https://<your-backend-host>/api/payments/webhook`.
  Events: `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated`,
  `customer.subscription.deleted`. After saving, click **Reveal signing
  secret** → copy `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
- **Local dev:** `stripe listen --forward-to localhost:3001/api/payments/webhook`
  (uses the Stripe CLI) — it prints a `whsec_...` to use locally.

### 6. Apply the database migration
```bash
cd backend && npm run migrate          # adds Stripe columns + drops client UPDATE policy
```
or run `supabase/migrations/20260812020000_stripe_payment_fields.sql`
in the Supabase SQL editor.

### 7. Test end-to-end (test mode)
With `sk_test_...` keys set:
- Go through checkout and pay with Stripe's test card **4242 4242 4242
  4242** (any future expiry, any CVC).
- The webhook fires → your `profiles` row gets `plan='premium'` and a
  `premium_expires_at` ≈ now + 1 month.
- The billing portal lets you cancel — cancelling revokes access on
  `customer.subscription.deleted`.

### 8. Go live
- Switch `STRIPE_SECRET_KEY` to `sk_live_...`, `STRIPE_PRICE_ID` to the
  live price id, `STRIPE_WEBHOOK_SECRET` to the live endpoint's secret,
  redeploy.
- Make a small real purchase yourself first (you can refund it from the
  Stripe dashboard).
- Revenue appears in **Stripe Dashboard → Balances**, then is paid out
  to your RO IBAN on the payout schedule.

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

## Local dev checklist

1. `cp backend/.env.example backend/.env` and fill in values.
2. `cd backend && npm install && npm run migrate`.
3. `stripe listen --forward-to localhost:3001/api/payments/webhook` and
   put the printed secret in `STRIPE_WEBHOOK_SECRET`.
4. `npm run dev` in `backend/`, serve the site root (`python3 -m http.server`),
   open `checkout.html`, pay with test card `4242 4242 4242 4242`.

## Translations

All strings are in `js/translations.js` under the `prem_*`, `co_*` and
`acct_*` keys (English + Romanian).

## Tests

```bash
node test-premium-subscription.js   # 40 assertions (pricing, gating, purchase, Stripe redirect checkout)
node test-payments.mjs              # 27 assertions (webhook signature, event mapping, handler, auth middleware)
```
