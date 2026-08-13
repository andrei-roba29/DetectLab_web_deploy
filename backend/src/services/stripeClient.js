/* ═══════════════════════════════════════════════════════════════════════
   Minimal Stripe REST client (no SDK dependency).
   ───────────────────────────────────────────────────────────────────────
   Uses only global fetch (Node ≥ 18) + node:crypto. Covers everything
   DetectLab needs:

     · create a Checkout Session  (payment mode, one-time €5)
     · retrieve a Subscription / Customer  (legacy webhook follow-ups)
     · create a Billing Portal session  (legacy subscribers only)
     · verify webhook signatures

   Keys come from env (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
   STRIPE_ONE_TIME_PRICE_ID with STRIPE_PRICE_ID as legacy fallback) —
   see backend/.env.example.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { env } from '../config/env.js';

const API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_S = 300; // Stripe's recommended clock tolerance

/**
 * The price new checkouts use: the one-time €5 price when configured,
 * otherwise the legacy recurring price (kept for backwards compatibility
 * with deployments that have not set STRIPE_ONE_TIME_PRICE_ID yet).
 */
export function checkoutPriceId() {
  return env.stripe.oneTimePriceId || env.stripe.priceId || '';
}

/** True when the active checkout price is the one-time (non-recurring) one. */
export function isOneTimeCheckout() {
  return !!env.stripe.oneTimePriceId;
}

export function isConfigured() {
  return !!(env.stripe.secretKey && env.stripe.webhookSecret && checkoutPriceId());
}

function authHeader() {
  return 'Basic ' + Buffer.from(env.stripe.secretKey + ':').toString('base64');
}

/**
 * Raw Stripe API call. GET → query params; POST → form-encoded body.
 * Throws an Error with .status and .stripe (parsed error payload) on
 * non-2xx responses.
 */
export async function stripeRequest(path, opts = {}) {
  const method = opts.method || 'GET';
  const params = opts.params || {};

  const url = new URL(API + path);
  const headers = { Authorization: authHeader(), Accept: 'application/json' };
  let body;

  if (method === 'GET') {
    if (Object.keys(params).length) url.search = new URLSearchParams(params).toString();
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params).toString();
  }

  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error((data.error && data.error.message) || `Stripe API error ${res.status}`);
    err.status = res.status;
    err.stripe = data.error || {};
    throw err;
  }
  return data;
}

/* ── Checkout Sessions ─────────────────────────────────────────────── */

/**
 * Creates a Checkout Session.
 *
 * Default (and the only mode used by DetectLab today) is `payment`: a
 * single €5 charge that grants Premium for one calendar month with NO
 * automatic renewal. `subscription` mode is still reachable via the
 * `mode` argument so legacy deployments keep working unchanged.
 *
 * The authenticated Supabase user id is attached in three places so the
 * webhook can always resolve it:
 *   · client_reference_id
 *   · session metadata
 *   · PaymentIntent metadata (payment mode) / Subscription metadata
 *     (legacy subscription mode)
 */
export function createCheckoutSession({ priceId, email, userId, successUrl, cancelUrl, mode }) {
  const checkoutMode = mode || (isOneTimeCheckout() ? 'payment' : 'subscription');

  const params = {
    mode: checkoutMode,
    'line_items[0][price]': priceId || checkoutPriceId(),
    'line_items[0][quantity]': '1',
    customer_email: email,
    client_reference_id: userId,
    'metadata[user_id]': userId,
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: 'false',
  };

  if (checkoutMode === 'payment') {
    // One-time purchase: carry the user id onto the PaymentIntent too,
    // so charge/payment_intent events can be traced back to the account.
    params['payment_intent_data[metadata][user_id]'] = userId;
  } else {
    // Legacy recurring checkout.
    params['subscription_data[metadata][user_id]'] = userId;
  }

  return stripeRequest('/checkout/sessions', { method: 'POST', params });
}

/** Retrieve a Checkout Session (used to re-confirm payment_status). */
export function retrieveCheckoutSession(id) {
  return stripeRequest('/checkout/sessions/' + encodeURIComponent(id));
}

/* ── Subscriptions / Customers ─────────────────────────────────────── */

export function retrieveSubscription(id) {
  return stripeRequest('/subscriptions/' + encodeURIComponent(id));
}

export function retrieveCustomer(id) {
  return stripeRequest('/customers/' + encodeURIComponent(id));
}

/* ── Billing Portal (manage / cancel / renew) ──────────────────────── */

export function createBillingPortalSession({ customer, returnUrl }) {
  return stripeRequest('/billing_portal/sessions', {
    method: 'POST',
    params: { customer, return_url: returnUrl },
  });
}

/* ── Webhook signature verification ────────────────────────────────── */

/**
 * Verifies the `stripe-signature` header against the raw request body and
 * returns the parsed event object. Throws on any mismatch / stale payload.
 * Mirrors stripe-node's constructEvent().
 */
export function constructWebhookEvent(rawBody, signatureHeader) {
  if (!signatureHeader) throw new Error('Missing Stripe signature header');

  const parts = {};
  for (const pair of signatureHeader.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    parts[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const t = parts.t;
  const sig = parts.v1;
  if (!t || !sig) throw new Error('Malformed Stripe signature header');

  if (Math.abs(Date.now() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_S) {
    throw new Error('Stripe signature timestamp is too old');
  }

  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto
    .createHmac('sha256', env.stripe.webhookSecret)
    .update(`${t}.${payload}`)
    .digest('hex');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Stripe signature mismatch');
  }

  return JSON.parse(payload);
}
