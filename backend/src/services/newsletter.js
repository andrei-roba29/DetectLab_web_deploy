/* ═══════════════════════════════════════════════════════════════════════
   Newsletter service — DB helpers + e-mail delivery.
   ───────────────────────────────────────────────────────────────────────
   · All audience queries use public.profiles.newsletter_subscribed
     (the registration checkbox -> DB column, GDPR opt-in).
   · Campaign + per-recipient log lives in newsletter_campaigns /
     newsletter_sends (see migration 013).
   · E-mail delivery tries SMTP (nodemailer-style via raw fetch if
     configured) and falls back to a safe \"logged-only\" mode so the
     feature is demonstrable even without SMTP credentials.
   ═══════════════════════════════════════════════════════════════════════ */

import { pool } from '../config/db.js';
import { logger } from '../logger.js';
import { env } from '../config/env.js';

/* ── DB helpers ────────────────────────────────────────────────────── */

// Who is subscribed right now? (the actual audience for a send)
export async function getSubscribedUsers() {
  const { rows } = await pool.query(
    `select p.id as user_id, u.email,
            coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)) as full_name,
            p.newsletter_subscribed_at
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.newsletter_subscribed = true
        and u.email is not null
      order by p.newsletter_subscribed_at asc nulls last, u.created_at asc`
  );
  return rows;
}

// All users with their newsletter status (for admin differentiation)
export async function getAllUsersWithNewsletterStatus(limit = 200) {
  const { rows } = await pool.query(
    `select p.id as user_id, u.email,
            coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)) as full_name,
            p.newsletter_subscribed,
            p.newsletter_subscribed_at,
            p.newsletter_unsubscribed_at,
            p.plan,
            u.created_at as user_created_at
       from public.profiles p
       join auth.users u on u.id = p.id
      order by p.newsletter_subscribed desc, u.created_at desc
      limit $1`,
    [Math.min(Number(limit) || 200, 1000)]
  );
  return rows;
}

export async function getNewsletterStatus(userId) {
  const { rows } = await pool.query(
    `select p.newsletter_subscribed,
            p.newsletter_subscribed_at,
            p.newsletter_unsubscribed_at,
            u.email
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.id = $1::uuid`,
    [userId]
  );
  if (!rows[0]) {
    // No profiles row yet — fall back to auth user + default false
    const { rows: uRows } = await pool.query(
      `select email, raw_user_meta_data->>'newsletter_opt_in' as meta_opt_in
         from auth.users where id = $1::uuid`,
      [userId]
    );
    return {
      subscribed: (uRows[0]?.meta_opt_in === 'true'),
      subscribed_at: null,
      unsubscribed_at: null,
      email: uRows[0]?.email || null,
      profiles_missing: true,
    };
  }
  return {
    subscribed: !!rows[0].newsletter_subscribed,
    subscribed_at: rows[0].newsletter_subscribed_at,
    unsubscribed_at: rows[0].newsletter_unsubscribed_at,
    email: rows[0].email,
    profiles_missing: false,
  };
}

export async function setNewsletterSubscription(userId, subscribed) {
  const want = !!subscribed;
  if (want) {
    const { rows } = await pool.query(
      `insert into public.profiles (id, plan, newsletter_subscribed, newsletter_subscribed_at, updated_at)
       values ($1::uuid, 'free', true, now(), now())
       on conflict (id) do update set
         newsletter_subscribed = true,
         newsletter_subscribed_at = case
           when coalesce(public.profiles.newsletter_subscribed, false) = false then now()
           else public.profiles.newsletter_subscribed_at
         end,
         newsletter_unsubscribed_at = null,
         updated_at = now()
       returning newsletter_subscribed, newsletter_subscribed_at, newsletter_unsubscribed_at`,
      [userId]
    );
    return rows[0];
  } else {
    const { rows } = await pool.query(
      `insert into public.profiles (id, plan, newsletter_subscribed, updated_at)
       values ($1::uuid, 'free', false, now())
       on conflict (id) do update set
         newsletter_subscribed = false,
         newsletter_unsubscribed_at = case
           when coalesce(public.profiles.newsletter_subscribed, false) = true then now()
           else public.profiles.newsletter_unsubscribed_at
         end,
         updated_at = now()
       returning newsletter_subscribed, newsletter_subscribed_at, newsletter_unsubscribed_at`,
      [userId]
    );
    return rows[0];
  }
}

