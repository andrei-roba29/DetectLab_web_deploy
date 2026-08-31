# Historical Dossier — „Dosarul arheologic / Dosarul istoric al localității”

> **Status: legacy backend pipeline.** The *Biblioteca din Babel* UI no longer
> uses this pipeline — the layer now runs the browser-side multi-source search
> agent documented in [`LIBRARY_OF_BABEL.md`](LIBRARY_OF_BABEL.md) (Wikipedia ·
> Wikidata · OpenStreetMap · Commons · DBpedia · Archive.org · Europeana).
> The `POST /api/evidence/search` endpoint, the SIRUTA ingestion and the
> deterministic dossier builder below remain deployed and tested as a
> standalone API.

The two files are full translations of each other (all 23 sections). They are
the product-level contract for what the dossier must contain; the builder code
cites them section by section (`§1`, `§4`, `§10` … `§23`).

## Architecture (deterministic, no LLM)

```
SIRUTA register (INS, level 1)  ─┐
                                  ├─→  backend/src/services/evidence/dossier.js
biblioteca-digitala.ro claims  ──┘         (buildDossier — deterministic)
(level 2, excerpt + page + URL)                    │
                                                   ▼
                       GET /api/localities/:id/dossier   (+ `dossier` key inside
                                                   POST /api/evidence/search)
                                                   ▼
                       js/library-of-babel.js  →  bilingual dossier UI
```

* **Identity (§2)** comes exclusively from the imported official SIRUTA
  register: name, county, UAT, type, SIRUTA code, coordinates, provenance URL.
* **Everything else** is populated only from stored claims that carry an exact
  excerpt, page and source URL. Sections with no verifiable content render the
  canonical sentence *“Nu a fost identificată o sursă verificabilă.”* /
  *“No verifiable source was identified.”* — nothing is ever estimated (§20).
* **First attestation (§4)** is extracted only when an excerpt itself contains
  attestation wording + a year; it is capped at **Probable** (the original
  document must be checked), and conflicting years from different sources are
  surfaced side by side instead of silently choosing one (§18).
* **History (§5)** buckets claims into the specification's periods
  (Prehistory → Antiquity → Early Middle Ages → … → post-1989); empty buckets
  stay explicitly empty.
* **Thematic sections (§§6–9, 14–16)** — administrative evolution, population,
  families/estates, historic buildings, vanished localities, toponymy,
  historical maps — are deterministic diacritic-aware classifiers over the
  verified claim text.
* **Archaeological sites (§§10–13)** are documented contexts from verified
  claims. **RAN codes, LMI codes, cultures and site coordinates are never
  invented**: they stay empty with an explicit banner until the official
  RAN/CIMEC repertory is integrated (portal links to `ran.cimec.ro` and
  `patrimoniu.ro` are shown, labelled as official portals). Locality
  coordinates are never reused as site coordinates.
* **Identity checks (§21)** — CHECK 1…7 (name, county, UAT, SIRUTA,
  coordinates, RAN attribution, source attribution) are computed on every
  build and rendered with PASS / PENDING status.
* **Sources (§17)** are levelled 1–4; SIRUTA and the Digital Library are level
  1/2, RAN/CIMEC + INP are declared “integration in progress”, and every
  publication is listed with its direct link.
* **Certainty (§19)** uses the 🟢 Cert / 🟡 Probabil / 🟠 Controversat /
  🔴 Ipoteză vocabulary (plus an explicit “no data” state) per dossier area.

## Homonym protection (§1)

`POST /api/evidence/search` never merges same-name localities. When the name
matches several SIRUTA entities the API returns `409 ambiguous_locality` with
the exact candidates (id, name, county, UAT, SIRUTA), and the UI shows the
**IDENTIFICARE INSUFICIENTĂ / INSUFFICIENT IDENTIFICATION** picker — the user
selects the exact entity, and the request is re-run with its numeric
`localityId`. Information is never transferred between homonyms.

## Bilingual UI (ro / en)

Every user-facing string of the layer exists in **both language variants** of
the site. All generated notes, check labels and certainty rows from the backend
carry `{ ro, en }` pairs. Guarded by tests:

* `test-dossier-i18n.js` — ro/en dictionary parity (no key may exist in only
  one language), canonical specification sentences, backend↔frontend section
  parity.
* `test-dossier-render.js` — the real backend builder feeds the real frontend
  renderer (stubbed DOM); asserts the RO render, then switches to EN and
  asserts the same dossier rendered in English, including the no-fabrication
  invariants.
