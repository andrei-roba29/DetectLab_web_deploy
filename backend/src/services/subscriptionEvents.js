/* ═══════════════════════════════════════════════════════════════════════
   Stripe webhook → profiles sync.
   ───────────────────────────────────────────────────────────────────────
   Translates Stripe subscription events into writes on the user's
   `profiles` row (the backend connects to Postgres directly, which
   bypasses RLS — this is intentional: the webhook is the ONLY writer of
   plan / premium_expires_at in production).

   Events handled:
     checkout.session.completed   → activate (first payment)
     invoice.paid                 → renew (extend to period end)
     invoice.payment_failed       → mark past_due (access kept until end)
     customer.subscription.deleted→ revoke (access ended)
     customer.subscription.updated→ sync status

   classifyEvent() is pure and unit-tested in test-payments.mjs.
   ═══════════════════════════════════════════════════════════════════════ */

import { pool } from '../config/db.js';
import * as stripeApi from './stripeClient.js';
import { logger } from '../logger.js';

/* ── Pure classification (no I/O) ──────────────────────────────────── */

function metadataUserId(obj) {
  const m = obj && obj.metadata;
  return (m && (m.user_id || m.userId)) || (obj && obj.client_reference_id) || null;
}

export function classifyEvent(event) {
  if (!event || !event.type) return { action: 'ignore' };
  const obj = event.data && event.data.object ? event.data.object : {};

  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.mode && obj.mode !== 'subscription') return { action: 'ignore' };
      return {
        action: 'activate',
        userId: metadataUserId(obj),
        subscriptionId: obj.subscription || null,
        customerId: obj.customer || null,
        periodEnd: obj.current_period_end || null,
      };

    case 'invoice.paid':
    case 'invoice.payment_failed':
      return {
        action: event.type === 'invoice.paid' ? 'renew' : 'payment_failed',
        userId: null, // resolved from the subscription's metadata below
        subscriptionId: (obj.subscription) || (obj.subscription_details && obj.subscription_details.id) || null,
        customerId: obj.customer || null,
        periodEnd: obj.period_end || null,
      };

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return {
        action: event.type === 'customer.subscription.deleted' ? 'revoke' : 'status',
        userId: metadataUserId(obj),
        subscriptionId: obj.id || null,
        customerId: obj.customer || null,
        status: obj.status || null,
        periodEnd: obj.current_period_end || null,
      };

    default:
      return { action: 'ignore' };
  }
}

/* ── DB write (single upsert path) ─────────────────────────────────── */

export async function dbFindUserByCustomerId(customerId) {
  const result = await pool.query(
    `select id
       from public.profiles
      where stripe_customer_id = $1
      limit 1`,
    [customerId]
  );
  return result.rows[0]?.id || null;
}

export async function dbUpsertSubscription({ userId, action, status, periodEnd, subscriptionId, customerId }) {
  if (action === 'revoke') {
    await pool.query(
      `update public.profiles
          set plan = 'free', premium_expires_at = null,
              stripe_subscription_status = 'canceled', updated_at = now()
        where id = $1::uuid`,
      [userId]
    );
    return;
  }

  if (action === 'payment_failed') {
    await pool.query(
      `update public.profiles
          set stripe_subscription_status = 'past_due', updated_at = now()
        where id = $1::uuid and stripe_subscription_id = $2`,
      [userId, subscriptionId]
    );
    return;
  }

  // activate / renew / status — grant or extend Premium until period end.
  const expiresAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
  await pool.query(
    `insert into public.profiles
       (id, plan, premium_expires_at, updated_at,
        stripe_customer_id, stripe_subscription_id, stripe_subscription_status)
     values ($1::uuid, 'premium', $2::timestamptz, now(), $3, $4, $5)
     on conflict (id) do update set
       plan = 'premium',
       premium_expires_at = coalesce(excluded.premium_expires_at, public.profiles.premium_expires_at),
       updated_at = now(),
       stripe_customer_id = coalesce(excluded.stripe_customer_id, public.profiles.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.profiles.stripe_subscription_id),
       stripe_subscription_status = excluded.stripe_subscription_status`,
    [userId, expiresAt, customerId, subscriptionId, status || 'active']
  );
}

/* ── Event handler (injectable for tests) ──────────────────────────── */

export function createEventHandler({ stripe, db }) {
  return async function handleEvent(event) {
    const cls = classifyEvent(event);
    if (cls.action === 'ignore') return { handled: false };

    // Resolve the subscription (period end + user id live in its metadata).
    let sub = null;
    if (cls.subscriptionId) {
      try {
        sub = await stripe.retrieveSubscription(cls.subscriptionId);
      } catch (err) {
        logger.warn({ err, subscriptionId: cls.subscriptionId }, 'Failed to retrieve Stripe subscription');
      }
    }

    let userId = cls.userId;
    if (!userId && sub && sub.metadata) userId = sub.metadata.user_id || null;
    if (!userId && cls.customerId) {
      try {
        const customer = await stripe.retrieveCustomer(cls.customerId);
        if (customer && customer.metadata) userId = customer.metadata.user_id || null;
      } catch (err) {
        logger.warn({ err, customerId: cls.customerId }, 'Failed to retrieve Stripe customer');
      }
    }
    if (!userId && cls.customerId && db.findUserByCustomerId) {
      try {
        userId = (await db.findUserByCustomerId(cls.customerId)) || null;
      } catch (err) {
        logger.warn({ err, customerId: cls.customerId }, 'Failed to look up user by Stripe customer id');
      }
    }
    if (!userId) return { handled: false, reason: 'no-user-id' };

    const status = sub ? sub.status : (cls.status || null);
    const periodEnd = (sub && sub.current_period_end) || cls.periodEnd || null;

    await db.upsertSubscription({
      userId,
      action: cls.action,
      status,
      periodEnd,
      subscriptionId: cls.subscriptionId,
      customerId: cls.customerId,
    });

    return { handled: true, action: cls.action, userId };
  };
}

/** Default handler wired to the real Stripe client + Postgres pool. */
export function handleStripeEvent(event) {
  return createEventHandler({
    stripe: stripeApi,
    db: {
      upsertSubscription: dbUpsertSubscription,
      findUserByCustomerId: dbFindUserByCustomerId,
    },
  })(event);
}
