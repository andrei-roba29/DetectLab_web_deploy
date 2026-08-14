/* ═══════════════════════════════════════════════════════════════════════
   Promo codes → Premium grants.
   ───────────────────────────────────────────────────────────────────────
   A promo code lets a user unlock Premium without paying. The first
   campaign is a 24-hour free trial (code TRIAL24, see migration
   006_promo_codes.sql), but the model is generic: every code carries its
   own duration, validity window and redemption cap.

   Rules enforced here
     · one redemption per account per code   (UNIQUE (code, user_id))
     · kind='trial' → one free trial per account EVER, across all trial
       codes (so publishing a new trial code does not re-gift everybody)
     · a trial is refused while Premium is already active, so the user
       does not burn their single free day on top of a paid month
     · kind='bonus' stacks on top of any existing Premium instead
     · codes respect starts_at / expires_at / active / max_redemptions

   The whole redemption runs inside ONE transaction that locks the code
   row (`for update`), so concurrent double-clicks cannot over-redeem a
   capped code or grant Premium twice.

   normalizeCode(), describeCode() and evaluateRedemption() are pure and
   unit-tested in test-promo-codes.mjs.
   ═══════════════════════════════════════════════════════════════════════ */

import { withTransaction, pool } from '../config/db.js';

/** Status written on `profiles.stripe_subscription_status` for promo Premium. */
export const PROMO_STATUS = 'promo_trial';

/** Codes that grant a one-per-account-ever free trial. */
export const TRIAL_KIND = 'trial';

const HOUR_MS = 60 * 60 * 1000;

/* ── Pure helpers ──────────────────────────────────────────────────── */

/**
 * Normalise user input into the canonical stored form: uppercase, no
 * whitespace (users paste "trial 24" / " Trial24 " constantly), and only
 * A-Z / 0-9 / - / _ kept so a code can never smuggle SQL-ish junk around.
 *
 * @returns {string} '' when nothing usable was typed.
 */
export function normalizeCode(input) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 64);
}

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Premium expiry produced by redeeming `durationHours`.
 *
 *  · trial → always now + duration (never stacked, see evaluateRedemption)
 *  · bonus → stacked on top of a still-valid current expiry
 *
 * @returns {string} ISO-8601 timestamp.
 */
export function resolvePromoExpiry({ durationHours, now = new Date(), stackFrom = null }) {
  const hours = Number(durationHours);
  const base = toDate(stackFrom);
  const start = base && base.getTime() > now.getTime() ? base : now;
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return new Date(start.getTime() + safeHours * HOUR_MS).toISOString();
}

/**
 * Decide whether `code` may be redeemed by this account, right now.
 *
 * Pure: every fact it needs is passed in, so the whole decision table is
 * unit-testable without a database.
 *
 * @param {object|null} code       row from public.promo_codes (null = unknown code)
 * @param {object}      ctx
 * @param {Date}        ctx.now
 * @param {boolean}     ctx.alreadyRedeemed  this account already used THIS code
 * @param {boolean}     ctx.trialUsed        this account already used ANY trial code
 * @param {string|null} ctx.currentExpiresAt account's profiles.premium_expires_at
 * @returns {{ok: true, expiresAt: string, durationHours: number}
 *          |{ok: false, error: string, status: number}}
 */
export function evaluateRedemption(code, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();

  if (!code) return { ok: false, error: 'invalid_code', status: 404 };
  if (code.active === false) return { ok: false, error: 'invalid_code', status: 404 };

  const startsAt = toDate(code.starts_at);
  if (startsAt && startsAt.getTime() > now.getTime()) {
    return { ok: false, error: 'code_not_started', status: 409 };
  }

  const expiresAt = toDate(code.expires_at);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return { ok: false, error: 'code_expired', status: 409 };
  }

  const max = code.max_redemptions === null || code.max_redemptions === undefined
    ? null
    : Number(code.max_redemptions);
  if (max !== null && Number.isFinite(max) && Number(code.redeemed_count || 0) >= max) {
    return { ok: false, error: 'code_exhausted', status: 409 };
  }

  if (ctx.alreadyRedeemed) return { ok: false, error: 'already_redeemed', status: 409 };

  const isTrial = (code.kind || TRIAL_KIND) === TRIAL_KIND;
  if (isTrial && ctx.trialUsed) {
    return { ok: false, error: 'trial_already_used', status: 409 };
  }

  const currentExpiry = toDate(ctx.currentExpiresAt);
  const premiumActive = !!currentExpiry && currentExpiry.getTime() > now.getTime();

  // Don't let a user waste their single free trial while Premium is
  // already running — the same guard the paid checkout uses (409).
  if (isTrial && premiumActive) {
    return { ok: false, error: 'already_premium', status: 409 };
  }

  const durationHours = Number(code.duration_hours) > 0 ? Number(code.duration_hours) : 24;

  return {
    ok: true,
    durationHours,
    expiresAt: resolvePromoExpiry({
      durationHours,
      now,
      // Trials start from now; bonuses stack on top of existing Premium.
      stackFrom: isTrial ? null : currentExpiry,
    }),
  };
}

