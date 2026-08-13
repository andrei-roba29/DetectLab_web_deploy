/* Smoke tests for the Stripe payments backend (no network / no DB).
   Run:  node test-payments.mjs   (from repo root)

   Covers:
     · webhook signature verification (valid / wrong secret / stale)
     · event → action classification
     · full webhook handler with stubbed Stripe client + DB
     · one-time €5 purchase: paid activation, unpaid ignored, async
       payment success, calendar-month expiry (incl. end-of-month clamp),
       event replay idempotency
     · legacy subscription events still work and cannot clobber a newer
       one-time purchase
     · Supabase token middleware (requireUser)
*/

import crypto from 'node:crypto';

// ── Env required by the backend modules at import time ────────────────
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
process.env.JWT_SECRET = 'test-secret';
process.env.ARCGIS_BASE_URL = 'https://example.invalid/arcgis';
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_PRICE_ID = 'price_test_legacy_recurring';
process.env.STRIPE_ONE_TIME_PRICE_ID = 'price_test_one_time';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.PORT = '3999';

const {
  constructWebhookEvent, isConfigured, checkoutPriceId, isOneTimeCheckout, stripeRequest,
} = await import('./backend/src/services/stripeClient.js');
const {
  classifyEvent, createEventHandler, addCalendarMonth, resolveOneTimeExpiry,
  resolvePremiumExpiry, ONE_TIME_STATUS,
} = await import('./backend/src/services/subscriptionEvents.js');
const { createCheckoutSession } = await import('./backend/src/services/stripeClient.js');
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

  c = classifyEvent(ev('checkout.session.completed', {
    mode: 'payment', payment_status: 'paid', client_reference_id: 'u1',
    customer: 'cus_1', payment_intent: 'pi_1',
  }, { created: 1_755_000_000 }));
  ok(c.action === 'one_time_purchase' && c.userId === 'u1', 'paid payment-mode session → one_time_purchase');
  ok(c.customerId === 'cus_1' && c.paymentIntentId === 'pi_1', 'one-time: customer + payment intent captured');
  ok(c.paidAt === 1_755_000_000, 'one-time: payment timestamp captured');

  c = classifyEvent(ev('checkout.session.completed', {
    mode: 'payment', payment_status: 'unpaid', client_reference_id: 'u1',
  }));
  ok(c.action === 'ignore', 'UNPAID payment-mode session → ignore');

  c = classifyEvent(ev('checkout.session.completed', {
    mode: 'payment', payment_status: 'no_payment_required', client_reference_id: 'u1',
  }));
  ok(c.action === 'ignore', 'no_payment_required session → ignore');

  c = classifyEvent(ev('checkout.session.async_payment_succeeded', {
    mode: 'payment', payment_status: 'paid', metadata: { user_id: 'u1' }, customer: 'cus_1',
  }, { created: 1_755_000_000 }));
  ok(c.action === 'one_time_purchase' && c.userId === 'u1', 'async_payment_succeeded (paid) → one_time_purchase');

  c = classifyEvent(ev('checkout.session.async_payment_succeeded', {
    mode: 'payment', payment_status: 'unpaid', metadata: { user_id: 'u1' },
  }));
  ok(c.action === 'ignore', 'async_payment_succeeded but still unpaid → ignore');

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
  const dbStub = {
    upsertSubscription: async (p) => upserts.push(p),
    upsertOneTimePurchase: async (p) => upserts.push(p),
  };
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

/* ── 3b) Calendar-month arithmetic (pure) ───────────────────────────── */

function iso(y, m, d, h = 12) {
  return new Date(Date.UTC(y, m - 1, d, h)).toISOString();
}
function unix(isoStr) { return Math.floor(new Date(isoStr).getTime() / 1000); }

