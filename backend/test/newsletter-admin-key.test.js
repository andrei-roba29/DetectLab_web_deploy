import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

/*
 * Regression tests for the newsletter admin key gate — the bug that made the
 * production admin page unusable: the backend answered
 * `403 Admin key required (x-admin-key)` while the user had (apparently) the
 * exact same value in Railway and in the page, and had no console on a phone
 * to figure out which side disagreed.
 *
 * The contract being pinned here:
 *   · the key is accepted from the `x-admin-key` / `x-ingestion-key` header AND
 *     from `?admin_key=` / `?key=` / `?x_admin_key=` (no-console fallback);
 *   · any configured admin key unlocks it (INGESTION_ADMIN_KEY,
 *     NEWSLETTER_ADMIN_KEY, ADMIN_KEY, ADMINKEY) — previously
 *     INGESTION_ADMIN_KEY silently shadowed NEWSLETTER_ADMIN_KEY;
 *   · both sides are trimmed of stray whitespace/quotes, because a pasted
 *     trailing space is the classic invisible mismatch;
 *   · no key configured at all ⇒ authenticated users pass (dev/demo);
 *   · every 403 (and GET /debug) explains itself without leaking the key.
 *
 * Each scenario runs in its own process, because config/env.js reads
 * process.env once at import time.
 */

const backendRoot = new URL('..', import.meta.url);

function runScenario(name, vars) {
  const key = vars.NEWSLETTER_TEST_EXPECTED_KEY || 'secret';
  let out;
  try {
    out = execFileSync(
      process.execPath,
      ['test/newsletter-admin-key-harness.mjs'],
      {
        cwd: backendRoot,
        encoding: 'utf8',
        timeout: 30000,
        // Only what the config layer needs + the scenario's admin key vars.
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'test',
          LOG_LEVEL: 'silent',
          DATABASE_URL: 'postgresql://detectlab:detectlab@localhost:5432/detectlab',
          JWT_SECRET: 'test-secret',
          ARCGIS_BASE_URL: 'https://example.invalid/MapServer',
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_ANON_KEY: 'test-anon-key',
          ...vars,
        },
      },
    );
  } catch (err) {
    assert.fail(`${name}: the harness died — ${err.stderr || err.message}`);
  }
  try {
    return { key, ...JSON.parse(out) };
  } catch (err) {
    assert.fail(`${name}: the harness printed non-JSON (${err.message}): ${out}`);
  }
}

function assertSharedContract(label, { key, requests, env, forbiddenShape }) {
  const configured = env.configuredKeys.length > 0;
  const status = (r) => r.status;

  // The header and the query param must never disagree — that is the whole
  // point of the no-console fallback.
  assert.equal(
    status(requests.headerGood),
    status(requests.queryAdminKey),
    `${label}: header and ?admin_key= answers must match (${status(requests.headerGood)} vs ${status(requests.queryAdminKey)})`,
  );
  assert.equal(requests.queryKey.status, requests.queryAdminKey.status, `${label}: ?key= behaves like ?admin_key=`);
  assert.equal(requests.queryXAdminKey.status, requests.queryAdminKey.status, `${label}: ?x_admin_key= too`);
  assert.equal(requests.queryArray.status, requests.queryAdminKey.status, `${label}: a repeated query key uses the first value`);
  assert.equal(requests.headerIngestion.status, requests.headerGood.status, `${label}: x-ingestion-key is an alias`);
  assert.equal(requests.campaignsQueryKey.status, requests.queryAdminKey.status, `${label}: other admin routes honour the query key`);

  if (configured) {
    assert.equal(requests.headerGood.status, 200, `${label}: the configured key passes`);
    assert.equal(requests.headerPadded.status, 200, `${label}: surrounding whitespace is ignored`);
    assert.equal(requests.headerQuoted.status, 200, `${label}: wrapping quotes are ignored`);
    assert.equal(requests.queryBad.status, 403, `${label}: a wrong key is refused`);
    assert.equal(requests.sendFirstHeaderBad.status, 403, `${label}: send-first is gated too`);
    assert.equal(requests.sendFirstQueryGood.status, 200, `${label}: send-first works with the query key`);
    assert.equal(requests.headerMissing.status, 403, `${label}: no key at all is refused`);
    assert.equal(requests.debugNoKey.body.adminKeyConfigured, true, `${label}: debug reports a configured key`);
    assert.equal(requests.debugNoKey.body.isAdmin, false, `${label}: debug says "you sent nothing"`);
    assert.equal(requests.debugNoKey.body.providedKeyLength, 0, `${label}: zero key length`);
    assert.equal(requests.debugWithKey.body.isAdmin, true, `${label}: debug validates the typed key`);
    assert.equal(requests.debugWithKey.body.providedKeyLength, key.length, `${label}: length only, never the key`);
    assert.equal(requests.debugWithBadKey.body.isAdmin, false, `${label}: a wrong key is reported as such`);
    assert.equal(requests.health.body.adminKeyConfigured, true, `${label}: health exposes the gate state`);
    assert.ok(
      requests.headerBad.body.debug?.lengthMatchesConfigured === false || requests.headerBad.body.debug?.lengthMatchesConfigured === true,
      `${label}: mismatch diagnosis is answered with a real boolean`,
    );
  } else {
    for (const [name, r] of Object.entries(requests)) {
      assert.notEqual(r.status, 403, `${label}: with no key configured nothing is refused (${name} → ${r.status})`);
    }
    assert.equal(requests.debugNoKey.body.adminKeyConfigured, false, `${label}: debug says no key is configured`);
    assert.equal(requests.debugNoKey.body.isAdmin, true, `${label}: and that any caller passes`);
    assert.equal(requests.health.body.adminKeyConfigured, false, `${label}: health agrees`);
  }

  // The answers must be explainable without a console…
  const forbidden = requests.headerMissing.body;
  if (configured) {
    assert.equal(forbidden.error, 'admin_key_required', `${label}: a missing key has its own error code`);
    assert.equal(requests.headerBad.body.error, 'admin_key_mismatch', `${label}: a wrong key is distinguishable`);
    for (const field of ['message', 'hint']) {
      assert.ok(typeof forbidden[field] === 'string' && forbidden[field].length > 20, `${label}: 403 carries a human ${field}`);
    }
    for (const field of ['hasConfiguredKey', 'providedKeyLength', 'receivedVia']) {
      assert.ok(field in forbidden.debug, `${label}: 403 debug includes ${field}`);
    }
    assert.equal(forbidden.debug.receivedVia, 'none', `${label}: and says where the key came from`);
  }
  // …without ever echoing the secret itself.
  const wire = JSON.stringify({ requests, forbiddenShape });
  for (const secret of env.configuredKeys) {
    assert.ok(!wire.includes(secret), `${label}: responses never contain the admin key`);
  }
}

