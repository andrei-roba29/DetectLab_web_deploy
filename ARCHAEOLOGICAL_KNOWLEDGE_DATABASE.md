# DetectLab Persistent Archaeological Knowledge Database

## What is persisted

Migration `backend/migrations/007_archaeological_knowledge.sql` creates an isolated PostgreSQL schema named `knowledge`. It contains the requested locality, alias, document, source, page, mention, site, claim, evidence, findspot, period, category, figure, citation, contradiction, extraction-run, ingestion-job and review-queue entities.

**Source PDF bytes and full page text are deliberately not stored.** `document_sources.document_url` keeps the original `biblioteca-digitala.ro` URL. `document_pages` stores only page identity, extraction state, character count and checksum. `evidence` stores bounded excerpts (maximum 2,000 characters). The extraction layer processes PDFs in an in-memory Node buffer; it does not write source PDFs to disk or PostgreSQL.

The database source chain is:

`knowledge.localities → archaeological_claims → evidence → document_pages → documents → document_sources.document_url`

## Install (local development)

```bash
cd backend
npm run migrate
npm run import:siruta
```

## Railway production deployment

The Railway runtime **cannot connect to `data.gov.ro`** (the official SIRUTA source). This is a network-level restriction on Railway's outbound connectivity to that specific host — general internet access works fine. The solution is to make the official CSV available at an HTTPS URL that Railway *can* reach (e.g. Supabase Storage, an S3 bucket, or any static host), and tell the importer to fetch from that temporary mirror via `SIRUTA_SOURCE_URL`. The official data.gov.ro URL is **always** recorded as `source_url` in PostgreSQL regardless of the fetch source.

### Procedure

1. **Download the official CSV on your local PC** (already done):
   - Source: [data.gov.ro SIRUTA S1 2025](https://data.gov.ro/dataset/fcba1a54-cffd-422c-b3ac-920f63564085/resource/0ab29d86-302c-4cfa-b9b9-fd5c7ff90710/download/siruta_s1_2025.csv)
   - Local path: `C:\railway-temp\siruta_s1_2025.csv` (1,158,562 bytes)

2. **Upload the CSV to a temporary HTTPS mirror accessible from Railway.**

   **Recommended: Supabase Storage** (your project already uses Supabase):

   ```bash
   # Get your Supabase service role key (Settings → API → service_role key)
   # Upload the CSV to a new "siruta-imports" bucket
   curl -X POST \
     -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
     -H "Content-Type: text/csv" \
     --data-binary @C:\railway-temp\siruta_s1_2025.csv \
     "https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/siruta-imports/siruta_s1_2025.csv"

   # Make the object publicly readable (or use a signed URL)
   curl -X POST \
     -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"public": true}' \
     "https://dacboefvooxgsngxkavx.supabase.co/storage/v1/bucket/siruta-imports"
   ```

   The file becomes accessible at:
   ```
   https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/siruta-imports/siruta_s1_2025.csv
   ```

   **Alternative: any HTTPS static host** — upload to any host Railway can reach (Dropbox public link, S3, etc.).

3. **Set the environment variable** in Railway Dashboard → Variables:
   ```
   SIRUTA_SOURCE_URL=https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/siruta-imports/siruta_s1_2025.csv
   ```

4. **Redeploy the backend** (the new code picks up on next deploy), then run the importer:
   ```bash
   railway run npm run import:siruta
   ```

   The importer will:
   - Fetch the CSV from `SIRUTA_SOURCE_URL` (the Supabase Storage mirror)
   - Import all records into `knowledge.localities`
   - Record the official data.gov.ro URL as `source_url` in PostgreSQL
   - Report the total and pilot locality counts

5. **Verify the import** (see [Verification queries](#verification-queries) below).

6. **(Optional) Clean up** — delete the mirror file and/or bucket after a successful import. The data is permanently stored in PostgreSQL.

### Alternative: SIRUTA_CSV_PATH (for one-off Railway shell access)

If you open a Railway shell (`railway shell`), you can upload the CSV via a direct file write, then:

```bash
railway shell
# Inside the shell:
echo 'base64-of-csv...' | base64 -d > /tmp/siruta.csv
SIRUTA_CSV_PATH=/tmp/siruta.csv npm run import:siruta
```

### Environment variables for SIRUTA import

| Variable | Default | Description |
|---|---|---|
| `SIRUTA_SOURCE_URL` | Official data.gov.ro URL | HTTPS URL to fetch the CSV from (e.g. a temporary Supabase Storage mirror). The official URL is always recorded as `source_url`. |
| `SIRUTA_URL` | (same as `SIRUTA_SOURCE_URL`) | Backwards-compatible alias; `SIRUTA_SOURCE_URL` takes precedence if both are set. |
| `SIRUTA_CSV_PATH` | (none) | Path to a pre-downloaded CSV file on the server |
| `SIRUTA_VERSION` | `S1 2025` | Version string stored in the database |
| `SIRUTA_FETCH_TIMEOUT_MS` | `30000` | Fetch timeout in milliseconds |
| `SIRUTA_FETCH_RETRIES` | `3` | Number of retries for the fetch |

### Resolution order

The importer resolves the CSV source in this order (first match wins):

1. **CLI argument**: `node scripts/importSiruta.js /path/to/siruta.csv`
2. **Environment variable**: `SIRUTA_CSV_PATH=/path/to/siruta.csv`
3. **Fetch from `SIRUTA_SOURCE_URL`** (with configurable timeout and retries)

The official data.gov.ro URL is always recorded as `source_url` in PostgreSQL regardless of how the CSV was acquired.

### Verification queries

After a successful import, verify the record counts on Railway:

```bash
railway run node -e "
import { pool } from './src/config/db.js';
const { rows } = await pool.query(`
  SELECT
    (SELECT count(*) FROM knowledge.localities) AS total,
    (SELECT count(*) FROM knowledge.localities WHERE pilot) AS pilot,
    (SELECT count(DISTINCT source_url) FROM knowledge.localities) AS distinct_sources
`);
console.log(rows[0]);
await pool.end();
"
```

Expected output (approximately):
```
{ total: 13139, pilot: 30, distinct_sources: 1 }
```

The `distinct_sources: 1` confirms every locality row points to the official data.gov.ro URL.

## Importer behavior

`import:siruta` imports the official INS **SIRUTA S1 2025** CSV into `knowledge.localities` in a single transaction. The CSV is obtained via the resolution order above. If the selected fetch URL is unreachable, the importer retries with exponential backoff (1s, 2s, 4s) and provides a clear diagnostic message with instructions.

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
