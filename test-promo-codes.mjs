/* Smoke tests for promo-code redemption (no network / no DB).
   Run:  node test-promo-codes.mjs   (from repo root)

   Covers:
     · normalizeCode() input hardening
     · resolvePromoExpiry() (trial vs. stacked bonus, bad durations)
     · evaluateRedemption() decision table — every error code + order
     · redeemWithClient() against a stubbed transaction client:
       happy path, unique-constraint race, refusals write nothing
     · the promo status is excluded from the billing-portal check
*/

// ── Env required by the backend modules at import time ────────────────
process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
process.env.JWT_SECRET = 'test-secret';
process.env.ARCGIS_BASE_URL = 'https://example.invalid/arcgis';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.PORT = '3998';

const {
  normalizeCode, resolvePromoExpiry, evaluateRedemption, redeemWithClient,
  PROMO_STATUS, TRIAL_KIND,
} = await import('./backend/src/services/promoCodes.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ FAIL: ' + name); }
}

const NOW = new Date('2026-08-14T12:00:00.000Z');
const HOUR = 3600 * 1000;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

/** A valid, wide-open 24h trial code. */
function trialCode(over) {
  return Object.assign({
    code: 'TRIAL24',
    kind: 'trial',
    duration_hours: 24,
    starts_at: null,
    expires_at: at(30 * 24 * HOUR),
    max_redemptions: null,
    redeemed_count: 0,
    active: true,
  }, over || {});
}

/* ── 1) normalizeCode ──────────────────────────────────────────────── */

function testNormalize() {
  console.log('\n[1] normalizeCode()');

  ok(normalizeCode('TRIAL24') === 'TRIAL24', 'canonical code passes through');
  ok(normalizeCode('  trial24  ') === 'TRIAL24', 'trims + uppercases');
  ok(normalizeCode('trial 24') === 'TRIAL24', 'strips inner whitespace');
  ok(normalizeCode('TRIAL\t\n24') === 'TRIAL24', 'strips tabs/newlines');
  ok(normalizeCode('free-trial_24') === 'FREE-TRIAL_24', 'keeps - and _');
  ok(normalizeCode("TRIAL'; drop table--") === 'TRIALDROPTABLE--', 'strips SQL-ish punctuation');
  ok(normalizeCode('trial😀24') === 'TRIAL24', 'strips emoji');

  ok(normalizeCode('') === '', 'empty string → ""');
  ok(normalizeCode('   ') === '', 'whitespace only → ""');
  ok(normalizeCode('!!!') === '', 'punctuation only → ""');
  ok(normalizeCode(null) === '', 'null → ""');
  ok(normalizeCode(undefined) === '', 'undefined → ""');
  ok(normalizeCode(1234) === '', 'number → "" (non-string rejected)');
  ok(normalizeCode({}) === '', 'object → ""');

  ok(normalizeCode('A'.repeat(200)).length === 64, 'clamped to 64 chars');
}

/* ── 2) resolvePromoExpiry ─────────────────────────────────────────── */

function testExpiry() {
  console.log('\n[2] resolvePromoExpiry()');

  ok(
    resolvePromoExpiry({ durationHours: 24, now: NOW }) === at(24 * HOUR),
    '24h from now when nothing to stack on'
  );
  ok(
    resolvePromoExpiry({ durationHours: 1, now: NOW }) === at(HOUR),
    '1h duration honoured'
  );
  ok(
    resolvePromoExpiry({ durationHours: 24 * 30, now: NOW }) === at(30 * 24 * HOUR),
    'long durations honoured'
  );

  // Stacking
  ok(
    resolvePromoExpiry({ durationHours: 24, now: NOW, stackFrom: at(48 * HOUR) }) === at(72 * HOUR),
    'stacks on a future expiry'
  );
  ok(
    resolvePromoExpiry({ durationHours: 24, now: NOW, stackFrom: at(-48 * HOUR) }) === at(24 * HOUR),
    'ignores an already-past expiry'
  );
  ok(
    resolvePromoExpiry({ durationHours: 24, now: NOW, stackFrom: new Date(NOW.getTime() + 48 * HOUR) }) === at(72 * HOUR),
    'accepts a Date as stackFrom'
  );
  ok(
    resolvePromoExpiry({ durationHours: 24, now: NOW, stackFrom: null }) === at(24 * HOUR),
    'null stackFrom → from now'
  );

  // Bad input falls back to 24h rather than producing Invalid Date.
  ok(resolvePromoExpiry({ durationHours: 0, now: NOW }) === at(24 * HOUR), 'duration 0 → 24h fallback');
  ok(resolvePromoExpiry({ durationHours: -5, now: NOW }) === at(24 * HOUR), 'negative duration → 24h fallback');
  ok(resolvePromoExpiry({ durationHours: 'abc', now: NOW }) === at(24 * HOUR), 'NaN duration → 24h fallback');
  ok(
    resolvePromoExpiry({ durationHours: 24, now: NOW, stackFrom: 'not-a-date' }) === at(24 * HOUR),
    'garbage stackFrom ignored'
  );
}

