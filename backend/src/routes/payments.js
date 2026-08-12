/* ═══════════════════════════════════════════════════════════════════════
   Payments API — Stripe Checkout + webhook + billing portal.
   ───────────────────────────────────────────────────────────────────────
   · POST /api/payments/checkout   (auth)  → { url }   redirect to Stripe
   · POST /api/payments/webhook    (Stripe)            activates/renews
   · POST /api/payments/portal     (auth)  → { url }   billing portal
   ═══════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { logger } from '../logger.js';
import { requireUser } from '../middleware/requireUser.js';
import * as stripeApi from '../services/stripeClient.js';
import { handleStripeEvent } from '../services/subscriptionEvents.js';

const router = Router();

/** Base URL for success/cancel return links: env override, else Origin. */
function siteUrl(req) {
  return env.stripe.siteUrl || req.headers.origin || `http://localhost:${env.port}`;
}

function notConfigured(res) {
  return res.status(503).json({ error: 'payments_not_configured', message: 'Payments are not configured yet.' });
}

/**
 * Start checkout: creates a Stripe Checkout Session for the €5/month
 * subscription and returns the hosted payment URL (cards + Apple Pay +
 * Google Pay are all handled on Stripe's secure page).
 */
router.post('/payments/checkout', requireUser, async (req, res) => {
  try {
    if (!stripeApi.isConfigured()) return notConfigured(res);

    // Already on an active Stripe subscription? Don't stack a second one —
    // send them to the billing portal instead (409 → frontend shows a hint).
    const { rows } = await pool.query(
      `select stripe_subscription_status, premium_expires_at
         from public.profiles where id = $1::uuid`,
      [req.user.id]
    );
    const row = rows[0];
    if (
      row && row.stripe_subscription_status === 'active' &&
      row.premium_expires_at && new Date(row.premium_expires_at).getTime() > Date.now()
    ) {
      return res.status(409).json({ error: 'already_premium' });
    }

    const session = await stripeApi.createCheckoutSession({
      priceId: env.stripe.priceId,
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
 * Billing portal: lets the user manage / cancel / renew their Stripe
 * subscription without writing a single line of billing UI.
 */
router.post('/payments/portal', requireUser, async (req, res) => {
  try {
    if (!stripeApi.isConfigured()) return notConfigured(res);

    const { rows } = await pool.query(
      `select stripe_customer_id from public.profiles where id = $1::uuid`,
      [req.user.id]
    );
    const customerId = rows[0] && rows[0].stripe_customer_id;
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
