import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeadline } from '../src/services/evidence/deadline.js';

/*
 * A search must never answer with an anonymous `Internal server error`, and it
 * must never run for as long as the polite source crawl allows. These tests
 * pin the contract that the reported failure violated:
 *   · every failure branch of POST /api/evidence/search returns a machine code,
 *     a request id and a translatable message (and logs the real cause);
 *   · a live crawl is bounded by a wall-clock budget and degrades to a partial,
 *     honestly flagged answer instead of being killed by a gateway timeout;
 *   · a partial run is never cached as complete.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, ...parts), 'utf8');
const route = read('..', 'src', 'routes', 'evidence.js');
const repository = read('..', 'src', 'services', 'evidence', 'repository.js');
const engine = read('..', 'src', 'services', 'evidence', 'engine.js');
const source = read('..', 'src', 'services', 'evidence', 'bibliotecaDigitala.js');
const frontend = read('..', '..', 'js', 'library-of-babel.js');

test('the research deadline bounds every source request', () => {
  const unbounded = createDeadline(0);
  assert.equal(unbounded.bounded, false, 'the ingestion worker runs without a budget');
  assert.equal(unbounded.exceeded(), false);
  assert.equal(unbounded.timeoutFor(45000, 15000), 45000, 'unbounded runs keep the natural per-request timeout');

  const tight = createDeadline(25);
  assert.equal(tight.bounded, true);
  // The per-request timeout is clamped into [floor, ceiling]: a request shorter
  // than its floor is useless, so a nearly expired run is not worth starting
  // (the caller checks `exceeded()` per document instead of queueing one).
  assert.equal(tight.timeoutFor(20000, 4000), 4000, 'never below the usable floor');
  assert.ok(tight.remaining(999999) <= 25, 'the remaining time is bounded by the budget');

  const mid = createDeadline(20000);
  const pdfTimeout = mid.timeoutFor(45000, 15000);
  assert.ok(pdfTimeout <= 20000 && pdfTimeout > 19000, 'a PDF download is cut to what is left of the run');

  return new Promise((resolve) => setTimeout(() => {
    assert.equal(tight.exceeded(), true, 'an expired budget is reported');
    assert.equal(unbounded.exceeded(), false, 'an unbounded run never expires');
    resolve();
  }, 40));
});

test('every evidence search failure answers with a code, a request id and a message', () => {
  // The handler *and* its response helper: failSearch owns the codes/messages.
  const search = route.slice(route.indexOf('const SCHEMA_ERRORS'), route.indexOf("router.get('/localities/:id/dossier'"));
  assert.ok(search.includes('catch (error)') || search.includes('catch(error)'), 'the route keeps its own error handling');
  // Refused/slow source and storage problems are each mapped explicitly.
  assert.match(search, /AbortError[\s\S]{0,200}504[\s\S]{0,80}source_timeout/, 'a slow source is a 504 source_timeout');
  assert.match(search, /SourceUnavailableError[\s\S]{0,220}502[\s\S]{0,80}source_unavailable/, 'a refused source is a 502 source_unavailable');
  assert.match(route, /SCHEMA_ERRORS\.has\(sqlState\)[\s\S]{0,160}503[\s\S]{0,140}database_schema_outdated/, 'an un-migrated schema is a 503, not a 500');
  assert.match(search, /logger\.error\(\{ err: error, requestId/, 'the real cause is logged with the request id');
  assert.match(search, /requestId, message|body\.message/, 'the response always carries the translatable message');
  assert.match(search, /env\.exposeErrorDetails[\s\S]{0,80}detail/, 'server-side diagnostics stay behind EVIDENCE_DEBUG');
  // No branch may hand the error to Express and produce the bare 500 again.
  assert.doesNotMatch(search, /next\(error\)/, 'unknown failures are answered and logged here, never rethrown');
});

test('a bounded crawl returns what it read and is never cached as complete', () => {
  assert.match(engine, /budgetMs = 0/, 'the engine takes an optional budget');
  assert.match(engine, /if \(deadline\.exceeded\(\)\) throw new Error\('research_budget_exhausted'\)/, 'each document checks the shared deadline');
  assert.match(engine, /truncated: Boolean|truncated = Boolean|const truncated = /, 'the run reports truncation');
  assert.match(engine, /MIN_FULL_TEXT_MS/, 'a PDF is not started when the run is about to end');
  assert.match(repository, /Boolean\(result\.failures\?\.length \|\| result\.truncated\)/, 'a truncated run stays PARTIAL so a later search resumes it');
  assert.match(repository, /incomplete \? 'PARTIAL' : 'PROCESSED'/, 'only a complete run becomes a cache hit');
  assert.match(route, /bundle\.truncated = \{ reason: 'research_budget_exhausted'/, 'the API flags the partial answer for the UI');
});

test('the source lane retries polite refusals but never queues past the budget', () => {
  assert.match(source, /RETRYABLE_SOURCE_STATUS = new Set\(\[403, 429[\s\S]{0,30}\]/, '403/429 refusals are retried once (shared egress IPs get intermittent bot-filter hits)');
  assert.match(source, /waitForSourceSlot\(left\)/, 'the politeness queue is bounded by the remaining budget');
  assert.match(source, /Coada de cereri către sursă este prea lungă/, 'a saturated queue fails as a source problem, not a hang');
  assert.match(source, /items\.truncated = truncated/, 'a partly searched alias set is reported as truncated');
  assert.match(source, /if \(found\.size && \(error instanceof SourceUnavailableError/, 'one refused alias must not discard the candidates already collected');
  assert.match(source, /deadline\?\.bounded \? Math\.max\(0, deadline\.remaining\(timeoutMs\)\) : Infinity/, 'a background ingestion run keeps its unlimited patience');
});

test('concurrent searches for one locality share a single crawl', () => {
  assert.match(route, /const inFlightResearch = new Map\(\)/, 'in-flight research is de-duplicated per locality');
  assert.match(route, /researchOnce\(locality\.id/, 'the search route uses the shared run');
  assert.match(route, /\.finally\(\(\) => inFlightResearch\.delete\(localityId\)\)/, 'the entry is released when the run ends');
});

test('the modal translates every failure class instead of showing raw errors', () => {
  // The vocabulary the classifier can emit, derived from the route itself.
  const classifier = route.slice(route.indexOf('export function classifyStorageError'), route.indexOf('function failSearch'));
  const codes = [...new Set([...classifier.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))];
  assert.deepEqual(codes.sort(), ['database_query_rejected', 'database_schema_outdated', 'database_unreachable', 'search_failed', 'storage_write_failed'], `the classifier names every storage failure mode (${codes.join(', ')})`);
  // The frontend agent now queries the 7 open sources directly (see
  // LIBRARY_OF_BABEL.md); it must classify — never echo — its own failures.
  for (const key of ['srcError', 'srcTimeout', 'srcNetwork', 'srcHttp', 'srcNokey', 'allSourcesFailed']) {
    assert.ok(frontend.includes(key), `the UI names the ${key} failure mode`);
  }
  assert.match(frontend, /classifyError/, 'fetch errors are classified instead of being echoed raw');
  assert.match(frontend, /renderError/, 'a dedicated failure renderer exists');
});
