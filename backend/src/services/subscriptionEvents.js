/* ═══════════════════════════════════════════════════════════════════════
   Stripe webhook → profiles sync.
   ───────────────────────────────────────────────────────────────────────
   Translates Stripe events into writes on the user's `profiles` row (the
   backend connects to Postgres directly, which bypasses RLS — this is
   intentional: the webhook is the ONLY writer of plan /
   premium_expires_at in production).

   DetectLab sells a ONE-TIME €5 purchase that grants Premium for one
   calendar month, with no automatic renewal. Legacy recurring
   subscriptions (sold before the switch) are still honoured.

   Events handled:
     checkout.session.completed (mode=payment, payment_status=paid)
       → one_time_purchase: grant Premium for one calendar month
     checkout.session.async_payment_succeeded (mode=payment, paid)
       → one_time_purchase (delayed payment methods)
     checkout.session.completed (mode=subscription)   → activate  [legacy]
     invoice.paid                                     → renew     [legacy]
     invoice.payment_failed                           → past_due  [legacy]
     customer.subscription.deleted                    → revoke    [legacy]
     customer.subscription.updated                    → status    [legacy]

   classifyEvent(), addCalendarMonth() and resolveOneTimeExpiry() are pure
   and unit-tested in test-payments.mjs.
   ═══════════════════════════════════════════════════════════════════════ */

import { pool } from '../config/db.js';
import * as stripeApi from './stripeClient.js';
import { logger } from '../logger.js';

/** Status written for a one-time purchase (distinguishable from legacy). */
export const ONE_TIME_STATUS = 'one_time_paid';

/* ── Pure classification (no I/O) ──────────────────────────────────── */

function metadataUserId(obj) {
  const m = obj && obj.metadata;
  return (m && (m.user_id || m.userId)) || (obj && obj.client_reference_id) || null;
}

