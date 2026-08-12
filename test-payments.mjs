/* Smoke tests for the Stripe payments backend (no network / no DB).
   Run:  node test-payments.mjs   (from repo root)

   Covers:
     · webhook signature verification (valid / wrong secret / stale)
     · event → action classification
     · full webhook handler with stubbed Stripe client + DB
     · Supabase token middleware (requireUser)
*/

import crypto from 'node:crypto';

// ── Env required by the backend modules at import time ────────────────
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
process.env.JWT_SECRET = 'test-secret';
process.env.ARCGIS_BASE_URL = 'https://example.invalid/arcgis';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_ID = 'price_test_123';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.PORT = '3999';

const { constructWebhookEvent, isConfigured } = await import('./backend/src/services/stripeClient.js');
const { classifyEvent, createEventHandler } = await import('./backend/src/services/subscriptionEvents.js');
const { requireUser } = await import('./backend/src/middleware/requireUser.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function sign(payload, secret = 'whsec_test_secret', ts = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  return `t=${ts},v1=${sig}`;
}

function ev(type, object, extra) {
  return Object.assign({ id: 'evt_1', type, data: { object } }, extra || {});
}

/* ── 1) Webhook signature verification ─────────────────────────────── */

function testSignature() {
  console.log('\n[1] Webhook signature verification');
  const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });

  const e = constructWebhookEvent(payload, sign(payload));
  ok(e.id === 'evt_1' && e.type === 'invoice.paid', 'valid signature → event parsed');

  let threw = false;
  try { constructWebhookEvent(payload, sign(payload, 'whsec_wrong')); } catch (err) { threw = true; }
  ok(threw, 'wrong signing secret → throws');

  threw = false;
  try { constructWebhookEvent(payload, 't=123,v1=deadbeef'); } catch (err) { threw = true; }
  ok(threw, 'garbage signature → throws');

  threw = false;
  try { constructWebhookEvent(payload, sign(payload, 'whsec_test_secret', Math.floor(Date.now() / 1000) - 1000)); } catch (err) { threw = true; }
  ok(threw, 'stale timestamp (>300s) → throws');

  ok(isConfigured(), 'isConfigured() true with test keys set');
}

/* ── 2) Event classification (pure) ─────────────────────────────────── */

function testClassify() {
  console.log('\n[2] classifyEvent');

  let c = classifyEvent(ev('checkout.session.completed', {
    mode: 'subscription', client_reference_id: 'u1', subscription: 'sub_1', customer: 'cus_1',
  }));
  ok(c.action === 'activate' && c.userId === 'u1' && c.subscriptionId === 'sub_1', 'checkout.session.completed → activate');

  c = classifyEvent(ev('checkout.session.completed', { mode: 'payment', client_reference_id: 'u1' }));
  ok(c.action === 'ignore', 'one-off payment mode → ignore');

  c = classifyEvent(ev('invoice.paid', { subscription: 'sub_1', customer: 'cus_1' }));
  ok(c.action === 'renew' && c.subscriptionId === 'sub_1', 'invoice.paid → renew');

  c = classifyEvent(ev('invoice.payment_failed', { subscription: 'sub_1' }));
  ok(c.action === 'payment_failed', 'invoice.payment_failed → payment_failed');

  c = classifyEvent(ev('customer.subscription.deleted', { id: 'sub_1', metadata: { user_id: 'u1' } }));
  ok(c.action === 'revoke' && c.userId === 'u1', 'subscription.deleted → revoke');

  c = classifyEvent(ev('customer.subscription.updated', { id: 'sub_1', status: 'past_due', metadata: { user_id: 'u1' } }));
  ok(c.action === 'status' && c.status === 'past_due', 'subscription.updated → status');

  c = classifyEvent(ev('charge.succeeded', {}));
  ok(c.action === 'ignore', 'unrelated event → ignore');

  c = classifyEvent(null);
  ok(c.action === 'ignore', 'null event → ignore');
}

/* ── 3) Full handler with stubbed Stripe + DB ───────────────────────── */

