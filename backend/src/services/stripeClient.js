/* ═══════════════════════════════════════════════════════════════════════
   Minimal Stripe REST client (no SDK dependency).
   ───────────────────────────────────────────────────────────────────────
   Uses only global fetch (Node ≥ 18) + node:crypto. Covers everything
   DetectLab needs:

     · create a Checkout Session  (subscription mode, €5/month)
     · retrieve a Subscription / Customer  (webhook follow-ups)
     · create a Billing Portal session  (manage / cancel / renew)
     · verify webhook signatures

   Keys come from env (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
   STRIPE_PRICE_ID) — see backend/.env.example.
   ═══════════════════════════════════════════════════════════════════════ */

import crypto from 'node:crypto';
import { env } from '../config/env.js';

const API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_S = 300; // Stripe's recommended clock tolerance

export function isConfigured() {
  return !!(env.stripe.secretKey && env.stripe.webhookSecret && env.stripe.priceId);
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

export function createCheckoutSession({ priceId, email, userId, successUrl, cancelUrl }) {
  return stripeRequest('/checkout/sessions', {
    method: 'POST',
    params: {
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      customer_creation: 'always',
      'customer_data[email]': email,
      'customer_data[metadata][user_id]': userId,
      'subscription_data[metadata][user_id]': userId,
      client_reference_id: userId,
      'metadata[user_id]': userId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: 'false',
    },
  });
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
