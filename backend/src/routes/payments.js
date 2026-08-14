/* ═══════════════════════════════════════════════════════════════════════
   Payments API — Stripe Checkout + webhook + billing portal.
   ───────────────────────────────────────────────────────────────────────
   · POST /api/payments/checkout   (auth)  → { url }   redirect to Stripe
   · POST /api/payments/webhook    (Stripe)            grants Premium
   · POST /api/payments/portal     (auth)  → { url }   billing portal
                                                       (legacy subscribers)

   DetectLab sells a ONE-TIME €5 payment granting Premium for one calendar
   month, with no automatic renewal. Legacy recurring subscribers created
   before the switch keep working (renewals + billing portal).
   ═══════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { logger } from '../logger.js';
import { requireUser } from '../middleware/requireUser.js';
import * as stripeApi from '../services/stripeClient.js';
import { handleStripeEvent, ONE_TIME_STATUS } from '../services/subscriptionEvents.js';
import { PROMO_STATUS } from '../services/promoCodes.js';

const router = Router();

/** Base URL for success/cancel return links: env override, else Origin. */
function siteUrl(req) {
  return env.stripe.siteUrl || req.headers.origin || `http://localhost:${env.port}`;
}

function notConfigured(res) {
  return res.status(503).json({ error: 'payments_not_configured', message: 'Payments are not configured yet.' });
}

/**
 * Start checkout: creates a Stripe Checkout Session for the one-time €5
 * purchase (Premium for one calendar month, no renewal) and returns the
 * hosted payment URL (cards + Apple Pay + Google Pay are all handled on
 * Stripe's secure page).
 */
router.post('/payments/checkout', requireUser, async (req, res) => {
  try {
    if (!stripeApi.isConfigured()) return notConfigured(res);

    // Premium that has not expired yet? Don't let them buy a second month
    // on top of it (409 → the frontend shows the "already Premium" card).
    // This is decided purely on premium_expires_at, so it works for
    // one-time purchases as well as legacy subscriptions.
    const { rows } = await pool.query(
      `select premium_expires_at
         from public.profiles where id = $1::uuid`,
      [req.user.id]
    );
    const row = rows[0];
    if (row && row.premium_expires_at && new Date(row.premium_expires_at).getTime() > Date.now()) {
      return res.status(409).json({
        error: 'already_premium',
        premium_expires_at: new Date(row.premium_expires_at).toISOString(),
      });
    }

    const session = await stripeApi.createCheckoutSession({
      // Prefer the one-time price; STRIPE_PRICE_ID stays as legacy fallback.
      priceId: stripeApi.checkoutPriceId(),
      email: req.user.email,
      userId: req.user.id,
      successUrl: `${siteUrl(req)}/checkout.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl(req)}/checkout.html?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, 'Failed to create checkout session');
    res.status(err.status || 500).json({ error: 'checkout_failed', message: err.message });
  }
});

/**
 * Stripe webhook — the ONLY writer of plan/premium_expires_at.
 * Mounted with express.raw() in app.js (raw body is required for
 * signature verification).
 */
router.post('/payments/webhook', async (req, res) => {
  if (!stripeApi.isConfigured()) return notConfigured(res);

  let event;
  try {
    event = stripeApi.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    logger.warn({ err: err.message }, 'Webhook signature verification failed');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const outcome = await handleStripeEvent(event);
    logger.info({ type: event.type, outcome }, 'Stripe webhook processed');
    res.json({ received: true, handled: outcome.handled });
  } catch (err) {
    logger.error({ err, type: event.type }, 'Stripe webhook handler failed');
    res.status(500).json({ error: 'webhook_failed' });
  }
});

/**
 * Billing portal: LEGACY recurring subscribers only — it exists to let
 * them change their card or cancel the old auto-renewing subscription.
 *
 * One-time purchasers have nothing to manage (there is no renewal to
 * cancel), so they get 400 `no_subscription` and the UI never shows them
 * a "Manage subscription" button.
 */
router.post('/payments/portal', requireUser, async (req, res) => {
  try {
    if (!stripeApi.isConfigured()) return notConfigured(res);

    const { rows } = await pool.query(
      `select stripe_customer_id, stripe_subscription_id, stripe_subscription_status
         from public.profiles where id = $1::uuid`,
      [req.user.id]
    );
    const row = rows[0] || {};
    const customerId = row.stripe_customer_id;

    // No recurring subscription on file → nothing for the portal to do.
    // One-time purchases and promo grants both set a non-Stripe status.
    if (
      !row.stripe_subscription_id ||
      row.stripe_subscription_status === ONE_TIME_STATUS ||
      row.stripe_subscription_status === PROMO_STATUS
    ) {
      return res.status(400).json({ error: 'no_subscription' });
    }
    if (!customerId) return res.status(400).json({ error: 'no_customer' });

    const session = await stripeApi.createBillingPortalSession({
      customer: customerId,
      returnUrl: `${siteUrl(req)}/checkout.html?payment=portal`,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, 'Failed to create billing portal session');
    res.status(err.status || 500).json({ error: 'portal_failed', message: err.message });
  }
});

export default router;
