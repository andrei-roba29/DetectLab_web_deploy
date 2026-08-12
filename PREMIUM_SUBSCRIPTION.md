# DetectLab Premium — Paid Subscription & Membership

Everything you need to know about the subscription feature added in this
branch: monthly membership (€5/month), premium-layer gating, the checkout
page and how to take payments live.

---

## What was built

| Requirement | Where |
|---|---|
| Weekly & Yearly plans marked **Not available** (semi-transparent tag, disabled) | `index.html` pricing section + `css/styles.css` (`.plan-unavailable`, `.plan-disabled`) |
| Only **Monthly €5** is sold (prices locked to monthly) | `js/translations.js` (`prices`, `isMonthly`) |
| Trying to enable a **premium layer** (or open the Premium tab) instantly opens the membership popup | `js/subscriptions.js` (document-level capture click gate + wrapped toggle functions) |
| Popup "Buy / Cumpără" → **checkout page** | `js/subscriptions.js` (`goToCheckout`) |
| **Buy / Cumpără button in the subscription section** (below the map) → checkout | pricing section button wired to `goToCheckout()` |
| Checkout page with **card form + Google Pay + Apple Pay** | `checkout.html`, `js/checkout.js`, `css/checkout.css` |
| After payment → user becomes **Premium** | `js/subscriptions.js` (`completePremiumPurchase`) writes `profiles` row (Supabase) + localStorage fallback |
| **Manage account** shows plan + **expiration date** + days left + Renew button | `js/account-legacy.js` (`refreshAccountSubscription`) + account panel in `index.html` |

New files:
- `checkout.html` — checkout page (order summary, wallets, card form, success screen)
- `js/checkout.js` — checkout logic
- `js/subscriptions.js` — plan config, gating, membership popup, purchase, profile sync
- `css/checkout.css` — checkout styling
- `supabase/migrations/20260812010000_create_profiles_subscription.sql` — `profiles` table + RLS
- `test-premium-subscription.js` — smoke tests (run with `node test-premium-subscription.js`)

Modified files:
- `index.html` — pricing cards, premium modal, account subscription section, nav PREMIUM badge, script tag
- `js/translations.js` — prices/notes + all new RO/EN strings
- `js/auth.js` — loads the subscription profile on session sync
- `js/account-legacy.js` — subscription block in Manage Account
- `js/map-app.js` — untouched (gating is done centrally in `subscriptions.js`)
- `css/styles.css`, `sw.js` (cache bump to `detectlab-v38-premium`)

## How the flow works

1. A free (or logged-out) user tries to switch on any premium layer —
   APM 2.0, Roman Empire, Historical maps / Josephine +, LIDAR Scanner,
   Archeological Potential — or clicks the **Premium / Premium** tab.
2. The **membership popup** appears instantly. Logged-out users get a
   "Log in / Register" prompt; logged-in users see the benefits and the
   **Buy Premium · €5/month** button.
3. **Buy** → `checkout.html`. Not logged in? You're sent through login
   first and automatically bounced back to checkout afterwards.
4. On checkout: **Apple Pay / Google Pay** buttons (Payment Request API,
   only shown on devices/browsers that support them) **or** the classic
   card form (name, number, expiry, CVC with validation).
5. Payment confirmed → `completePremiumPurchase()`:
   - sets `plan = 'premium'` + `premium_expires_at = now + 30 days` on the
     user's `profiles` row in Supabase;
   - keeps a localStorage fallback so the demo works even before the
     migration is applied;
   - success screen shows the exact expiration date.
6. **Manage Account** now shows a `PREMIUM` badge, `Expires on: dd.mm.yyyy`,
   days left, and a Renew button. A PREMIUM badge also appears next to
   "Manage Account" in the user menu, and the layer toggles the user tried
   to enable before paying are switched on automatically.

## ⚠️ Demo mode vs. real payments

**The checkout currently runs in DEMO mode**: the payment is simulated
(no real charge is made) and the small "Demo mode" note on the checkout
page says so. This lets you test the entire journey end-to-end right now
without a payment provider.

To accept **real** payments:

1. Pick a provider. **Stripe** is the recommended one — its Payment
   Element supports card + Apple Pay + Google Pay out of the box.
2. Replace `processPayment()` in `js/checkout.js` with a call to your
   provider (e.g. a Supabase edge function that creates a
   `PaymentIntent` / Checkout Session), then `stripe.confirmPayment(...)`.
3. In the **Stripe webhook** handler (server-side, service_role key),
   upsert the user's `profiles` row:
   ```sql
   insert into profiles (id, plan, premium_expires_at, updated_at)
   values ($userId, 'premium', now() + interval '1 month', now())
   on conflict (id) do update
     set plan = 'premium',
         premium_expires_at = now() + interval '1 month',
         updated_at = now();
   ```
   For production security, make the webhook the **only** writer of the
   `plan`/`premium_expires_at` columns and drop the client-side UPDATE
   policy described below.
4. Remove/hide the `co_demo_note` text (edit `co_demo_note` in
   `js/translations.js`).

## Supabase setup (one-time)

Apply the migration:

```bash
supabase db push          # from the repo root (supabase/ folder)
# or run supabase/migrations/20260812010000_create_profiles_subscription.sql
# manually in the Supabase SQL editor
```

What it does:

- `public.profiles` table: `id` (→ `auth.users`), `plan`
  (`'free' | 'premium'`), `premium_expires_at`, `updated_at`.
- Row Level Security enabled.
- Policies: users can `select` / `insert` / `update` **only their own
  row** (used by the demo checkout). In production with a real payment
  provider, keep only `select` and let the webhook (service_role) write.

## Translations

All new strings are in `js/translations.js` under the `prem_*`, `co_*`
and `acct_*` keys (English + Romanian). The pricing notes for weekly /
yearly are `note_weekly` / `note_yearly` ("Not available" / "Indisponibil").

## Tests

```bash
node test-premium-subscription.js   # 31 smoke assertions
```

Covers: pricing (€5 monthly only), gating (free/logged-out/premium),
pending-toggle memory, purchase → profile + localStorage + expiry,
checkout card validation and the success screen.
