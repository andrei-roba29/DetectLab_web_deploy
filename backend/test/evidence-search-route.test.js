import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * Functional regression tests for POST /api/evidence/search — the request that
 * answered every "Biblioteca din Babel" search with `500 Internal server error`.
 *
 * The route is driven directly (express router stack) against a stubbed pg
 * pool, so the whole identification → cache → error-mapping contract is
 * exercised without a database. The lookup SQL itself is validated against
 * PostgreSQL's rules in evidence-sql.test.js.
 */

// The config layer refuses to load without a complete environment; the stubbed
// pool means no connection is ever attempted.
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://detectlab:detectlab@localhost:5432/detectlab',
  JWT_SECRET: 'test-secret',
  ARCGIS_BASE_URL: 'https://example.invalid/MapServer',
  EVIDENCE_RESEARCH_BUDGET_MS: '15000',
  EVIDENCE_DEBUG: 'true',
  BIBLIOTECA_REQUEST_INTERVAL_MS: '0', BIBLIOTECA_RETRY_BACKOFF_MS: '5',
});

const { pool } = await import('../src/config/db.js');
const { default: evidenceRouter } = await import('../src/routes/evidence.js');

const localityRow = (over = {}) => ({
  id: 4242, siruta_code: '123456', name: 'APAHIDA', normalized_name: 'apahida', county_code: '12', county: 'CLUJ',
  uat_name: 'APAHIDA', locality_type: 'comuna', level: 3, latitude: null, longitude: null, source_name: 'INS SIRUTA',
  source_version: 'S1 2025', source_url: 'https://data.gov.ro/', pilot: false, aliases: [], ...over,
});

let queries = [];
function stubPool(handler) {
  queries = [];
  pool.query = async (sql, params) => { queries.push({ sql: String(sql), params }); return handler(String(sql), params); };
}