function testCalendarMonth() {
  console.log('\n[3b] Calendar-month expiry');

  // The example from the spec: August 13 → September 13.
  ok(addCalendarMonth(new Date(iso(2026, 8, 13))).toISOString() === iso(2026, 9, 13),
    'Aug 13 → Sep 13');

  ok(addCalendarMonth(new Date(iso(2026, 1, 15))).toISOString() === iso(2026, 2, 15),
    'Jan 15 → Feb 15');

  // End-of-month clamping.
  ok(addCalendarMonth(new Date(iso(2026, 1, 31))).toISOString() === iso(2026, 2, 28),
    'Jan 31 → Feb 28 (non-leap year clamp)');
  ok(addCalendarMonth(new Date(iso(2028, 1, 31))).toISOString() === iso(2028, 2, 29),
    'Jan 31 → Feb 29 (leap year clamp)');
  ok(addCalendarMonth(new Date(iso(2026, 5, 31))).toISOString() === iso(2026, 6, 30),
    'May 31 → Jun 30 (30-day month clamp)');
  ok(addCalendarMonth(new Date(iso(2026, 8, 31))).toISOString() === iso(2026, 9, 30),
    'Aug 31 → Sep 30 (end-of-month clamp)');

  // Year rollover + time-of-day preservation.
  ok(addCalendarMonth(new Date(iso(2026, 12, 13, 9))).toISOString() === iso(2027, 1, 13, 9),
    'Dec 13 → Jan 13 next year, keeps the time of day');

  // resolveOneTimeExpiry works from a Stripe unix-seconds timestamp.
  ok(resolveOneTimeExpiry(unix(iso(2026, 8, 13))) === iso(2026, 9, 13),
    'resolveOneTimeExpiry(Aug 13 unix) → Sep 13');
  ok(resolveOneTimeExpiry(unix(iso(2026, 1, 31))) === iso(2026, 2, 28),
    'resolveOneTimeExpiry(Jan 31 unix) → Feb 28');

  // Missing timestamp → one calendar month from "now".
  const now = new Date(iso(2026, 3, 31));
  ok(resolveOneTimeExpiry(null, now) === iso(2026, 4, 30),
    'missing paid-at falls back to one calendar month from now (Mar 31 → Apr 30)');

  // A one-time grant must never be an already-past date.
  ok(new Date(resolveOneTimeExpiry(unix(new Date().toISOString()))).getTime() > Date.now(),
    'one-time expiry is always in the future');
}

/* ── 3c) One-time €5 purchase through the handler ───────────────────── */

function makeOneTimeDb() {
  const state = { oneTime: [], subs: [], seen: new Set() };
  return {
    state,
    db: {
      upsertOneTimePurchase: async (p) => { state.oneTime.push(p); },
      upsertSubscription: async (p) => { state.subs.push(p); },
      findUserByCustomerId: async (cus) => (cus === 'cus_known' ? 'u_known' : null),
      markEventProcessed: async (id) => {
        if (!id) return true;
        if (state.seen.has(id)) return false;
        state.seen.add(id);
        return true;
      },
      unmarkEventProcessed: async (id) => { state.seen.delete(id); },
    },
  };
}

const stripeNoop = {
  retrieveSubscription: async () => { throw new Error('should not be called'); },
  retrieveCustomer: async () => ({ metadata: {} }),
};

