#!/usr/bin/env node
/**
 * Send the first DetectLab newsletter to every subscribed user.
 *
 * Usage:
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   SMTP_HOST=smtp.example.com SMTP_USER=... SMTP_PASS=... SMTP_FROM="DetectLab <noreply@detectlab.ro>" \
 *   node backend/scripts/sendFirstNewsletter.js
 *
 *   # Dry run (no e-mail, just counts + preview):
 *   node backend/scripts/sendFirstNewsletter.js --dry-run
 *
 *   # Force resend even if a welcome campaign was already marked sent:
 *   node backend/scripts/sendFirstNewsletter.js --force
 *
 *   # Custom subject / preview (admin override):
 *   node backend/scripts/sendFirstNewsletter.js --subject "Titlu custom" --preview "Preview custom"
 *
 * Credentials for e-mail delivery (pick one):
 *   - SMTP:      SMTP_HOST + SMTP_USER + SMTP_PASS + SMTP_FROM
 *   - Resend:    RESEND_API_KEY + NEWSLETTER_FROM
 *   - Neither:   logged-only mode — the script still marks the campaign as sent
 *                and logs every recipient, so you can demo the flow without SMTP.
 */

import 'dotenv/config';
import { pool } from '../src/config/db.js';
import { buildFirstNewsletter, createCampaign, sendCampaign, getSubscriberCounts, getSubscribedUsers } from '../src/services/newsletter.js';
import { logger } from '../src/logger.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force') || args.includes('--force-resend');
const subjectIdx = args.indexOf('--subject');
const previewIdx = args.indexOf('--preview');
const customSubject = subjectIdx !== -1 ? args[subjectIdx + 1] : null;
const customPreview = previewIdx !== -1 ? args[previewIdx + 1] : null;

async function main() {
  console.log('═'.repeat(60));
  console.log('  DetectLab — First Newsletter sender');
  console.log('═'.repeat(60));

  // Check counts first
  let counts;
  try {
    counts = await getSubscriberCounts();
  } catch (err) {
    console.error('❌ Could not query newsletter counts — is migration 013 applied?');
    console.error('   ', err.message);
    console.error('\n   Run: npm run migrate  (or apply supabase/migrations/20260916000000_newsletter.sql)');
    process.exit(1);
  }

  console.log(`\n📊 Audience:`);
  console.log(`   Total profiles:     ${counts.total_profiles}`);
  console.log(`   ✅ Subscribed:       ${counts.subscribed}`);
  console.log(`   ❌ Not subscribed:   ${counts.not_subscribed}`);

  if (dryRun) {
    const audience = await getSubscribedUsers();
    console.log(`\n🔍 Dry run — subscribed users (first 20):`);
    audience.slice(0, 20).forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.email}  (${u.full_name})  subscribed_at=${u.newsletter_subscribed_at || '—'}`);
    });
    if (audience.length > 20) console.log(`   ... and ${audience.length - 20} more`);
    const preview = buildFirstNewsletter();
    console.log(`\n✉️  Preview subject: ${customSubject || preview.subject}`);
    console.log(`   Preview text: ${customPreview || preview.previewText}`);
    console.log(`   HTML length: ${preview.html.length} chars, Text length: ${preview.text.length} chars`);
    console.log(`\n✅ Dry run complete — no e-mail sent. Remove --dry-run to actually send.`);
    await pool.end();
    return;
  }

  if (counts.subscribed === 0) {
    console.log('\n⚠️  No subscribed users — nothing to send.');
    console.log('   Tip: register a test account and check the newsletter checkbox,');
    console.log('        or run:  UPDATE public.profiles SET newsletter_subscribed=true WHERE id=(select id from auth.users limit 1);');
    // Still create a draft campaign so the admin UI shows something
  }

  // Check for an already-sent welcome campaign
  const { rows: existing } = await pool.query(
    `select * from public.newsletter_campaigns where subject like '%Bun venit%' and status='sent' order by sent_at desc limit 1`
  );
  if (existing.length > 0 && !force) {
    console.log(`\n⚠️  A welcome campaign was already sent at ${existing[0].sent_at} (id=${existing[0].id}).`);
    console.log('   Pass --force to resend anyway.');
    console.log(`   Existing campaign: "${existing[0].subject}" → ${existing[0].sent_count} sent, ${existing[0].failed_count} failed`);
    await pool.end();
    return;
  }

  const built = buildFirstNewsletter();
  const subject = customSubject || built.subject;
  const previewText = customPreview || built.previewText;

  console.log(`\n📝 Creating campaign...`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Preview: ${previewText}`);

  const createdBy = null; // CLI has no user id; leave null (or set via NEWSLETTER_SENDER_ID env)
  const campaign = await createCampaign({
    subject,
    previewText,
    html: built.html,
    text: built.text,
    createdBy: process.env.NEWSLETTER_SENDER_ID || null,
  });

  console.log(`   ✅ Campaign created: ${campaign.id} (draft)`);

  console.log(`\n📤 Sending to ${counts.subscribed} subscriber(s)...`);
  console.log('   (one attempt per recipient, sequential to respect rate limits)');

  const result = await sendCampaign(campaign.id, {});

  console.log('\n' + '─'.repeat(60));
  console.log('  Result');
  console.log('─'.repeat(60));
  console.log(`   Campaign:    ${result.campaignId}`);
  console.log(`   Recipients:  ${result.recipients}`);
  console.log(`   ✅ Sent:       ${result.sent}`);
  console.log(`   ❌ Failed:     ${result.failed}`);
  console.log(`   Mode:        ${result.loggedOnly ? 'logged-only (no SMTP/Resend configured — check logs)' : 'real delivery (SMTP/Resend)'}`);

  if (result.loggedOnly) {
    console.log('\n💡 No SMTP/Resend credentials were configured, so e-mails were only logged.');
    console.log('   To actually deliver, set one of:');
    console.log('     SMTP_HOST + SMTP_USER + SMTP_PASS + SMTP_FROM');
    console.log('     or RESEND_API_KEY + NEWSLETTER_FROM');
    console.log('   Then re-run with --force to resend this campaign.');
  } else if (result.failed > 0) {
    console.log('\n⚠️  Some sends failed — check public.newsletter_sends for error details:');
    console.log(`   SELECT email, error FROM public.newsletter_sends WHERE campaign_id='${result.campaignId}' AND status='failed';`);
  } else if (result.recipients > 0) {
    console.log('\n🎉 First newsletter sent successfully!');
  }

  await pool.end();
}

main().catch(async (err) => {
  logger.error({ err }, 'sendFirstNewsletter failed');
  console.error('\n❌ Failed:', err.message);
  console.error(err.stack?.slice(0, 2000));
  try { await pool.end(); } catch {}
  process.exit(1);
});