/* ── DB access ─────────────────────────────────────────────────────── */

/**
 * The redemption itself, against an already-open transaction client.
 * Split out from redeemPromoCode() so the whole query sequence can be
 * unit-tested with a stubbed client (see test-promo-codes.mjs).
 *
 * @param {{query: Function}} client  a pg client inside a transaction
 */
export async function redeemWithClient(client, { userId, code: rawCode, now = new Date() }) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: 'invalid_code', status: 400 };

  {
    // Lock the campaign row: serialises concurrent redemptions of the
    // same code so redeemed_count / max_redemptions stay consistent.
    const codeRes = await client.query(
      `select code, kind, duration_hours, starts_at, expires_at,
              max_redemptions, redeemed_count, active
         from public.promo_codes
        where code = $1
        for update`,
      [code]
    );
    const codeRow = codeRes.rows[0] || null;

    // Per-account history: this exact code, and (for trials) any trial.
    const historyRes = await client.query(
      `select
         count(*) filter (where code = $2)          as this_code,
         count(*) filter (where kind = $3)          as trials
       from public.promo_redemptions
      where user_id = $1::uuid`,
      [userId, code, TRIAL_KIND]
    );
    const history = historyRes.rows[0] || {};

    const profileRes = await client.query(
      `select premium_expires_at from public.profiles where id = $1::uuid`,
      [userId]
    );

    const verdict = evaluateRedemption(codeRow, {
      now,
      alreadyRedeemed: Number(history.this_code || 0) > 0,
      trialUsed: Number(history.trials || 0) > 0,
      currentExpiresAt: profileRes.rows[0]?.premium_expires_at || null,
    });
    if (!verdict.ok) return verdict;

    // Claim the redemption first. The UNIQUE (code, user_id) constraint is
    // the real "once per account" guard; `do nothing` turns a race into a
    // clean 409 instead of a 500.
    const claim = await client.query(
      `insert into public.promo_redemptions
         (code, user_id, kind, duration_hours, granted_until)
       values ($1, $2::uuid, $3, $4, $5::timestamptz)
       on conflict (code, user_id) do nothing
       returning id`,
      [code, userId, codeRow.kind || TRIAL_KIND, verdict.durationHours, verdict.expiresAt]
    );
    if (claim.rows.length === 0) {
      return { ok: false, error: 'already_redeemed', status: 409 };
    }

    await client.query(
      `update public.promo_codes
          set redeemed_count = redeemed_count + 1
        where code = $1`,
      [code]
    );

    // Grant Premium. Never shortens an existing later expiry (same
    // greatest() guard the Stripe webhook uses).
    await client.query(
      `insert into public.profiles
         (id, plan, premium_expires_at, updated_at, stripe_subscription_status)
       values ($1::uuid, 'premium', $2::timestamptz, now(), $3)
       on conflict (id) do update set
         plan = 'premium',
         premium_expires_at = greatest(
           excluded.premium_expires_at,
           coalesce(public.profiles.premium_expires_at, excluded.premium_expires_at)
         ),
         updated_at = now(),
         stripe_subscription_status = coalesce(
           public.profiles.stripe_subscription_status, excluded.stripe_subscription_status
         )`,
      [userId, verdict.expiresAt, PROMO_STATUS]
    );

    return {
      ok: true,
      code,
      expiresAt: verdict.expiresAt,
      durationHours: verdict.durationHours,
    };
  }
}

/**
 * Redeem `rawCode` for `userId`.
 *
 * Everything happens in one transaction with the code row locked, so two
 * simultaneous requests cannot both pass the cap / duplicate checks.
 *
 * @returns {Promise<{ok:true, code:string, expiresAt:string, durationHours:number}
 *                 |{ok:false, error:string, status:number}>}
 */
export async function redeemPromoCode({ userId, code, now = new Date() }) {
  return withTransaction((client) => redeemWithClient(client, { userId, code, now }));
}

/**
 * Public description of a code, for the "is this code any good?" preview
 * the UI can show before the user commits. Never reveals whether a code
 * exists in a way that helps guessing: unknown/invalid codes all answer
 * the same way.
 */
export async function describeCode(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const { rows } = await pool.query(
    `select code, kind, duration_hours, expires_at
       from public.promo_codes
      where code = $1 and active = true
        and (starts_at is null or starts_at <= now())
        and (expires_at is null or expires_at > now())`,
    [code]
  );
  return rows[0] || null;
}