async function testOneTimePurchase() {
  console.log('\n[3c] One-time €5 purchase → Premium for one calendar month');

  const paidAt = unix(iso(2026, 8, 13));

  // — paid session activates Premium for one calendar month
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    const out = await handler(ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'paid', client_reference_id: 'u1',
      customer: 'cus_1', payment_intent: 'pi_1',
    }, { id: 'evt_paid_1', created: paidAt }));

    ok(out.handled && out.action === 'one_time_purchase', 'paid session → handled as one_time_purchase');
    ok(state.oneTime.length === 1 && state.subs.length === 0, 'writes via the one-time path only');
    ok(state.oneTime[0].userId === 'u1', 'grants to the Supabase user from client_reference_id');
    ok(state.oneTime[0].expiresAt === iso(2026, 9, 13), 'expiry is one calendar month later (Aug 13 → Sep 13)');
    ok(state.oneTime[0].customerId === 'cus_1', 'stripe_customer_id stored when available');
  }

  // — user id resolved from session metadata
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    await handler(ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'paid', metadata: { user_id: 'u_meta' }, customer: 'cus_1',
    }, { id: 'evt_meta', created: paidAt }));
    ok(state.oneTime[0] && state.oneTime[0].userId === 'u_meta', 'user id read from session metadata');
  }

  // — UNPAID sessions grant nothing
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    const out = await handler(ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'unpaid', client_reference_id: 'u1', customer: 'cus_1',
    }, { id: 'evt_unpaid', created: paidAt }));
    ok(!out.handled, 'unpaid checkout session is not handled');
    ok(state.oneTime.length === 0 && state.subs.length === 0, 'unpaid checkout session writes NOTHING');
  }

  // — async payment success (delayed payment methods)
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    const out = await handler(ev('checkout.session.async_payment_succeeded', {
      mode: 'payment', payment_status: 'paid', client_reference_id: 'u2', customer: 'cus_2',
    }, { id: 'evt_async', created: unix(iso(2026, 1, 31)) }));
    ok(out.handled && out.action === 'one_time_purchase', 'async_payment_succeeded activates Premium');
    ok(state.oneTime[0].userId === 'u2', 'async payment grants to the right user');
    ok(state.oneTime[0].expiresAt === iso(2026, 2, 28), 'async payment: end-of-month clamp (Jan 31 → Feb 28)');
  }

  // — the unpaid → async-paid sequence for one purchase grants exactly once
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    await handler(ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'unpaid', client_reference_id: 'u3', customer: 'cus_3',
    }, { id: 'evt_seq_1', created: paidAt }));
    await handler(ev('checkout.session.async_payment_succeeded', {
      mode: 'payment', payment_status: 'paid', client_reference_id: 'u3', customer: 'cus_3',
    }, { id: 'evt_seq_2', created: paidAt }));
    ok(state.oneTime.length === 1, 'unpaid-then-paid sequence grants exactly one month');
  }

  // — replaying the SAME event id must not extend access twice
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    const payload = ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'paid', client_reference_id: 'u1', customer: 'cus_1',
    }, { id: 'evt_replay', created: paidAt });

    const first = await handler(payload);
    const second = await handler(payload);
    const third = await handler(payload);

    ok(first.handled, 'first delivery of the event is processed');
    ok(!second.handled && second.duplicate === true, 'replayed event is reported as a duplicate');
    ok(!third.handled, 'second replay is also skipped');
    ok(state.oneTime.length === 1, 'replaying an event never extends access more than once');
  }

  // — no resolvable user → nothing written
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    const out = await handler(ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'paid', customer: 'cus_unknown',
    }, { id: 'evt_nouser', created: paidAt }));
    ok(!out.handled && out.reason === 'no-user-id', 'unresolvable user → skipped');
    ok(state.oneTime.length === 0, 'unresolvable user → no DB write');
  }

  // — a failed DB write releases the claim so Stripe's retry still works
  {
    const { state, db } = makeOneTimeDb();
    let failNext = true;
    db.upsertOneTimePurchase = async (p) => {
      if (failNext) { failNext = false; throw new Error('transient DB error'); }
      state.oneTime.push(p);
    };
    const handler = createEventHandler({ stripe: stripeNoop, db });
    const payload = ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'paid', client_reference_id: 'u1', customer: 'cus_1',
    }, { id: 'evt_retry', created: paidAt });

    let threw = false;
    try { await handler(payload); } catch (e) { threw = true; }
    ok(threw, 'a failing DB write propagates (Stripe will retry)');

    const retry = await handler(payload);
    ok(retry.handled && state.oneTime.length === 1, 'Stripe retry after a failed write still grants the month');
  }

  // — user recovered from an existing profile by customer id
  {
    const { state, db } = makeOneTimeDb();
    const handler = createEventHandler({ stripe: stripeNoop, db });
    await handler(ev('checkout.session.completed', {
      mode: 'payment', payment_status: 'paid', customer: 'cus_known',
    }, { id: 'evt_bycustomer', created: paidAt }));
    ok(state.oneTime[0] && state.oneTime[0].userId === 'u_known', 'user resolved via stripe_customer_id lookup');
  }
}

/* ── 3d) Legacy subscription events still work ──────────────────────── */