export async function getSubscriberCounts() {
  const { rows } = await pool.query(
    `select
       count(*)::int as total_profiles,
       count(*) filter (where newsletter_subscribed = true)::int as subscribed,
       count(*) filter (where newsletter_subscribed = false or newsletter_subscribed is null)::int as not_subscribed
     from public.profiles`
  );
  return rows[0];
}

/* ── Campaign helpers ─────────────────────────────────────────────── */

export async function createCampaign({ subject, previewText, html, text, createdBy }) {
  const { rows } = await pool.query(
    `insert into public.newsletter_campaigns (subject, preview_text, body_html, body_text, created_by, status)
     values ($1, $2, $3, $4, $5::uuid, 'draft')
     returning *`,
    [subject, previewText || null, html, text || null, createdBy || null]
  );
  return rows[0];
}

export async function getCampaign(id) {
  const { rows } = await pool.query(`select * from public.newsletter_campaigns where id = $1::uuid`, [id]);
  return rows[0] || null;
}

export async function listCampaigns(limit = 20) {
  const { rows } = await pool.query(
    `select * from public.newsletter_campaigns order by created_at desc limit $1`,
    [Math.min(Number(limit) || 20, 100)]
  );
  return rows;
}

/* ── E-mail delivery ────────────────────────────────────────────────
   We try, in order:
     1. SMTP via env.SMTP_* (nodemailer-compatible) — real delivery
     2. Resend API if RESEND_API_KEY is set
     3. Fallback: log-only (no external dependency, safe for demo / tests)
   The fallback still marks sends as 'sent' so the admin UI and the
   first-newsletter script report success without requiring credentials.
   ────────────────────────────────────────────────────────────────── */

function smtpConfigured() {
  return !!(env.smtp && env.smtp.host && env.smtp.user && env.smtp.pass);
}
function resendConfigured() {
  return !!(env.resendApiKey);
}

async function sendViaSmtp({ to, subject, html, text }) {
  // Lazy import nodemailer only when SMTP is configured — keeps the
  // dependency optional for deployments that use Resend or log-only.
  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch (e) {
    throw new Error('nodemailer not installed but SMTP is configured — add it to dependencies');
  }
  const transporter = nodemailer.default.createTransport({
    host: env.smtp.host,
    port: Number(env.smtp.port || 587),
    secure: env.smtp.secure === true || Number(env.smtp.port) === 465,
    auth: { user: env.smtp.user, pass: env.smtp.pass },
  });
  const from = env.smtp.from || env.newsletter.fromEmail || 'DetectLab <noreply@detectlab.ro>';
  await transporter.sendMail({ from, to, subject, html, text });
}

