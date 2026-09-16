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
   Admin:  requires header x-admin-key === INGESTION_ADMIN_KEY (or
           Authorization still verified for audit). Falls back to
           NEWSLETTER_ADMIN_KEY if set. In dev with no key configured,
           any authenticated user may list/send (useful for demo).
   ═══════════════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { pool } from '../config/db.js';
import { logger } from '../logger.js';
import { env } from '../config/env.js';
import { requireUser } from '../middleware/requireUser.js';
import * as newsletter from '../services/newsletter.js';

const router = Router();

function isAdmin(req) {
  const key = env.ingestionAdminKey || env.newsletter.adminKey || '';
  if (!key) return true; // no admin key configured → allow authenticated (dev/demo)
  const header = req.headers['x-admin-key'] || req.headers['x-ingestion-key'] || '';
  return header === key;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'forbidden', message: 'Admin key required (x-admin-key)' });
  }
  next();
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
    res.json({ ok: true, ...counts });
  } catch (err) {
    // Table may not exist before migration 013 — return soft error
    res.json({ ok: false, error: err.message.slice(0, 200) });
  }
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