async function testLegacyStillWorks() {
  console.log('\n[3d] Legacy subscription compatibility');

  const stripeStub = {
    retrieveSubscription: async (id) => ({
      id, status: 'active', current_period_end: 1_800_000_000, metadata: { user_id: 'u1' },
    }),
    retrieveCustomer: async () => ({ metadata: { user_id: 'u1' } }),
  };

  const { state, db } = makeOneTimeDb();
  const handler = createEventHandler({ stripe: stripeStub, db });

  let out = await handler(ev('checkout.session.completed', {
    mode: 'subscription', client_reference_id: 'u1', subscription: 'sub_1', customer: 'cus_1',
  }, { id: 'evt_legacy_activate' }));
  ok(out.handled && out.action === 'activate', 'legacy subscription checkout still activates');
  ok(state.subs.length === 1 && state.oneTime.length === 0, 'legacy checkout uses the subscription path');

  out = await handler(ev('invoice.paid', { subscription: 'sub_1', customer: 'cus_1' }, { id: 'evt_legacy_renew' }));
  ok(out.handled && out.action === 'renew', 'legacy invoice.paid still renews');

  out = await handler(ev('customer.subscription.deleted', {
    id: 'sub_1', metadata: { user_id: 'u1' },
  }, { id: 'evt_legacy_revoke' }));
  ok(out.handled && out.action === 'revoke', 'legacy subscription.deleted still revokes');

  // A replayed legacy renewal must not extend twice either.
  const renewCountBefore = state.subs.length;
  await handler(ev('invoice.paid', { subscription: 'sub_1', customer: 'cus_1' }, { id: 'evt_legacy_renew' }));
  ok(state.subs.length === renewCountBefore, 'replayed legacy renewal is deduplicated too');

  ok(ONE_TIME_STATUS === 'one_time_paid', 'one-time purchases use a distinguishable status');
}

/* ── 3e) Checkout Session creation (payment mode) ───────────────────── */

async function testCheckoutSessionParams() {
  console.log('\n[3e] Stripe Checkout Session creation');

  ok(checkoutPriceId() === 'price_test_one_time', 'STRIPE_ONE_TIME_PRICE_ID is preferred for new checkouts');
  ok(isOneTimeCheckout() === true, 'one-time checkout mode detected');

  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), body: new URLSearchParams(init.body) };
    return { ok: true, status: 200, json: async () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) };
  };

  await createCheckoutSession({
    priceId: checkoutPriceId(),
    email: 'a@b.ro',
    userId: 'user-uuid-1',
    successUrl: 'https://x/checkout.html?payment=success',
    cancelUrl: 'https://x/checkout.html?payment=cancelled',
  });
  globalThis.fetch = realFetch;

  const b = captured.body;
  ok(captured.url.endsWith('/checkout/sessions'), 'posts to /v1/checkout/sessions');
  ok(b.get('mode') === 'payment', 'Checkout mode is "payment", not "subscription"');
  ok(b.get('line_items[0][price]') === 'price_test_one_time', 'uses the one-time price id');
  ok(b.get('client_reference_id') === 'user-uuid-1', 'Supabase user id in client_reference_id');
  ok(b.get('metadata[user_id]') === 'user-uuid-1', 'Supabase user id in session metadata');
  ok(b.get('payment_intent_data[metadata][user_id]') === 'user-uuid-1', 'Supabase user id in PaymentIntent metadata');
  ok(b.get('subscription_data[metadata][user_id]') === null, 'no subscription_data parameters are sent');

  // Legacy path is still reachable for existing subscribers.
  let legacyBody = null;
  globalThis.fetch = async (url, init) => {
    legacyBody = new URLSearchParams(init.body);
    return { ok: true, status: 200, json: async () => ({ id: 'cs_2' }) };
  };
  await createCheckoutSession({
    priceId: 'price_test_legacy_recurring', email: 'a@b.ro', userId: 'user-uuid-1',
    successUrl: 's', cancelUrl: 'c', mode: 'subscription',
  });
  globalThis.fetch = realFetch;
  ok(legacyBody.get('mode') === 'subscription', 'legacy subscription mode still available');
  ok(legacyBody.get('subscription_data[metadata][user_id]') === 'user-uuid-1', 'legacy mode keeps subscription metadata');
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
testCalendarMonth();
await testOneTimePurchase();
await testLegacyStillWorks();
await testCheckoutSessionParams();
await testMiddleware();

console.log('\n────────────────────────────────────────');
console.log(`passed: ${passed}   failed: ${failed}`);
process.exit(failed ? 1 : 0);
