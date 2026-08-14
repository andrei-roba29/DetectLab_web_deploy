/* ═══════════════════════════════════════════════════════════════════════
   Promo codes API.
   ───────────────────────────────────────────────────────────────────────
   · POST /api/promo/redeem   (auth) → { premium_expires_at, ... }

   Redeeming a valid code grants Premium without any payment. All the
   rules (validity window, one-per-account, caps) live in
   services/promoCodes.js; this router only does HTTP: auth, rate
   limiting, and mapping verdicts onto status codes.

   Error codes returned to the client (the frontend translates them):
     400 invalid_code        · empty / malformed input
     404 invalid_code        · unknown or deactivated code
     409 code_expired        · campaign is over
     409 code_not_started    · campaign has not opened yet
     409 code_exhausted      · global redemption cap reached
     409 already_redeemed    · this account already used THIS code
     409 trial_already_used  · this account already used its free trial
     409 already_premium     · Premium is still active
     429 too_many_attempts   · brute-force guard
   ═══════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { logger } from '../logger.js';
import { requireUser } from '../middleware/requireUser.js';
import { redeemPromoCode, normalizeCode } from '../services/promoCodes.js';

const router = Router();

/* ── Brute-force guard ─────────────────────────────────────────────── */
/* Codes are short strings, so a determined user could otherwise script
   guesses. Each account gets a small budget of FAILED attempts per
   window; successful redemptions don't count against it. In-memory is
   enough here (single small dyno, and the DB constraints are the real
   protection — this just makes guessing pointless). */

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILED_ATTEMPTS = 10;
const attempts = new Map(); // userId → { count, resetAt }

function tooManyAttempts(userId, now = Date.now()) {
  const entry = attempts.get(userId);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(userId, now = Date.now()) {
  const entry = attempts.get(userId);
  if (!entry || entry.resetAt <= now) {
    attempts.set(userId, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

function clearAttempts(userId) {
  attempts.delete(userId);
}

// Keep the map from growing forever on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}, ATTEMPT_WINDOW_MS).unref?.();

/* ── POST /api/promo/redeem ────────────────────────────────────────── */

router.post('/promo/redeem', requireUser, async (req, res) => {
  const userId = req.user.id;
  const code = normalizeCode(req.body && req.body.code);

  if (!code) {
    return res.status(400).json({ error: 'invalid_code' });
  }
  if (tooManyAttempts(userId)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  try {
    const result = await redeemPromoCode({ userId, code });

    if (!result.ok) {
      // Only wrong-code guesses feed the rate limiter; "you already used
      // it" / "already premium" are honest states, not guessing.
      if (result.error === 'invalid_code') recordFailure(userId);
      logger.info({ userId, code, error: result.error }, 'Promo code rejected');
      return res.status(result.status || 400).json({ error: result.error });
    }

    clearAttempts(userId);
    logger.info(
      { userId, code, expiresAt: result.expiresAt },
      'Promo code redeemed'
    );

    res.json({
      ok: true,
      code: result.code,
      duration_hours: result.durationHours,
      premium_expires_at: result.expiresAt,
    });
  } catch (err) {
    logger.error({ err, userId, code }, 'Promo redemption failed');
    res.status(500).json({ error: 'redeem_failed' });
  }
});

export default router;