/* ── 3) evaluateRedemption ─────────────────────────────────────────── */

function testEvaluate() {
  console.log('\n[3] evaluateRedemption() decision table');

  const base = { now: NOW, alreadyRedeemed: false, trialUsed: false, currentExpiresAt: null };

  // Happy path
  let v = evaluateRedemption(trialCode(), base);
  ok(v.ok === true, 'valid trial → ok');
  ok(v.durationHours === 24, '  → 24 duration hours reported');
  ok(v.expiresAt === at(24 * HOUR), '  → premium expires in 24h');

  // Unknown / disabled code
  ok(
    evaluateRedemption(null, base).error === 'invalid_code',
    'unknown code → invalid_code'
  );
  ok(evaluateRedemption(null, base).status === 404, '  → 404');
  v = evaluateRedemption(trialCode({ active: false }), base);
  ok(v.error === 'invalid_code' && v.status === 404, 'deactivated code → invalid_code/404');

  // Validity window
  v = evaluateRedemption(trialCode({ starts_at: at(HOUR) }), base);
  ok(v.error === 'code_not_started' && v.status === 409, 'campaign not open yet → code_not_started/409');
  v = evaluateRedemption(trialCode({ starts_at: at(-HOUR) }), base);
  ok(v.ok === true, 'campaign already open → ok');
  v = evaluateRedemption(trialCode({ expires_at: at(-1) }), base);
  ok(v.error === 'code_expired' && v.status === 409, 'campaign over → code_expired/409');
  v = evaluateRedemption(trialCode({ expires_at: NOW.toISOString() }), base);
  ok(v.error === 'code_expired', 'expiry is exclusive (expires_at == now → expired)');
  v = evaluateRedemption(trialCode({ expires_at: null }), base);
  ok(v.ok === true, 'null expires_at → never expires');

  // Global cap
  v = evaluateRedemption(trialCode({ max_redemptions: 100, redeemed_count: 100 }), base);
  ok(v.error === 'code_exhausted' && v.status === 409, 'cap reached → code_exhausted/409');
  v = evaluateRedemption(trialCode({ max_redemptions: 100, redeemed_count: 99 }), base);
  ok(v.ok === true, 'one slot left → ok');
  v = evaluateRedemption(trialCode({ max_redemptions: null, redeemed_count: 9999 }), base);
  ok(v.ok === true, 'null cap → unlimited');

  // Per-account rules
  v = evaluateRedemption(trialCode(), Object.assign({}, base, { alreadyRedeemed: true }));
  ok(v.error === 'already_redeemed' && v.status === 409, 'same code twice → already_redeemed/409');
  v = evaluateRedemption(trialCode(), Object.assign({}, base, { trialUsed: true }));
  ok(v.error === 'trial_already_used' && v.status === 409, 'second trial code → trial_already_used/409');
  v = evaluateRedemption(
    trialCode({ code: 'BONUS7', kind: 'bonus' }),
    Object.assign({}, base, { trialUsed: true })
  );
  ok(v.ok === true, 'bonus code unaffected by a used-up trial');

  // Premium already running
  v = evaluateRedemption(trialCode(), Object.assign({}, base, { currentExpiresAt: at(10 * 24 * HOUR) }));
  ok(v.error === 'already_premium' && v.status === 409, 'trial while premium active → already_premium/409');
  v = evaluateRedemption(trialCode(), Object.assign({}, base, { currentExpiresAt: at(-10 * 24 * HOUR) }));
  ok(v.ok === true, 'expired premium does not block a trial');
  v = evaluateRedemption(
    trialCode({ kind: 'bonus', duration_hours: 24 }),
    Object.assign({}, base, { currentExpiresAt: at(10 * 24 * HOUR) })
  );
  ok(v.ok === true && v.expiresAt === at(11 * 24 * HOUR), 'bonus stacks on active premium (+24h)');

  // Check order: an invalid code wins over per-account state, so we never
  // leak "you already redeemed that" for a code that does not exist.
  v = evaluateRedemption(null, Object.assign({}, base, { alreadyRedeemed: true, trialUsed: true }));
  ok(v.error === 'invalid_code', 'invalid_code checked before account history');
  v = evaluateRedemption(
    trialCode({ expires_at: at(-1) }),
    Object.assign({}, base, { alreadyRedeemed: true })
  );
  ok(v.error === 'code_expired', 'code window checked before already_redeemed');
  v = evaluateRedemption(
    trialCode(),
    Object.assign({}, base, { alreadyRedeemed: true, currentExpiresAt: at(24 * HOUR) })
  );
  ok(v.error === 'already_redeemed', 'already_redeemed checked before already_premium');

  // Defaults for sloppy rows
  v = evaluateRedemption(trialCode({ duration_hours: null }), base);
  ok(v.ok === true && v.durationHours === 24, 'null duration_hours → 24h default');
  v = evaluateRedemption(trialCode({ kind: null }), Object.assign({}, base, { trialUsed: true }));
  ok(v.error === 'trial_already_used', 'null kind treated as a trial');
}

