/* ═══════════════════════════════════════════════════════════════════════
   Newsletter API.
   ───────────────────────────────────────────────────────────────────────
   · POST /api/newsletter/subscribe   (auth)  → { subscribed: true }
   · POST /api/newsletter/unsubscribe (auth)  → { subscribed: false }
   · GET  /api/newsletter/status      (auth)  → { subscribed, email, ... }
   · GET  /api/newsletter/subscribers (admin) → { subscribed, not_subscribed, total, users[] }
   · GET  /api/newsletter/campaigns   (admin) → list
   · POST /api/newsletter/campaigns   (admin) → { id, subject, ... }
   · POST /api/newsletter/send        (admin) → triggers first / any campaign send
   · POST /api/newsletter/send-first  (admin) → creates + sends the welcome newsletter
   · GET  /api/newsletter/health      (public) → counts w/o auth (for dashboard badge)

   Auth:   requireUser (verifies Supabase JWT)
   Admin:  requires the admin key in header `x-admin-key` (or
           `x-ingestion-key`) OR as a query param `?admin_key=` / `?key=` /
           `?x_admin_key=`. The query fallback exists because from a phone
           there is no console to debug with — the admin page sends both.
           Accepted keys (any one of them, first match wins for reporting):
           INGESTION_ADMIN_KEY → NEWSLETTER_ADMIN_KEY → ADMIN_KEY → ADMINKEY.
           In dev with no key configured, any authenticated user may
           list/send (useful for demo).
   Debug:  GET /api/newsletter/debug (public, no key, no JWT) answers "is a key
           configured at all, and does what you just typed match it?" so the
           admin page can print the reason inline instead of in a console.
           It never echoes the key itself — only lengths and booleans.
   ═══════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../config/db.js';
import { logger } from '../logger.js';
import { env } from '../config/env.js';
import { requireUser } from '../middleware/requireUser.js';
import * as newsletter from '../services/newsletter.js';

const router = Router();

// ── Admin key plumbing ────────────────────────────────────────────────
//
// Every key comparison goes through normalizeKey() on BOTH sides. Pasting a
// secret from a phone keyboard very often appends a space or wraps it in
// straight quotes, and an invisible trailing space is exactly the kind of bug
// that produces "Admin key required" while the value *looks* identical.
const ADMIN_KEY_ENV_NAMES = ['INGESTION_ADMIN_KEY', 'NEWSLETTER_ADMIN_KEY', 'ADMIN_KEY', 'ADMINKEY'];

function normalizeKey(value) {
  let out = value == null ? '' : String(value);
  out = out.replace(/^[\s"'`]+|[\s"'`]+$/g, ''); // trim whitespace + wrapping quotes
  return out;
}

/** All keys the backend will accept, in precedence order. */
export function getConfiguredAdminKeys() {
  const raw = [
    env.ingestionAdminKey,
    env.newsletter && env.newsletter.adminKey,
    process.env.ADMIN_KEY,
    process.env.ADMINKEY,
  ];
  const keys = [];
  for (const entry of raw) {
    const key = normalizeKey(entry);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** The primary configured key (empty string when admin gating is off). */
export function getConfiguredAdminKey() {
  const keys = getConfiguredAdminKeys();
  return keys.length ? keys[0] : '';
}

/** Which env vars are actually set — the answer to "did I put it in the wrong service?" */
export function adminKeySources() {
  return ADMIN_KEY_ENV_NAMES.filter((name) => normalizeKey(process.env[name]));
}

/**
 * The key the caller sent: header first, query params as a no-console
 * fallback. `via` says where it came from so it can be shown to the user.
 */
export function getProvidedAdminKey(req) {
  const headers = (req && req.headers) || {};
  const fromHeader = normalizeKey(headers['x-admin-key'] || headers['x-ingestion-key'] || '');
  if (fromHeader) return { key: fromHeader, via: 'header' };

  const query = (req && req.query) || {};
  for (const name of ['admin_key', 'key', 'x_admin_key']) {
    const value = Array.isArray(query[name]) ? query[name][0] : query[name];
    const fromQuery = normalizeKey(value);
    if (fromQuery) return { key: fromQuery, via: `query:${name}` };
  }
  return { key: '', via: 'none' };
}

function keysMatch(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isAdmin(req) {
  const configured = getConfiguredAdminKeys();
  if (!configured.length) return true; // no admin key configured → allow authenticated (dev/demo)
  const { key } = getProvidedAdminKey(req);
  return configured.some((candidate) => keysMatch(candidate, key));
}

/** Console-free diagnostics — booleans and lengths only, never the key. */
export function adminKeyDiagnostics(req) {
  const configured = getConfiguredAdminKeys();
  const provided = getProvidedAdminKey(req);
  const matched = configured.length ? configured.some((candidate) => keysMatch(candidate, provided.key)) : true;
  return {
    hasConfiguredKey: configured.length > 0,
    adminKeyConfigured: configured.length > 0,
    configuredFrom: adminKeySources(),
    providedKeyLength: provided.key.length,
    providedKeyLooksEmpty: provided.key.length === 0,
    receivedVia: provided.via,
    lengthMatchesConfigured: configured.length > 0 && provided.key.length > 0
      ? configured.some((candidate) => candidate.length === provided.key.length)
      : null,
    isAdmin: isAdmin(req),
    matched,
  };
}

export function adminKeyHint(diag) {
  if (!diag.hasConfiguredKey) {
    return 'Backend-ul nu are nicio cheie admin configurată — merge fără cheie (mod dev). Dacă nu e ce vrei, setează NEWSLETTER_ADMIN_KEY pe serviciul BACKEND și dă Redeploy.';
  }
  if (!diag.providedKeyLength) {
    return 'Nu a ajuns nicio cheie la backend. Scrie-o în câmpul „Admin key” din pagină și apasă din nou — nu e nevoie de consolă.';
  }
  if (diag.lengthMatchesConfigured === false) {
    return `Ai trimis ${diag.providedKeyLength} caractere, dar cheia de pe backend are altă lungime — de obicei un spațiu în plus sau ghilimele la copy-paste. Șterge tot și tastează cheia din nou.`;
  }
  return 'Cheia are aceeași lungime dar alt conținut: verifică diacriticele/majusculele și asigură-te că variabila e pe serviciul BACKEND din Railway (nu pe site), cu numele exact NEWSLETTER_ADMIN_KEY sau INGESTION_ADMIN_KEY, apoi dă Redeploy.';
}

export function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  const diag = adminKeyDiagnostics(req);
  res.status(403).json({
    error: diag.providedKeyLength ? 'admin_key_mismatch' : 'admin_key_required',
    message: diag.providedKeyLength
      ? 'Admin key mismatch — cheia trimisă nu e identică cu cea de pe backend'
      : 'Admin key required (x-admin-key sau ?admin_key=)',
    hint: adminKeyHint(diag),
    debug: diag,
  });
}

// ── User endpoints (auth) ────────────────────────────────────────────

router.get('/newsletter/status', requireUser, async (req, res) => {
  try {
    const status = await newsletter.getNewsletterStatus(req.user.id);
    res.json({ subscribed: status.subscribed, email: status.email || req.user.email, subscribed_at: status.subscribed_at, unsubscribed_at: status.unsubscribed_at });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'newsletter/status failed');
    res.status(500).json({ error: 'status_failed' });
  }
});

router.post('/newsletter/subscribe', requireUser, async (req, res) => {
  try {
    const row = await newsletter.setNewsletterSubscription(req.user.id, true);
    logger.info({ userId: req.user.id, email: req.user.email }, 'Newsletter subscribed');
    res.json({ subscribed: true, subscribed_at: row.newsletter_subscribed_at });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'newsletter/subscribe failed');
    res.status(500).json({ error: 'subscribe_failed' });
  }
});