function invoke(body) {
  const route = evidenceRouter.stack.find((entry) => entry.route?.path === '/evidence/search' && entry.route.methods.post).route;
  const handler = route.stack[route.stack.length - 1].handle;
  const res = {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
  return handler({ body, get: () => undefined }, res, (error) => { res.thrown = error; }).then(() => res);
}

test('a searched locality is identified with PostgreSQL-legal SQL and served from the persistent cache', async () => {
  stubPool((sql) => {
    if (/FROM \(\s*SELECT DISTINCT/.test(sql)) return { rows: [localityRow({ ingestion_status: 'PROCESSED' })] };
    if (/FROM knowledge.localities l\b/.test(sql)) return { rows: [localityRow({ ingestion_status: 'PROCESSED' })] };
    return { rows: [] };
  });
  const res = await invoke({ locality: 'Apahida', county: 'Cluj' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.headers['X-DetectLab-Storage'], 'persistent-cache');
  assert.equal(res.body.locality.currentName, 'APAHIDA');
  assert.ok(res.body.dossier, 'the historical dossier is embedded in the search answer');
  const lookup = queries[0].sql;
  assert.match(lookup, /SELECT DISTINCT l\.\*, \(l\.normalized_name=\$1\) AS exact_match/, 'the exact-name rank is projected');
  assert.match(lookup, /\) m ORDER BY m\.exact_match DESC, m\.id/, 'and the outer level sorts on projected columns');
  assert.doesNotMatch(lookup, /DISTINCT[\s\S]*ORDER BY CASE/, 'the rejected `DISTINCT … ORDER BY CASE` shape is gone');
  assert.deepEqual(queries[0].params, ['apahida', 'Cluj'], 'name and county stay bound parameters');
});

test('an unknown locality is a 404, never a 500', async () => {
  stubPool(() => ({ rows: [] }));
  const res = await invoke({ locality: 'Nicăieri' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'locality_not_found');
  assert.match(res.body.message, /SIRUTA/);
});

test('homonyms are answered with the §1 picker payload', async () => {
  stubPool(() => ({ rows: [localityRow({ id: 1, name: 'DAISON' }), localityRow({ id: 2, name: 'DAISON', county: 'MUREȘ' })] }));
  const res = await invoke({ locality: 'Daidea' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'ambiguous_locality');
  assert.deepEqual(res.body.matches.map((m) => m.id), [1, 2], 'the user picks the exact SIRUTA row');
});

test('an un-migrated or broken database is named instead of hiding behind a 500', async () => {
  // Exactly the failure that produced the report: PostgreSQL rejected the query.
  stubPool(() => { throw Object.assign(new Error('for SELECT DISTINCT, ORDER BY expressions must appear in select list'), { code: '0A000' }); });
  const res = await invoke({ locality: 'Apahida' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'database_query_rejected');
  assert.equal(res.body.sqlState, '0A000');
  assert.match(res.body.detail, /SELECT DISTINCT/, 'EVIDENCE_DEBUG surfaces the cause');
  assert.ok(res.body.requestId, 'a request id ties the answer to the server log');

  // A missing relation (fresh deploy without migration 007) is the same story.
  stubPool(() => { throw Object.assign(new Error('relation "knowledge.localities" does not exist'), { code: '42P01', relation: 'knowledge.localities' }); });
  const missing = await invoke({ locality: 'Apahida' });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.error, 'database_schema_outdated');

  // A dropped connection is a 503 the user can act on, not a mystery 500.
  stubPool(() => { throw Object.assign(new Error('connection terminated unexpectedly'), { code: '57P01' }); });
  const dropped = await invoke({ locality: 'Apahida' });
  assert.equal(dropped.statusCode, 503);
  assert.equal(dropped.body.error, 'database_unreachable');

  // A constraint the knowledge schema legitimately enforces is its own code.
  stubPool(() => { throw Object.assign(new Error('duplicate key value violates unique constraint "documents_metadata_hash_key"'), { code: '23505' }); });
  const violated = await invoke({ locality: 'Apahida' });
  assert.equal(violated.body.error, 'storage_write_failed');
  assert.ok(violated.body.message.includes(violated.body.requestId), 'the message quotes the request id it echoes');

  // Anything else is a bug: logged, and answered with a request id.
  stubPool(() => { throw new TypeError("Cannot read properties of undefined (reading 'id')"); });
  const broken = await invoke({ locality: 'Apahida' });
  assert.equal(broken.statusCode, 500);
  assert.equal(broken.body.error, 'search_failed');
  assert.ok(broken.body.requestId && broken.body.requestId !== 'undefined');
  assert.equal(broken.thrown, undefined, 'the error is never handed to the generic Express handler');
});

// ── the live research path, with the publication source stubbed out ──────
const searchHtml = `<table>
<tr><td></td><td>articol de periodic</td><td>1971</td><td>Acta Musei Napocensis</td><td>CRIȘAN</td><td><a href="?articol=104119-necropola-celtica-de-la-apahida">Necropola celtică de la Apahida</a></td><td></td><td>37-70</td><td>română</td></tr>
</table>`;
const articleHtml = `<h2>Necropola celtică de la Apahida</h2><ul>
<li><strong>Subiect:</strong> În necropola celtică de la Apahida au fost descoperite morminte de incinerație.</li>
<li><strong>Paginaţia:</strong> 37-70</li><li><strong>Anul publicaţiei:</strong> 1971</li>
<li><strong>Descriptori:</strong> <a href="?descriptor=321">Apahida (loc geografic)</a></li></ul>`;

function htmlResponse(url, status, body) {
  return { ok: status < 300, status, url: String(url), headers: { get: () => null }, arrayBuffer: async () => new Uint8Array(Buffer.from(body)).buffer };
}

function stubResearchRows(status) {
  const writes = [];
  const client = { query: async (sql, params) => { writes.push({ sql: String(sql), params }); return { rows: [{ id: 77, inserted: true }], rowCount: 1 }; }, release() {} };
  pool.connect = async () => client;
  pool.query = async (sql, params) => {
    writes.push({ sql: String(sql), params });
    const text = String(sql);
    if (/FROM \(\s*SELECT DISTINCT/.test(text)) return { rows: [localityRow({ ingestion_status: 'PENDING' })] };
    if (/FROM knowledge.localities l\b/.test(text)) return { rows: [localityRow({ ingestion_status: status })] };
    // The read side of the persistent store: the answer the user receives is the
    // bundle rebuilt from rows, exactly as in production.
    if (/FROM knowledge\.documents d/.test(text)) return { rows: [{ id: 77, title: 'Necropola celtică de la Apahida', authors: ['CRIȘAN ION, Horațiu'], publication: 'Acta Musei Napocensis', publication_year: 1971, processing_status: 'PROCESSED', catalog_url: 'https://biblioteca-digitala.ro/?articol=104119', document_url: 'https://biblioteca-digitala.ro/reviste/x.pdf' }] };
    if (/FROM knowledge\.evidence e/.test(text)) return { rows: [{ id: 5, claim_id: 77, excerpt: 'În necropola celtică de la Apahida au fost descoperite morminte de incinerație.', context_excerpt: 'În necropola celtică de la Apahida au fost descoperite morminte de incinerație.', extraction_method: 'ABSTRACT', confidence: '0.900', source_url: 'https://biblioteca-digitala.ro/?articol=104119', pdf_page: 5, printed_page: '37', title: 'Necropola celtică de la Apahida', authors: ['CRIȘAN ION, Horațiu'], publication: 'Acta Musei Napocensis', publication_year: 1971, catalog_url: 'https://biblioteca-digitala.ro/?articol=104119', document_url: 'https://biblioteca-digitala.ro/reviste/x.pdf' }] };
    if (/FROM knowledge\.archaeological_claims c/.test(text)) return { rows: [{ id: 77, claim: 'La Apahida este documentată descoperirea de o necropolă.', status: 'VERIFIED', extraction_confidence: '0.900', locality_confidence: '0.900', role_confidence: '0.900', conflicting_sources: false, category: 'NECROPOLIS', periods: ['Epoca fierului'], evidence_count: 1 }] };
    return { rows: [] };
  };
  return writes;
}

test('an unresearched locality is crawled, persisted and answered with 201', async () => {
  const { env } = await import('../src/config/env.js');
  assert.equal(env.evidenceResearchBudgetMs, 15000, 'EVIDENCE_RESEARCH_BUDGET_MS is honoured');
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).includes('cuvinte=') ? htmlResponse(url, 200, searchHtml) : String(url).includes('articol=') ? htmlResponse(url, 200, articleHtml) : htmlResponse(url, 404, 'missing'));
  const writes = stubResearchRows('PENDING');
  try {
    const res = await invoke({ locality: 'Apahida', includeFullText: false });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.headers['X-DetectLab-Storage'], 'newly-persisted');
    assert.ok(res.body.archaeologicalInformation.length >= 1, 'the verified claim is returned with the dossier');
    assert.match(res.body.archaeologicalInformation[0].claim, /Apahida/);
    assert.ok(writes.some((w) => /INSERT INTO knowledge\.archaeological_claims/.test(w.sql)), 'claims are stored, not just echoed');
    assert.ok(writes.some((w) => /INSERT INTO knowledge\.evidence/.test(w.sql)), 'evidence rows carry the excerpt and page');
    const statusWrite = writes.find((w) => /UPDATE knowledge\.localities SET ingestion_status=/.test(w.sql));
    assert.deepEqual(statusWrite.params[1], 'PROCESSED', 'a complete run becomes a cache hit for the next search');
  } finally { globalThis.fetch = previousFetch; }
});

test('a run that hits its budget is flagged and never cached as complete', async () => {
  const { env } = await import('../src/config/env.js');
  const previousBudget = env.evidenceResearchBudgetMs;
  env.evidenceResearchBudgetMs = 1; // no time for a single source request
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (url) => { fetches += 1; return htmlResponse(url, 200, searchHtml); };
  const writes = stubResearchRows('PENDING');
  try {
    const res = await invoke({ locality: 'Apahida', includeFullText: false });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(fetches, 0, 'an expired budget starts no crawl');
    assert.equal(res.body.truncated.reason, 'research_budget_exhausted', 'the UI is told the answer is partial');
    const statusWrite = writes.find((w) => /UPDATE knowledge\.localities SET ingestion_status=/.test(w.sql));
    assert.deepEqual(statusWrite.params[1], 'PARTIAL', 'a partial run stays eligible for research');
    assert.equal(statusWrite.params[2], '6 hours', 'and is re-crawled the same day, not in 30 days');
  } finally { env.evidenceResearchBudgetMs = previousBudget; globalThis.fetch = previousFetch; }
});