test('NEWSLETTER_ADMIN_KEY gates the admin endpoints and is diagnosable without a console', () => {
  const t = runScenario('newsletter-key', { NEWSLETTER_ADMIN_KEY: 'secret' });
  assertSharedContract('NEWSLETTER_ADMIN_KEY', t);
  assert.deepEqual(t.env.sources, ['NEWSLETTER_ADMIN_KEY'], 'debug names the env var that is set');
  assert.ok(t.forbiddenShape.debugKeys.includes('lengthMatchesConfigured'), 'the length hint is part of the 403 payload');
});

test('no admin key configured ⇒ any authenticated user may list and send (dev/demo)', () => {
  const t = runScenario('no-key', { NEWSLETTER_TEST_EXPECTED_KEY: 'anything-goes' });
  assertSharedContract('dev/demo', t);
  assert.deepEqual(t.env.configuredKeys, [], 'nothing is configured');
});

test('INGESTION_ADMIN_KEY alone still guards the newsletter endpoints', () => {
  const t = runScenario('ingestion-key', {
    INGESTION_ADMIN_KEY: 'ingest-key',
    NEWSLETTER_TEST_EXPECTED_KEY: 'ingest-key',
  });
  assertSharedContract('INGESTION_ADMIN_KEY', t);
  assert.deepEqual(t.env.sources, ['INGESTION_ADMIN_KEY']);
});

test('both keys set: the newsletter key works even though INGESTION_ADMIN_KEY exists', () => {
  // The production shape that broke: INGESTION_ADMIN_KEY shadowed
  // NEWSLETTER_ADMIN_KEY, so the key the user typed was never the one checked.
  const t = runScenario('both-keys', {
    INGESTION_ADMIN_KEY: 'other-secret',
    NEWSLETTER_ADMIN_KEY: 'secret',
  });
  assertSharedContract('both keys', t);
  assert.deepEqual(t.env.configuredKeys, ['other-secret', 'secret'], 'both are accepted');
  assert.deepEqual(t.env.sources, ['INGESTION_ADMIN_KEY', 'NEWSLETTER_ADMIN_KEY'], 'debug lists both variables');
});

test('ADMIN_KEY / ADMINKEY aliases are honoured', () => {
  const alias = runScenario('alias', { ADMIN_KEY: 'alias-key', NEWSLETTER_TEST_EXPECTED_KEY: 'alias-key' });
  assertSharedContract('ADMIN_KEY', alias);
  const legacy = runScenario('legacy-alias', { ADMINKEY: 'legacy-key', NEWSLETTER_TEST_EXPECTED_KEY: 'legacy-key' });
  assertSharedContract('ADMINKEY', legacy);
});

test('a Railway value pasted with spaces or quotes still matches', () => {
  const t = runScenario('padded-server-value', { NEWSLETTER_ADMIN_KEY: '  secret  ' });
  assertSharedContract('padded server value', t);
  assert.deepEqual(t.env.configuredKeys, ['secret'], 'the configured key is normalized too');
});