router.post('/newsletter/unsubscribe', requireUser, async (req, res) => {
  try {
    const row = await newsletter.setNewsletterSubscription(req.user.id, false);
    logger.info({ userId: req.user.id, email: req.user.email }, 'Newsletter unsubscribed');
    res.json({ subscribed: false, unsubscribed_at: row.newsletter_unsubscribed_at });
  } catch (err) {
    logger.error({ err, userId: req.user.id }, 'newsletter/unsubscribe failed');
    res.status(500).json({ error: 'unsubscribe_failed' });
  }
});

// Back-compat + GDPR one-click unsubscribe (token = user_id, validated via admin key or via emailed link that hits frontend which then calls /unsubscribe with auth)
router.post('/newsletter/toggle', requireUser, async (req, res) => {
  const want = req.body && typeof req.body.subscribed === 'boolean' ? req.body.subscribed : null;
  if (want === null) return res.status(400).json({ error: 'missing_subscribed_boolean' });
  try {
    const row = await newsletter.setNewsletterSubscription(req.user.id, want);
    res.json({ subscribed: !!want, subscribed_at: row.newsletter_subscribed_at, unsubscribed_at: row.newsletter_unsubscribed_at });
  } catch (err) {
    logger.error({ err }, 'newsletter/toggle failed');
    res.status(500).json({ error: 'toggle_failed' });
  }
});

// ── Admin / operational ─────────────────────────────────────────────

router.get('/newsletter/health', async (req, res) => {
  try {
    const counts = await newsletter.getSubscriberCounts();
    res.json({ ok: true, adminKeyConfigured: getConfiguredAdminKeys().length > 0, ...counts });
  } catch (err) {
    // Table may not exist before migration 013 — return soft error
    res.json({ ok: false, adminKeyConfigured: getConfiguredAdminKeys().length > 0, error: err.message.slice(0, 200) });
  }
});