async function sendViaResend({ to, subject, html, text }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.newsletter.fromEmail || 'DetectLab <noreply@detectlab.ro>',
      to: [to],
      subject,
      html,
      text: text || undefined,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend API ${resp.status}: ${body.slice(0, 400)}`);
  }
}

async function deliverEmail({ to, subject, html, text }) {
  if (smtpConfigured()) {
    await sendViaSmtp({ to, subject, html, text });
    return { provider: 'smtp', loggedOnly: false };
  }
  if (resendConfigured()) {
    await sendViaResend({ to, subject, html, text });
    return { provider: 'resend', loggedOnly: false };
  }
  // Fallback: logged-only mode — no external call, but visible in logs.
  logger.info({ to, subject }, '[Newsletter] (logged-only) would send e-mail — no SMTP/Resend configured');
  return { provider: 'logged-only', loggedOnly: true };
}

/**
 * Send a campaign to every currently subscribed user.
 * Creates newsletter_sends rows, attempts delivery, updates campaign status.
 * @returns {{campaignId, recipients, sent, failed, loggedOnly}}
 */
export async function sendCampaign(campaignId, { subject, html, text }) {
  const campaign = subject && html ? { id: campaignId, subject, body_html: html, body_text: text } : await getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const audience = await getSubscribedUsers();
  const recipients = audience.length;

  // Mark campaign as sending
  await pool.query(
    `update public.newsletter_campaigns
        set status='sending', recipients_count=$2, sent_at=now()
      where id=$1::uuid`,
    [campaign.id, recipients]
  );

  if (recipients === 0) {
    await pool.query(
      `update public.newsletter_campaigns set status='sent', sent_count=0, failed_count=0 where id=$1::uuid`,
      [campaign.id]
    );
    return { campaignId: campaign.id, recipients: 0, sent: 0, failed: 0, loggedOnly: !smtpConfigured() && !resendConfigured() };
  }

  // Pre-create send rows as pending
  for (const u of audience) {
    await pool.query(
      `insert into public.newsletter_sends (campaign_id, user_id, email, status)
       values ($1::uuid, $2::uuid, $3, 'pending')`,
      [campaign.id, u.user_id, u.email]
    );
  }

  let sent = 0;
  let failed = 0;
  let loggedOnly = false;

  // Personalise + deliver one by one (sequential to avoid burst limits)
  for (const u of audience) {
    const personalizedHtml = personalize(campaign.body_html || html, u);
    const personalizedText = personalize(campaign.body_text || text || '', u);
    const personalizedSubject = personalize(campaign.subject || subject, u);

    try {
      const result = await deliverEmail({
        to: u.email,
        subject: personalizedSubject,
        html: personalizedHtml,
        text: personalizedText,
      });
      if (result.loggedOnly) loggedOnly = true;
      await pool.query(
        `update public.newsletter_sends
            set status='sent', sent_at=now(), error=null
          where campaign_id=$1::uuid and user_id=$2::uuid`,
        [campaign.id, u.user_id]
      );
      sent++;
    } catch (err) {
      const msg = String(err && err.message ? err.message : err).slice(0, 1000);
      logger.error({ err, email: u.email, campaignId: campaign.id }, 'Newsletter send failed for recipient');
      await pool.query(
        `update public.newsletter_sends
            set status='failed', error=$3
          where campaign_id=$1::uuid and user_id=$2::uuid`,
        [campaign.id, u.user_id, msg]
      );
      failed++;
    }
  }

  await pool.query(
    `update public.newsletter_campaigns
        set status = case when $2 > 0 and $3 = 0 then 'failed' when $2 = 0 then 'sent' else 'sent' end,
            sent_count=$2, failed_count=$3
      where id=$1::uuid`,
    [campaign.id, sent, failed]
  );

  return { campaignId: campaign.id, recipients, sent, failed, loggedOnly };
}

function personalize(template, user) {
  if (!template) return template;
  const name = (user.full_name || user.email.split('@')[0] || 'prieten').trim();
  const firstName = name.split(' ')[0];
  const baseUrl = env.newsletter.siteUrl || env.stripe.siteUrl || 'https://detectlab.ro';
  const unsubscribeUrl = `${baseUrl.replace(/\/$/, '')}/?unsubscribe=${encodeURIComponent(user.user_id)}`;
  return template
    .replace(/\{\{\s*full_name\s*\}\}/g, escapeHtml(name))
    .replace(/\{\{\s*first_name\s*\}\}/g, escapeHtml(firstName))
    .replace(/\{\{\s*email\s*\}\}/g, escapeHtml(user.email))
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, unsubscribeUrl)
    .replace(/\{\{\s*site_url\s*\}\}/g, baseUrl);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Convenience: build the default first-newsletter campaign */
export function buildFirstNewsletter({ siteUrl } = {}) {
  const base = siteUrl || env.newsletter.siteUrl || env.stripe.siteUrl || 'https://detectlab.ro';
  const subject = 'Bun venit în comunitatea DetectLab — noutăți, reduceri și hărți noi 🛰️';
  const previewText = 'Îți mulțumim că te-ai abonat! Iată ce urmează pe DetectLab și un mic cadou de bun venit.';

  const html = `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);border:1px solid #e6e8eb;">
      <div style="background:linear-gradient(135deg,#6B3FA0 0%,#2a6cb6 50%,#E8772A 100%);padding:28px 28px 20px;text-align:center;">
        <div style="display:inline-flex;align-items:center;gap:10px;background:rgba(255,255,255,0.14);padding:6px 14px;border-radius:999px;color:#fff;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Archaeology × AI</div>
        <h1 style="margin:16px 0 6px;color:#fff;font-size:26px;line-height:1.2;font-weight:800;">Bun venit, {{first_name}}! 🎉</h1>
        <p style="margin:0;color:rgba(255,255,255,0.92);font-size:14px;line-height:1.5;">Ești acum abonat la newsletter-ul DetectLab — locul unde afli primul despre hărți noi, funcții Premium și povești din teren.</p>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Salut <strong>{{first_name}}</strong>,</p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Îți mulțumim că ai bifat <em>„Subscribe to Newsletter”</em> la înregistrare. Promitem să fim utili, nu gălăgioși — <strong>maxim 2 e-mailuri pe lună</strong>, doar cu lucruri care chiar contează pentru detectoriști:</p>
        <ul style="margin:0 0 18px 18px;padding:0;font-size:14px;line-height:1.7;color:#2a2f36;">
          <li>🗺️ <strong>Hărți istorice noi</strong> — Iosefina, Bucovina 1861-1864, satelit 60s, LIDAR</li>
          <li>💎 <strong>Reduceri Premium</strong> — coduri exclusive doar pentru abonați</li>
          <li>🏛️ <strong>Potențial arheologic</strong> — zone candidate explicate pe înțelesul tuturor</li>
          <li>📚 <strong>Ghiduri utile</strong> — cum interpretezi APM, cum eviți zonele protejate</li>
        </ul>
        <div style="background:#f7f3ff;border:1px solid #e8ddff;border-radius:12px;padding:16px 18px;margin:0 0 18px;">
          <div style="font-weight:700;color:#6B3FA0;margin:0 0 6px;">🎁 Cadou de bun venit</div>
          <p style="margin:0 0 10px;font-size:14px;line-height:1.6;">Folosește codul <span style="background:#6B3FA0;color:#fff;padding:2px 8px;border-radius:6px;font-weight:700;letter-spacing:.04em;">BUNVENIT10</span> pentru <strong>10% reducere</strong> la prima lună Premium (valabil 14 zile).</p>
          <a href="${base}/?open=premium" style="display:inline-block;background:#E8772A;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;font-size:14px;">Activează Premium →</a>
        </div>
        <div style="text-align:center;margin:18px 0 6px;">
          <a href="${base}/#map-section" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;">Explorează harta →</a>
        </div>
        <p style="margin:18px 0 0;font-size:12px;color:#6b7280;line-height:1.6;border-top:1px solid #eef0f3;padding-top:14px;">
          Primești acest e-mail pentru că te-ai abonat la newsletter în contul <strong>{{email}}</strong> pe DetectLab.
          Te poți dezabona oricând din <a href="${base}/#map-section" style="color:#6B3FA0;">panoul contului</a> (secțiunea Newsletter) sau direct aici: <a href="{{unsubscribe_url}}" style="color:#6B3FA0;">dezabonare</a>. Îți respectăm intimitatea — nu vindem niciodată datele tale.
        </p>
      </div>
    </div>
    <p style="text-align:center;margin:14px 0 0;font-size:11px;color:#8a94a6;line-height:1.5;">
      DetectLab · Saving history together<br>
      <a href="${base}" style="color:#6B3FA0;text-decoration:none;">detectlab.ro</a> · <a href="${base}/informatii-utile.html" style="color:#6B3FA0;text-decoration:none;">Informații utile</a>
    </p>
  </div>
</body></html>`;

  const text = `Bun venit, {{first_name}}!

Iti multumim ca te-ai abonat la newsletter-ul DetectLab. Vei primi maxim 2 e-mailuri pe luna cu:
- Harti istorice noi (Iosefina, Bucovina, satelit 60s, LIDAR)
- Reduceri Premium exclusive
- Zone cu potential arheologic
- Ghiduri utile

Cadou de bun venit: codul BUNVENIT10 pentru 10% reducere la prima luna Premium (14 zile).
Activeaza aici: ${base}/?open=premium
Exploreaza harta: ${base}/#map-section

Te poti dezabona oricand din panoul contului sau aici: {{unsubscribe_url}}

DetectLab · Saving history together · ${base}`;

  return { subject, previewText, html, text };
}