* `test-babel-search-failures.js` — the modal's wording for every failure code
  of `POST /api/evidence/search` (no raw `Internal server error`, a request id,
  a retry action, and an honest "partial" banner).
* `backend/test/evidence-sql.test.js` — lints every SQL literal in the backend
  for the `SELECT DISTINCT` + computed `ORDER BY` rule (PostgreSQL rejects it)
  and pins the shape of the locality lookup.
* `backend/test/evidence-search-route.test.js` / `evidence-search-resilience.test.js`
  — the search endpoint driven against a stubbed pool and source: identification,
  §1 homonym picker, persistent-cache hit, crawl → persist → 201, budget
  truncation, and the coded error mapping.
* `backend/test/dossier.test.js` — unit tests for the deterministic builder
  (section order, anti-hallucination markers, attestation extraction and
  conflicts, period bucketing, CHECK 1–7, levelled sources, bilingual parity).

Run them:

```bash
node test-dossier-i18n.js
node test-dossier-render.js
node test-babel-search-failures.js
cd backend && npm test
```

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/evidence/search` | research a locality; response now embeds `dossier` |
| `GET /api/localities/:id/dossier` | the dossier alone |
| `GET /api/localities/:id` | SIRUTA identity row |

The JSON export button in the UI downloads the full response (including the
dossier) as `detectlab-dossier-<locality>.json`.

## Troubleshooting a failing search

`POST /api/evidence/search` is the only user-facing entry point of the pipeline
and it deliberately answers with a *code* per failure class, never a bare
`Internal server error`:

| HTTP | `error` | Meaning / what to do |
| --- | --- | --- |
| 400 | `invalid_locality` | name shorter than 2 or longer than 120 characters |
| 404 | `locality_not_found` | not in the imported SIRUTA register (import it with `npm run import:siruta`) |
| 409 | `ambiguous_locality` | homonyms — the modal shows the SIRUTA picker and re-sends `localityId` (§1) |
| 502 | `source_unavailable` | biblioteca-digitala.ro refused the request (bot filter, outage) |
| 504 | `source_timeout` | the source answered too slowly for the request budget |
| 503 | `database_schema_outdated` | a `knowledge.*` relation/column is missing → `npm run migrate` |
| 503 | `database_query_rejected` | PostgreSQL refused the statement (unsupported/invalid shape, e.g. `SELECT DISTINCT` sorted by an expression that is not in the select list) |
| 503 | `database_unreachable` | the database could not be contacted |
| 500 | `storage_write_failed` | a `knowledge.*` constraint legitimately rejected a write |
| 500 | `search_failed` | a real bug: the response carries a `requestId`, the server log carries the stack |

* Every 5xx response includes `requestId`; grep it in the Railway deploy logs
  (`evidence/search failed` / `evidence/search unhandled error`) to see the
  underlying error without exposing internals to users.
* Set `EVIDENCE_DEBUG=true` on staging to additionally echo `detail`
  (the raw Postgres/network message) — useful while diagnosing a broken
  deploy, off in production.
* Tuning knobs: `EVIDENCE_RESEARCH_BUDGET_MS` (how long a search may take
  before it returns a flagged-partial answer),
  `BIBLIOTECA_REQUEST_INTERVAL_MS` (politeness), `BIBLIOTECA_RETRY_BACKOFF_MS`.

### Known fixed defect: every search answered 500

`findLocality()` — the first query of every search — used

```sql
SELECT DISTINCT l.* … ORDER BY CASE WHEN l.normalized_name=$1 THEN 0 ELSE 1 END, l.id
```

which PostgreSQL rejects (`0A000`: with `SELECT DISTINCT`, every `ORDER BY`
expression must appear in the select list). The identification step therefore
threw before the source was consulted, for *every* locality and *every* user,
and the route re-threw it into the generic handler. The rank is now projected
(`(l.normalized_name=$1) AS exact_match` inside the DISTINCT subselect, ordered
by the projected column in the outer query), `backend/test/evidence-sql.test.js`
lints every SQL literal in the backend for that rule, and the search route maps
storage errors to coded responses.

Related hardening that came with it: concurrent searches for one locality share
a single crawl; a refused alias no longer discards candidates already collected;
HTTP 403/429 from the source is retried once; and a crawl that runs out of time
returns a `truncated` answer that is stored as `PARTIAL` (re-checked after six
hours) instead of being frozen as a complete, empty dossier.
