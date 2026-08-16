import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/007_archaeological_knowledge.sql', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../src/services/evidence/repository.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/services/evidence/ingestionWorker.js', import.meta.url), 'utf8');

test('knowledge migration defines every required persistent entity', () => {
  const tables = ['localities','locality_aliases','documents','document_sources','document_pages','locality_mentions','archaeological_sites','archaeological_claims','evidence','findspots','periods','archaeological_categories','figures','citations','contradictions','extraction_runs','review_queue'];
  tables.forEach((name) => assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS knowledge\\.${name}\\b`, 'i'), name));
});

test('database model cannot store PDF binaries or copied figures', () => {
  assert.doesNotMatch(migration, /(?:pdf|document)_(?:data|bytes|blob)|bytea/i);
  assert.match(migration, /image_copied BOOLEAN NOT NULL DEFAULT FALSE CHECK \(image_copied = FALSE\)/);
  assert.match(migration, /document_url TEXT/);
});

test('evidence has a bounded excerpt and complete provenance chain', () => {
  assert.match(migration, /length\(excerpt\) BETWEEN 1 AND 2000/);
  for (const field of ['claim_id','document_id','page_id','source_url','pipeline_version']) assert.match(migration, new RegExp(field));
  assert.match(repository, /persistResearchResult/);
});

test('worker claims jobs safely and implements resumable retries', () => {
  assert.match(worker, /FOR UPDATE OF j SKIP LOCKED/);
  assert.match(worker, /attempt_count=attempt_count\+1/);
  assert.match(worker, /2 \*\*/);
  assert.match(worker, /PAUSED/);
  assert.match(worker, /cursor_locality_id/);
  assert.match(worker, /stale worker lock recovered/);
});
