# DetectLab Persistent Archaeological Knowledge Database

## What is persisted

Migration `backend/migrations/007_archaeological_knowledge.sql` creates an isolated PostgreSQL schema named `knowledge`. It contains the requested locality, alias, document, source, page, mention, site, claim, evidence, findspot, period, category, figure, citation, contradiction, extraction-run, ingestion-job and review-queue entities.

**Source PDF bytes and full page text are deliberately not stored.** `document_sources.document_url` keeps the original `biblioteca-digitala.ro` URL. `document_pages` stores only page identity, extraction state, character count and checksum. `evidence` stores bounded excerpts (maximum 2,000 characters). The extraction layer processes PDFs in an in-memory Node buffer; it does not write source PDFs to disk or PostgreSQL.

The database source chain is:

`knowledge.localities → archaeological_claims → evidence → document_pages → documents → document_sources.document_url`

## Install

```bash
cd backend
npm run migrate
npm run import:siruta
```

`import:siruta` downloads the official INS **SIRUTA S1 2025** CSV from data.gov.ro into the operating-system temporary directory, imports it transactionally, and deletes the temporary CSV. A previously downloaded authoritative CSV can instead be supplied explicitly:

```bash
node scripts/importSiruta.js /secure/import/SIRUTA_S1_2025.csv
```

The importer preserves SIRUTA hierarchy and identifiers and does not fuzzy-merge names. Current names become verified aliases. Historical/Hungarian/German aliases must be imported as explicit, sourced `locality_aliases` rows. Thirty geographically distributed localities are marked `pilot=true`; the pilot is a processing scope, not a separate or incomplete locality registry.

## Pilot and national runs

Set a long `INGESTION_ADMIN_KEY`, enable exactly one worker instance with `EVIDENCE_WORKER_ENABLED=true`, then create the pilot:

```bash
curl -X POST "$API/api/ingestion/runs" \
  -H "content-type: application/json" \
  -H "x-ingestion-key: $INGESTION_ADMIN_KEY" \
  -d '{"type":"PILOT"}'
```

After review, use `INCREMENTAL` or `NATIONAL`. The worker uses PostgreSQL jobs and `FOR UPDATE SKIP LOCKED`, one-document-source request lane, a default 1.2 second minimum source interval, four attempts and exponential retry delays. Every locality job commits separately.

Pause and resume do not recreate jobs or reset the cursor:

```bash
curl -X POST "$API/api/ingestion/runs/$RUN_ID/pause"  -H "x-ingestion-key: $INGESTION_ADMIN_KEY"
curl -X POST "$API/api/ingestion/runs/$RUN_ID/resume" -H "x-ingestion-key: $INGESTION_ADMIN_KEY"
```

A one-shot process suitable for cron/container jobs is available as `npm run ingest:once`. Crashed `RUNNING` jobs retain their state for audit; an administrator can inspect them rather than silently losing work. Retried jobs use `available_at` and `attempt_count`.

## Incremental behavior and deduplication

- Localities have `last_ingested_at` and `next_check_at`.
- Documents use the Biblioteca identifier, metadata hash and optional content hash.
- Catalog URL and document URL are unique source identities.
- Claims use a locality/category/normalized-claim fingerprint, allowing independent evidence records to support one claim.
- Evidence uses claim/document/page/excerpt hashes.
- Reprocessing uses upserts and does not erase older evidence.
- Contradictions are first-class links; neither claim is overwritten.
- `INCREMENTAL` selects only localities whose `next_check_at` is due.

## Failure and OCR policy

Textless scans become `OCR_REQUIRED`; extraction/access failures remain explicit document states and create review-queue entries. This deployment does not silently pretend OCR succeeded. An OCR executor can consume those records and store only OCR-derived excerpts/checksums—the source PDF still must remain temporary. Low-confidence or metadata-only claims are `NEEDS_REVIEW` and are queued.

## API

Public read API:

- `POST /api/evidence/search` — reads PostgreSQL when already processed; first processing is persisted
- `GET /api/localities/:id`
- `GET /api/localities/:id/archaeology`
- `GET /api/localities/:id/evidence`
- `GET /api/localities/:id/documents`
- `GET /api/claims/:id`
- `GET /api/evidence/:id`
- `GET /api/ingestion/status`

Protected by `x-ingestion-key`:

- `POST /api/ingestion/locality/:id`
- `POST /api/ingestion/runs`
- `POST /api/ingestion/runs/:id/pause|resume|cancel`
- `GET /api/review-queue`

`ingestion-dashboard.html` displays national totals, documents, claims, evidence, OCR/failures/review counts, county progress and resumable runs. It can start and pause runs when supplied the administration key.

## Auditable example query

```sql
SELECT l.name, l.county, c.claim_text, cat.code AS category,
       p.label_ro AS period, e.excerpt, dp.printed_page, dp.pdf_page,
       d.title, d.publication_year, ds.document_url
FROM knowledge.localities l
JOIN knowledge.archaeological_claims c ON c.locality_id = l.id
LEFT JOIN knowledge.archaeological_categories cat ON cat.id = c.category_id
LEFT JOIN knowledge.claim_periods cp ON cp.claim_id = c.id
LEFT JOIN knowledge.periods p ON p.id = cp.period_id
JOIN knowledge.evidence e ON e.claim_id = c.id
LEFT JOIN knowledge.document_pages dp ON dp.id = e.page_id
JOIN knowledge.documents d ON d.id = e.document_id
JOIN knowledge.document_sources ds ON ds.document_id = d.id AND ds.is_canonical
WHERE l.siruta_code = $1;
```

This produces the required locality → claim → excerpt → page → publication → original Biblioteca Digitală URL chain without storing a PDF copy.