// Console-free troubleshooting for the admin page (no JWT, no key required).
// Safe to expose: it only reports booleans/lengths about the key you already
// typed, never the key itself.
router.get('/newsletter/debug', (req, res) => {
  const diag = adminKeyDiagnostics(req);
  res.json({
    ok: true,
    service: 'detectlab-backend',
    nodeEnv: env.nodeEnv,
    adminKeyConfigured: diag.adminKeyConfigured,
    adminKeyConfiguredFrom: diag.configuredFrom,
    providedKeyLength: diag.providedKeyLength,
    providedVia: diag.receivedVia,
    lengthMatchesConfigured: diag.lengthMatchesConfigured,
    isAdmin: diag.isAdmin,
    hint: diag.isAdmin && diag.hasConfiguredKey ? null : adminKeyHint(diag),
    accepted: {
      headers: ['x-admin-key', 'x-ingestion-key'],
      query: ['admin_key', 'key', 'x_admin_key'],
    },
  });
});

router.get('/newsletter/subscribers', requireUser, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const counts = await newsletter.getSubscriberCounts();
    const users = await newsletter.getAllUsersWithNewsletterStatus(limit);
    const subscribedOnly = req.query.subscribed === 'true' ? users.filter(u => u.newsletter_subscribed) : users;
    const notSubscribedOnly = req.query.subscribed === 'false' ? users.filter(u => !u.newsletter_subscribed) : null;
    res.json({
      counts,
      users: notSubscribedOnly || subscribedOnly,
      // Explicit split for frontend differentiation
      subscribed: users.filter(u => u.newsletter_subscribed),
      not_subscribed: users.filter(u => !u.newsletter_subscribed),
    });
  } catch (err) {
    logger.error({ err }, 'newsletter/subscribers failed');
    res.status(500).json({ error: 'subscribers_failed', message: err.message });
  }
});

router.get('/newsletter/campaigns', requireUser, requireAdmin, async (req, res) => {
  try {
    const campaigns = await newsletter.listCampaigns(Number(req.query.limit) || 20);
    res.json({ campaigns });
  } catch (err) {
    logger.error({ err }, 'newsletter/campaigns list failed');
    res.status(500).json({ error: 'campaigns_failed' });
  }
});

router.post('/newsletter/campaigns', requireUser, requireAdmin, async (req, res) => {
  const { subject, preview_text, body_html, body_text } = req.body || {};
  if (!subject || !body_html) return res.status(400).json({ error: 'missing_subject_or_body' });
  try {
    const campaign = await newsletter.createCampaign({
      subject: String(subject).slice(0, 300),
      previewText: preview_text ? String(preview_text).slice(0, 500) : null,
      html: String(body_html),
      text: body_text ? String(body_text) : null,
      createdBy: req.user.id,
    });
    res.status(201).json({ campaign });
  } catch (err) {
    logger.error({ err }, 'newsletter/campaign create failed');
    res.status(500).json({ error: 'create_failed' });
  }
});

// Generic send (by campaign id)
router.post('/newsletter/send', requireUser, requireAdmin, async (req, res) => {
  const campaignId = req.body && req.body.campaign_id ? String(req.body.campaign_id) : null;
  if (!campaignId) return res.status(400).json({ error: 'missing_campaign_id' });
  try {
    const result = await newsletter.sendCampaign(campaignId, {});
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, campaignId }, 'newsletter/send failed');
    res.status(500).json({ error: 'send_failed', message: String(err.message).slice(0, 500) });
  }
});

// First newsletter: create the welcome campaign (if none exists) + send it
router.post('/newsletter/send-first', requireUser, requireAdmin, async (req, res) => {
  try {
    // Reuse an existing draft welcome campaign if present, otherwise create one
    const existing = await pool.query(
      `select * from public.newsletter_campaigns where subject like '%Bun venit%' order by created_at desc limit 1`
    );
    let campaign = existing.rows[0] || null;

    const customSubject = req.body && req.body.subject ? String(req.body.subject).slice(0, 300) : null;
    const customHtml = req.body && req.body.body_html ? String(req.body.body_html) : null;
    const customText = req.body && req.body.body_text ? String(req.body.body_text) : null;

    if (!campaign || customHtml || customSubject) {
      const built = newsletter.buildFirstNewsletter({ siteUrl: req.headers.origin || env.newsletter.siteUrl });
      campaign = await newsletter.createCampaign({
        subject: customSubject || built.subject,
        previewText: built.previewText,
        html: customHtml || built.html,
        text: customText || built.text,
        createdBy: req.user.id,
      });
    }

    if (campaign.status === 'sent' || campaign.status === 'sending') {
      // Already sent — optionally force re-send if ?force=true
      if (String(req.query.force) !== 'true' && !(req.body && req.body.force)) {
        return res.status(409).json({ error: 'already_sent', campaign, message: 'This campaign was already sent. Pass ?force=true to resend.' });
      }
    }

    const result = await newsletter.sendCampaign(campaign.id, {});
    res.json({ ok: true, campaign_id: campaign.id, ...result });
  } catch (err) {
    logger.error({ err }, 'newsletter/send-first failed');
    res.status(500).json({ error: 'send_first_failed', message: String(err.message).slice(0, 600) });
  }
});

export default router;