async function testHandler() {
  console.log('\n[3] Webhook handler (stubbed Stripe + DB)');

  const stripeStub = {
    retrieveSubscription: async (id) => ({
      id, status: 'active', current_period_end: 1_800_000_000,
      metadata: { user_id: 'u1' },
    }),
    retrieveCustomer: async () => ({ metadata: { user_id: 'u1' } }),
  };
  const upserts = [];
  const dbStub = { upsertSubscription: async (p) => upserts.push(p) };
  const handler = createEventHandler({ stripe: stripeStub, db: dbStub });

  // activate
  let out = await handler(ev('checkout.session.completed', {
    mode: 'subscription', client_reference_id: 'u1', subscription: 'sub_1', customer: 'cus_1',
  }));
  ok(out.handled && out.action === 'activate' && upserts.length === 1, 'activate handled');
  ok(upserts[0].userId === 'u1' && upserts[0].periodEnd === 1_800_000_000, 'activate → correct user + period end');
  ok(upserts[0].action === 'activate' && upserts[0].subscriptionId === 'sub_1', 'activate payload fields');

  // renew (user id only resolvable from subscription metadata)
  upserts.length = 0;
  out = await handler(ev('invoice.paid', { subscription: 'sub_1', customer: 'cus_1' }));
  ok(out.handled && out.action === 'renew', 'renew handled');
  ok(upserts[0].userId === 'u1' && upserts[0].status === 'active', 'renew → user resolved via subscription metadata');

  // revoke
  upserts.length = 0;
  out = await handler(ev('customer.subscription.deleted', { id: 'sub_1', metadata: { user_id: 'u1' } }));
  ok(out.handled && out.action === 'revoke', 'revoke handled');
  ok(upserts[0].action === 'revoke' && upserts[0].userId === 'u1', 'revoke payload');

  // unknown → ignored, nothing written
  upserts.length = 0;
  out = await handler(ev('charge.succeeded', {}));
  ok(!out.handled && upserts.length === 0, 'unknown event ignored, no DB write');

  // no user resolvable → skip
  upserts.length = 0;
  const noMetaStripe = {
    retrieveSubscription: async () => ({ id: 'sub_9', status: 'active', current_period_end: 1_800_000_000, metadata: {} }),
    retrieveCustomer: async () => ({ metadata: {} }),
  };
  const h2 = createEventHandler({ stripe: noMetaStripe, db: dbStub });
  out = await h2(ev('invoice.paid', { subscription: 'sub_9', customer: 'cus_9' }));
  ok(!out.handled && upserts.length === 0, 'no user id resolvable → skipped');
}

/* ── 4) requireUser middleware ──────────────────────────────────────── */

async function testMiddleware() {
  console.log('\n[4] requireUser middleware');

  function makeReq(headers) {
    return { headers: headers || {} };
  }
  function makeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }

  // no token
  let req = makeReq();
  let res = makeRes();
  await requireUser(req, res, () => {});
  ok(res.statusCode === 401, 'no token → 401');

  // Supabase rejects the token
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  req = makeReq({ authorization: 'Bearer bad' });
  res = makeRes();
  await requireUser(req, res, () => {});
  globalThis.fetch = realFetch;
  ok(res.statusCode === 401, 'invalid token (Supabase 401) → 401');

  // valid token
  globalThis.fetch = async (url, init) => {
    ok(url === 'https://example.supabase.co/auth/v1/user', 'calls Supabase /auth/v1/user');
    ok(init.headers.apikey === 'anon-test' && init.headers.Authorization === 'Bearer good', 'passes anon key + bearer token');
    return { ok: true, status: 200, json: async () => ({ id: 'u1', email: 'a@b.ro' }) };
  };
  req = makeReq({ authorization: 'Bearer good' });
  res = makeRes();
  let nextCalled = false;
  await requireUser(req, res, () => { nextCalled = true; });
  ok(nextCalled && req.user && req.user.id === 'u1' && req.user.email === 'a@b.ro', 'valid token → req.user attached');
  globalThis.fetch = realFetch;
}

await testSignature();
await testClassify();
await testHandler();
await testMiddleware();

console.log('\n────────────────────────────────────────');
console.log(`passed: ${passed}   failed: ${failed}`);
process.exit(failed ? 1 : 0);