/* ── 4) redeemWithClient() against a stubbed transaction ───────────── */

/**
 * Minimal pg-client stub: answers each query by matching the SQL, and
 * records everything it was asked to run so the test can assert that a
 * refusal wrote nothing.
 */
function makeClient({ codeRow, history, profile, claimConflict } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/from public\.promo_codes/.test(sql) && /for update/.test(sql)) {
        return { rows: codeRow ? [codeRow] : [] };
      }
      if (/from public\.promo_redemptions/.test(sql)) {
        return { rows: [history || { this_code: '0', trials: '0' }] };
      }
      if (/from public\.profiles/.test(sql)) {
        return { rows: profile ? [profile] : [] };
      }
      if (/insert into public\.promo_redemptions/.test(sql)) {
        return { rows: claimConflict ? [] : [{ id: 'red_1' }] };
      }
      if (/update public\.promo_codes/.test(sql)) return { rows: [], rowCount: 1 };
      if (/insert into public\.profiles/.test(sql)) return { rows: [], rowCount: 1 };
      throw new Error('unexpected query: ' + sql);
    },
  };
}

const wrote = (client, re) => client.calls.some((c) => re.test(c.sql));

async function testRedeem() {
  console.log('\n[4] redeemWithClient()');

  // Happy path
  let client = makeClient({ codeRow: trialCode() });
  let out = await redeemWithClient(client, { userId: 'u1', code: ' trial24 ', now: NOW });
  ok(out.ok === true, 'valid trial → ok');
  ok(out.code === 'TRIAL24', '  → returns the normalised code');
  ok(out.expiresAt === at(24 * HOUR), '  → grants 24h of premium');
  ok(out.durationHours === 24, '  → reports the duration');
  ok(wrote(client, /insert into public\.promo_redemptions/), '  → logs the redemption');
  ok(wrote(client, /update public\.promo_codes/), '  → bumps redeemed_count');
  ok(wrote(client, /insert into public\.profiles/), '  → writes the profile grant');

  const grant = client.calls.find((c) => /insert into public\.profiles/.test(c.sql));
  ok(grant.params[1] === at(24 * HOUR), '  → profile expiry = grant expiry');
  ok(grant.params[2] === PROMO_STATUS, `  → status set to ${PROMO_STATUS}`);
  ok(/greatest\(/.test(grant.sql), '  → uses greatest() so it never shortens premium');
  ok(/for update/.test(client.calls[0].sql), '  → locks the code row first');

  const claim = client.calls.find((c) => /insert into public\.promo_redemptions/.test(c.sql));
  ok(/on conflict \(code, user_id\) do nothing/.test(claim.sql), '  → claim is conflict-safe');
  ok(claim.params[2] === TRIAL_KIND, '  → records the code kind');

  // Empty / malformed input never touches the DB
  client = makeClient({ codeRow: trialCode() });
  out = await redeemWithClient(client, { userId: 'u1', code: '   ', now: NOW });
  ok(out.ok === false && out.error === 'invalid_code' && out.status === 400, 'blank code → invalid_code/400');
  ok(client.calls.length === 0, '  → no queries issued at all');

  // Unknown code
  client = makeClient({ codeRow: null });
  out = await redeemWithClient(client, { userId: 'u1', code: 'NOPE', now: NOW });
  ok(out.error === 'invalid_code' && out.status === 404, 'unknown code → invalid_code/404');
  ok(!wrote(client, /insert into/), '  → nothing written');

  // Already redeemed this code
  client = makeClient({ codeRow: trialCode(), history: { this_code: '1', trials: '1' } });
  out = await redeemWithClient(client, { userId: 'u1', code: 'TRIAL24', now: NOW });
  ok(out.error === 'already_redeemed', 'second redemption → already_redeemed');
  ok(!wrote(client, /insert into/), '  → nothing written');

  // Used a different trial code already
  client = makeClient({ codeRow: trialCode({ code: 'TRIALX' }), history: { this_code: '0', trials: '1' } });
  out = await redeemWithClient(client, { userId: 'u1', code: 'TRIALX', now: NOW });
  ok(out.error === 'trial_already_used', 'a second trial campaign → trial_already_used');
  ok(!wrote(client, /insert into public\.profiles/), '  → premium not granted');

  // Premium still active
  client = makeClient({ codeRow: trialCode(), profile: { premium_expires_at: at(5 * 24 * HOUR) } });
  out = await redeemWithClient(client, { userId: 'u1', code: 'TRIAL24', now: NOW });
  ok(out.error === 'already_premium', 'active premium → already_premium');
  ok(!wrote(client, /update public\.promo_codes/), '  → redeemed_count untouched');

  // Expired premium is fine
  client = makeClient({ codeRow: trialCode(), profile: { premium_expires_at: at(-5 * 24 * HOUR) } });
  out = await redeemWithClient(client, { userId: 'u1', code: 'TRIAL24', now: NOW });
  ok(out.ok === true, 'lapsed premium → trial allowed');

  // Race: two requests slipped past the checks, UNIQUE caught the second.
  client = makeClient({ codeRow: trialCode(), claimConflict: true });
  out = await redeemWithClient(client, { userId: 'u1', code: 'TRIAL24', now: NOW });
  ok(out.error === 'already_redeemed' && out.status === 409, 'unique-constraint race → already_redeemed/409');
  ok(!wrote(client, /insert into public\.profiles/), '  → premium not granted twice');
  ok(!wrote(client, /update public\.promo_codes/), '  → redeemed_count not double-counted');

  // Exhausted campaign
  client = makeClient({ codeRow: trialCode({ max_redemptions: 5, redeemed_count: 5 }) });
  out = await redeemWithClient(client, { userId: 'u1', code: 'TRIAL24', now: NOW });
  ok(out.error === 'code_exhausted', 'cap reached → code_exhausted');
  ok(!wrote(client, /insert into/), '  → nothing written');

  // Bonus code stacks on live premium
  client = makeClient({
    codeRow: trialCode({ code: 'BONUS7', kind: 'bonus', duration_hours: 168 }),
    profile: { premium_expires_at: at(24 * HOUR) },
  });
  out = await redeemWithClient(client, { userId: 'u1', code: 'BONUS7', now: NOW });
  ok(out.ok === true && out.expiresAt === at(8 * 24 * HOUR), 'bonus stacks: 1 day left + 7 days = 8 days');
}

/* ── 5) Promo grants are not Stripe subscriptions ──────────────────── */

async function testNotASubscription() {
  console.log('\n[5] Promo premium is not a manageable subscription');

  const src = await import('node:fs').then((fs) =>
    fs.promises.readFile(new URL('./backend/src/routes/payments.js', import.meta.url), 'utf8')
  );
  ok(/PROMO_STATUS/.test(src), '/payments/portal excludes PROMO_STATUS');

  const front = await import('node:fs').then((fs) =>
    fs.promises.readFile(new URL('./js/subscriptions.js', import.meta.url), 'utf8')
  );
  ok(/promo_trial/.test(front), 'frontend knows the promo_trial status');
  ok(
    /NON_SUBSCRIPTION_STATUSES/.test(front),
    'isLegacySubscriber() checks a list that includes promo_trial'
  );
}

await testNormalize();
testExpiry();
testEvaluate();
await testRedeem();
await testNotASubscription();

console.log('\n────────────────────────────────────────');
console.log(`passed: ${passed}   failed: ${failed}`);
process.exit(failed ? 1 : 0);
