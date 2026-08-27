# Historical Dossier — „Dosarul arheologic / Dosarul istoric al localității”

The premium **Dosarul arheologic** layer now produces a **complete, documented
historical record for every Romanian locality**, built exactly to the canonical
specification the project received:

| Variant | Canonical specification file |
| --- | --- |
| 🇷🇴 Română | `data/dossier-spec/FISA_ISTORICA_PROMPT_RO.md` |
| 🇬🇧 English | `data/dossier-spec/HISTORICAL_RECORD_PROMPT_EN.md` |

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
* `backend/test/dossier.test.js` — unit tests for the deterministic builder
  (section order, anti-hallucination markers, attestation extraction and
  conflicts, period bucketing, CHECK 1–7, levelled sources, bilingual parity).

Run them:

```bash
node test-dossier-i18n.js
node test-dossier-render.js
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
