/* ═══════════════════════════════════════════════════════════════════════
   Harness for newsletter-admin-key.test.js — NOT a test file itself.
   ───────────────────────────────────────────────────────────────────────
   Boots the real newsletter router on an ephemeral port with a stubbed pg
   pool and a stubbed Supabase user lookup, fires the requests the admin page
   fires, and prints the observed answers as JSON on stdout.

   It is spawned once per environment scenario (see the test file), because
   src/config/env.js freezes process.env at import time — the only honest way
   to exercise "which admin key does the backend accept?" per configuration.

   Run manually:  cd backend && NEWSLETTER_ADMIN_KEY=secret \
     node test/newsletter-admin-key-harness.mjs
   ═══════════════════════════════════════════════════════════════════════ */

import express from 'express';
import { pool } from '../src/config/db.js';

const countsRow = { total_profiles: 3, subscribed: 2, not_subscribed: 1 };
const userRow = {
  user_id: '11111111-1111-1111-1111-111111111111',
  email: 'abonat@detectlab.ro',
  full_name: 'Abonat Test',
  newsletter_subscribed: true,
  newsletter_subscribed_at: '2026-09-16T00:00:00Z',
  newsletter_unsubscribed_at: null,
  plan: 'free',
  user_created_at: '2026-09-01T00:00:00Z',
};
// A draft campaign, so send-first runs the real code path but with an empty
// audience: it returns 200 without trying to deliver anything.
const campaignRow = {
  id: '22222222-2222-2222-2222-222222222222',
  subject: 'Bun venit în comunitatea DetectLab',
  preview_text: 'Bun venit',
  body_html: '<p>Salut!</p>',
  body_text: 'Salut!',
  status: 'draft',
  recipients_count: 0,
  sent_count: 0,
  failed_count: 0,
  created_at: '2026-09-16T00:00:00Z',
  sent_at: null,
};

pool.query = async (sql) => {
  const text = String(sql);
  if (/count\(\*\)::int as total_profiles/.test(text)) return { rows: [countsRow] };
  if (/where p\.newsletter_subscribed = true/.test(text)) return { rows: [] };
  if (/insert into public\.newsletter_campaigns/.test(text)) return { rows: [campaignRow] };
  if (/from public\.newsletter_campaigns where id/.test(text)) return { rows: [campaignRow] };
  if (/from public\.profiles p\s+join auth\.users u/.test(text)) return { rows: [userRow] };
  return { rows: [] };
};

// requireUser validates the bearer token against Supabase; answer as if it were valid.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) =>
  String(url).includes('/auth/v1/user')
    ? { ok: true, json: async () => ({ id: '11111111-1111-1111-1111-111111111111', email: 'admin@detectlab.ro' }) }
    : { ok: false, status: 502, json: async () => ({}) };

const { default: newsletterRouter, getConfiguredAdminKeys, adminKeySources } = await import('../src/routes/newsletter.js');

const app = express();
app.use(express.json());
app.use('/api', newsletterRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/newsletter`;

async function hit(path, { method = 'GET', headers = {} } = {}) {
  try {
    const res = await realFetch(base + path, { method, headers: { Authorization: 'Bearer test-token', ...headers } });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: { transportError: String(err.message) } };
  }
}

const KEY = process.env.NEWSLETTER_TEST_EXPECTED_KEY || 'secret';

const results = {
  env: {
    configuredKeys: getConfiguredAdminKeys(),
    sources: adminKeySources(),
  },
  requests: {
    headerGood: await hit(`/subscribers?limit=1`, { headers: { 'x-admin-key': KEY } }),
    headerBad: await hit(`/subscribers?limit=1`, { headers: { 'x-admin-key': 'with-certainta-gresita' } }),
    headerMissing: await hit('/subscribers?limit=1'),
    headerPadded: await hit('/subscribers?limit=1', { headers: { 'x-admin-key': `  ${KEY}  ` } }),
    headerQuoted: await hit('/subscribers?limit=1', { headers: { 'x-admin-key': `"${KEY}"` } }),
    headerIngestion: await hit('/subscribers?limit=1', { headers: { 'x-ingestion-key': KEY } }),
    queryAdminKey: await hit(`/subscribers?limit=1&admin_key=${encodeURIComponent(KEY)}`),
    queryKey: await hit(`/subscribers?limit=1&key=${encodeURIComponent(KEY)}`),
    queryXAdminKey: await hit(`/subscribers?limit=1&x_admin_key=${encodeURIComponent(KEY)}`),
    queryArray: await hit(`/subscribers?limit=1&admin_key=${encodeURIComponent(KEY)}&admin_key=other`),
    queryBad: await hit('/subscribers?limit=1&admin_key=gresita'),
    campaignsQueryKey: await hit(`/campaigns?limit=5&admin_key=${encodeURIComponent(KEY)}`),
    sendFirstHeaderBad: await hit('/send-first', { method: 'POST', headers: { 'x-admin-key': 'gresita' } }),
    sendFirstQueryGood: await hit(`/send-first?admin_key=${encodeURIComponent(KEY)}`, { method: 'POST' }),
    debugNoKey: await hit('/debug'),
    debugWithKey: await hit(`/debug?admin_key=${encodeURIComponent(KEY)}`),
    debugWithBadKey: await hit('/debug?admin_key=nu-asta'),
    health: await hit('/health'),
  },
};

// The 403 answer must be self-explanatory: the admin page prints it verbatim.
results.forbiddenShape = (() => {
  const r = results.requests.headerMissing;
  const b = r.body || {};
  return {
    status: r.status,
    hasError: typeof b.error === 'string' && b.error.length > 0,
    hasMessage: typeof b.message === 'string' && b.message.length > 0,
    hasHint: typeof b.hint === 'string' && b.hint.length > 20,
    debugKeys: b.debug ? Object.keys(b.debug).sort() : [],
  };
})();

server.close();
process.stdout.write(JSON.stringify(results));
process.exit(0);