/** Unix-seconds timestamp of the moment the payment was confirmed. */
function confirmedAt(event, obj) {
  const candidates = [
    event && event.created,
    obj && obj.created,
  ];
  for (const c of candidates) {
    const n = typeof c === 'number' ? c : Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function classifyCheckoutSession(event, obj) {
  const mode = obj.mode || null;

  // Legacy recurring checkout keeps its old behaviour.
  if (mode === 'subscription' || (!mode && obj.subscription)) {
    return {
      action: 'activate',
      userId: metadataUserId(obj),
      subscriptionId: obj.subscription || null,
      customerId: obj.customer || null,
      periodEnd: obj.current_period_end || null,
    };
  }

  if (mode !== 'payment') return { action: 'ignore' };

  // One-time purchase: Premium is granted ONLY once Stripe confirms the
  // money actually arrived. `payment_status` is 'unpaid' for delayed
  // payment methods (the async_payment_succeeded event follows later)
  // and 'no_payment_required' for €0 sessions.
  if (obj.payment_status !== 'paid') {
    return { action: 'ignore', reason: 'not-paid' };
  }

  return {
    action: 'one_time_purchase',
    userId: metadataUserId(obj),
    customerId: obj.customer || null,
    paymentIntentId: (typeof obj.payment_intent === 'string' ? obj.payment_intent : null),
    paidAt: confirmedAt(event, obj),
  };
}

export function classifyEvent(event) {
  if (!event || !event.type) return { action: 'ignore' };
  const obj = event.data && event.data.object ? event.data.object : {};

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return classifyCheckoutSession(event, obj);

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

/* ── Premium expiry helpers (pure) ─────────────────────────────────── */

const DEFAULT_PREMIUM_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adds one calendar month to a Date (UTC), clamping the day-of-month when
 * the target month is shorter:
 *   Aug 13 → Sep 13 · Jan 31 → Feb 28 (29 in a leap year) · May 31 → Jun 30
 */
export function addCalendarMonth(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  // Last day of the target month (day 0 of the month after it).
  const lastDayOfTarget = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();

  return new Date(Date.UTC(
    year,
    month + 1,
    Math.min(day, lastDayOfTarget),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()
  ));
}

/**
 * Normalise a Stripe timestamp into a Date.
 * Stripe sends unix *seconds*; millisecond values are tolerated defensively.
 * Returns null for anything unusable (null/undefined/NaN/<= 0/invalid).
 */
function stripeTimestampToDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e11 ? n : n * 1000; // > ~1973 in ms → already milliseconds
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * One-time purchase → Premium for exactly one calendar month starting at
 * the confirmed payment timestamp. Falls back to `now` when Stripe did not
 * give us a usable timestamp.
 *
 * @returns {string} ISO-8601 timestamp.
 */
export function resolveOneTimeExpiry(paidAt, now = new Date()) {
  const start = stripeTimestampToDate(paidAt) || now;
  const end = addCalendarMonth(start) || new Date(start.getTime() + DEFAULT_PREMIUM_DAYS * DAY_MS);
  return end.toISOString();
}

/**
 * Resolve the `premium_expires_at` to write for legacy activate / renew /
 * status events.
 *
 * Premium must NEVER be granted with a missing or already-expired timestamp:
 * Stripe occasionally omits `current_period_end`, and a null or past value
 * would leave the user on plan='premium' with no access. When no *future*
 * period end can be determined we fall back to now + 30 days, which the
 * next `invoice.paid` webhook corrects to the real period end.
 *
 * @returns {string} ISO-8601 timestamp, always strictly in the future.
 */
export function resolvePremiumExpiry(periodEnd, now = new Date()) {
  const end = stripeTimestampToDate(periodEnd);
  if (end && end.getTime() > now.getTime()) return end.toISOString();
  return new Date(now.getTime() + DEFAULT_PREMIUM_DAYS * DAY_MS).toISOString();
}

/* ── DB writes ─────────────────────────────────────────────────────── */

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

/**
 * Idempotency guard: records the Stripe event id and reports whether this
 * is the FIRST time we see it. Replays (Stripe retries, manual resends)
 * therefore never extend Premium twice.
 *
 * @returns {Promise<boolean>} true → process the event, false → duplicate.
 */
export async function dbMarkEventProcessed(eventId, eventType) {
  if (!eventId) return true; // nothing to dedupe on — process it
  const result = await pool.query(
    `insert into public.stripe_processed_events (event_id, event_type)
     values ($1, $2)
     on conflict (event_id) do nothing
     returning event_id`,
    [eventId, eventType || null]
  );
  // `on conflict do nothing` returns zero rows when the id already existed.
  return result.rows.length > 0;
}

/**
 * Releases a previously claimed event id. Used when the DB write that
 * follows the claim fails, so Stripe's retry is not silently swallowed
 * as a "duplicate" and the customer still gets the month they paid for.
 */
export async function dbUnmarkEventProcessed(eventId) {
  if (!eventId) return;
  await pool.query(
    `delete from public.stripe_processed_events where event_id = $1`,
    [eventId]
  );
}

/**
 * One-time €5 purchase → Premium for one calendar month.
 *  · status is set to 'one_time_paid' (distinguishable from legacy 'active')
 *  · any stale stripe_subscription_id is cleared (no renewal exists)
 *  · stripe_customer_id is stored when Stripe gave us one
 *  · an existing later expiry is never shortened
 */
export async function dbUpsertOneTimePurchase({ userId, expiresAt, customerId }) {
  await pool.query(
    `insert into public.profiles
       (id, plan, premium_expires_at, updated_at,
        stripe_customer_id, stripe_subscription_id, stripe_subscription_status)
     values ($1::uuid, 'premium', $2::timestamptz, now(), $3, null, $4)
     on conflict (id) do update set
       plan = 'premium',
       premium_expires_at = greatest(
         excluded.premium_expires_at,
         coalesce(public.profiles.premium_expires_at, excluded.premium_expires_at)
       ),
       updated_at = now(),
       stripe_customer_id = coalesce(excluded.stripe_customer_id, public.profiles.stripe_customer_id),
       stripe_subscription_id = null,
       stripe_subscription_status = excluded.stripe_subscription_status`,
    [userId, expiresAt, customerId || null, ONE_TIME_STATUS]
  );
}

/**
 * Legacy recurring subscription sync.
 *
 * `revoke` and `status` are additionally guarded so a late cancellation /
 * update of an OLD subscription can never revoke or overwrite a NEWER
 * one-time purchase.
 */
export async function dbUpsertSubscription({ userId, action, status, periodEnd, subscriptionId, customerId }) {
  if (action === 'revoke') {
    await pool.query(
      `update public.profiles
          set plan = 'free', premium_expires_at = null,
              stripe_subscription_status = 'canceled', updated_at = now()
        where id = $1::uuid
          and not (
            coalesce(stripe_subscription_status, '') = $2
            and premium_expires_at is not null
            and premium_expires_at > now()
          )`,
      [userId, ONE_TIME_STATUS]
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

  if (action === 'status') {
    // Same upsert as activate/renew, but skipped entirely when the row is
    // an unexpired one-time purchase (a late `customer.subscription.updated`
    // for an old subscription must not overwrite it).
    await pool.query(
      `insert into public.profiles
         (id, plan, premium_expires_at, updated_at,
          stripe_customer_id, stripe_subscription_id, stripe_subscription_status)
       values ($1::uuid, 'premium', $2::timestamptz, now(), $3, $4, $5)
       on conflict (id) do update set
         plan = 'premium',
         premium_expires_at = greatest(
           excluded.premium_expires_at,
           coalesce(public.profiles.premium_expires_at, excluded.premium_expires_at)
         ),
         updated_at = now(),
         stripe_customer_id = coalesce(excluded.stripe_customer_id, public.profiles.stripe_customer_id),
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.profiles.stripe_subscription_id),
         stripe_subscription_status = excluded.stripe_subscription_status
       where not (
         coalesce(public.profiles.stripe_subscription_status, '') = $6
         and public.profiles.premium_expires_at is not null
         and public.profiles.premium_expires_at > now()
       )`,
      [
        userId,
        resolvePremiumExpiry(periodEnd),
        customerId,
        subscriptionId,
        status || 'active',
        ONE_TIME_STATUS,
      ]
    );
    return;
  }

  // activate / renew — grant or extend Premium until period end.
  // Guard: never write a missing or already-past expiry (resolvePremiumExpiry).
  const expiresAt = resolvePremiumExpiry(periodEnd);
  await pool.query(
    `insert into public.profiles
       (id, plan, premium_expires_at, updated_at,
        stripe_customer_id, stripe_subscription_id, stripe_subscription_status)
     values ($1::uuid, 'premium', $2::timestamptz, now(), $3, $4, $5)
     on conflict (id) do update set
       plan = 'premium',
       premium_expires_at = greatest(
         excluded.premium_expires_at,
         coalesce(public.profiles.premium_expires_at, excluded.premium_expires_at)
       ),
       updated_at = now(),
       stripe_customer_id = coalesce(excluded.stripe_customer_id, public.profiles.stripe_customer_id),
       stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.profiles.stripe_subscription_id),
       stripe_subscription_status = excluded.stripe_subscription_status`,
    [userId, expiresAt, customerId, subscriptionId, status || 'active']
  );
}

/* ── Event handler (injectable for tests) ──────────────────────────── */

export function createEventHandler({ stripe, db }) {
  /** Returns false when this event id was already processed before. */
  async function claimEvent(event) {
    if (!db.markEventProcessed) return true;
    try {
      return await db.markEventProcessed(event && event.id, event && event.type);
    } catch (err) {
      logger.warn({ err, eventId: event && event.id }, 'Failed to record Stripe event id');
      return true; // never drop a payment because the dedupe table hiccuped
    }
  }

  /**
   * Runs the DB write for a claimed event, releasing the claim again if it
   * throws — otherwise a transient DB error would mark the event as
   * "processed" and Stripe's retry would be skipped as a duplicate.
   */
  async function writeClaimed(event, write) {
    try {
      await write();
    } catch (err) {
      if (db.unmarkEventProcessed) {
        try {
          await db.unmarkEventProcessed(event && event.id);
        } catch (releaseErr) {
          logger.warn({ err: releaseErr, eventId: event && event.id }, 'Failed to release Stripe event id');
        }
      }
      throw err;
    }
  }

  async function resolveUserIdFromCustomer(customerId) {
    let userId = null;
    if (!customerId) return null;
    try {
      const customer = await stripe.retrieveCustomer(customerId);
      if (customer && customer.metadata) userId = customer.metadata.user_id || null;
    } catch (err) {
      logger.warn({ err, customerId }, 'Failed to retrieve Stripe customer');
    }
    if (!userId && db.findUserByCustomerId) {
      try {
        userId = (await db.findUserByCustomerId(customerId)) || null;
      } catch (err) {
        logger.warn({ err, customerId }, 'Failed to look up user by Stripe customer id');
      }
    }
    return userId;
  }

  return async function handleEvent(event) {
    const cls = classifyEvent(event);
    if (cls.action === 'ignore') return { handled: false, reason: cls.reason || 'unhandled-event' };

    /* ── One-time purchase (the current product) ──────────────────── */
    if (cls.action === 'one_time_purchase') {
      const userId = cls.userId || (await resolveUserIdFromCustomer(cls.customerId));
      if (!userId) return { handled: false, reason: 'no-user-id' };

      if (!(await claimEvent(event))) {
        return { handled: false, reason: 'duplicate-event', duplicate: true };
      }

      const expiresAt = resolveOneTimeExpiry(cls.paidAt);
      await writeClaimed(event, () => db.upsertOneTimePurchase({
        userId,
        expiresAt,
        customerId: cls.customerId || null,
      }));

      return { handled: true, action: 'one_time_purchase', userId, expiresAt };
    }

    /* ── Legacy recurring subscription events ─────────────────────── */

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
    if (!userId) userId = await resolveUserIdFromCustomer(cls.customerId);
    if (!userId) return { handled: false, reason: 'no-user-id' };

    if (!(await claimEvent(event))) {
      return { handled: false, reason: 'duplicate-event', duplicate: true };
    }

    const status = sub ? sub.status : (cls.status || null);
    const periodEnd = (sub && sub.current_period_end) || cls.periodEnd || null;

    await writeClaimed(event, () => db.upsertSubscription({
      userId,
      action: cls.action,
      status,
      periodEnd,
      subscriptionId: cls.subscriptionId,
      customerId: cls.customerId,
    }));

    return { handled: true, action: cls.action, userId };
  };
}

/** Default handler wired to the real Stripe client + Postgres pool. */
export function handleStripeEvent(event) {
  return createEventHandler({
    stripe: stripeApi,
    db: {
      upsertSubscription: dbUpsertSubscription,
      upsertOneTimePurchase: dbUpsertOneTimePurchase,
      findUserByCustomerId: dbFindUserByCustomerId,
      markEventProcessed: dbMarkEventProcessed,
      unmarkEventProcessed: dbUnmarkEventProcessed,
    },
  })(event);
}
