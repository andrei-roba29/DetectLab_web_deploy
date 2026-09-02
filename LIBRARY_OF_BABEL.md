# Library of Babel — Multi-source archaeological search agent

Premium layer **Biblioteca din Babel**. The user types a **locality or site**
(ex. *Sarmizegetusa*, *Apulum*, *Grădiștea Muncelului*) and the agent queries
**8 open knowledge sources in parallel, directly from the browser**, aggregates
and de-duplicates the findings, and renders them with per-source provenance.

The previous implementation (SIRUTA register + `biblioteca-digitala.ro` crawl
through `POST /api/evidence/search`) was retired: it had a single point of
failure and a hard dependency on one source. The backend dossier pipeline
still exists as an API (see `HISTORICAL_DOSSIER.md`) but the UI no longer
calls it.

## The 8 sources

| # | Source | Endpoint | Result type | Rate limit |
| --- | --- | --- | --- | --- |
| 1 | Wikipedia (ro **and** en) | `{lang}.wikipedia.org/w/api.php` `list=search` | `article` | 200 req/s |
| 2 | Wikidata | `query.wikidata.org/sparql` (EntitySearch service) | `structured` (+ coordinates) | unlimited |
| 3 | OpenStreetMap Nominatim | `nominatim.openstreetmap.org/search` | `place` (+ ambiguity detection) | **1 req/s — enforced client-side** |
| 4 | Wikimedia Commons | `commons.wikimedia.org/w/api.php` (File: namespace) | `image` / `map` / `document` | generous |
| 5 | DBpedia Lookup | `lookup.dbpedia.org/api/search` | `structured` (semantic resource) | generous |
| 6 | Archive.org | `archive.org/advancedsearch.php` | `document` / `image` / `audio` / `video` / `collection` | 7 req/s |
| 7 | Europeana | `api.europeana.eu/record/v2/search.json` | heritage object | 10 req/s — **needs a free `wskey`** |
| 8 | CIMEC / RAN | `eism.geo-spatial.ro/.../PatrimoniuWM/MapServer/find` (JSONP) | `structured` (fișă de sit, + coordinates) | ArcGIS REST generous |

### CIMEC / RAN (Repertoriul Arheologic Național)

Source 8 surfaces the **sites around the searched locality**, not just name
matches. Resolution order:

1. **Local heritage layers** — on the map page the RAN layers (0, 5, 6) are
   already loaded as GeoJSON (`window._localLayerData`); the source searches
   them directly (spatially within **10 km** of the locality's OSM
   coordinates, plus attribute matches on locality/site name) with zero
   network traffic.
2. **ArcGIS REST spatial `query`** — otherwise, layers 0/5/6 of the heritage
   service at `eism.geo-spatial.ro` are queried with an envelope around the
   locality coordinates (JSONP to bypass CORS — the same proven approach as
   the map's 600 m radius circles).
3. **ArcGIS REST `find`** — an attribute search with the locality name is
   merged in as well (and is the only path when the locality has no
   coordinates). **Fix (2026-09):** the find task answers with an *object*
   (`{"results": [...]}`), not a bare array — the old parser expected an
   array and silently discarded every live response, which is why site data
   never appeared.

Results are de-duplicated by RAN code, **sorted by distance to the locality**
(the distance is printed on each card, e.g. `~2.0 km`) and linked to the
canonical fișă de sit on `ran.cimec.ro/sel.asp?codran=…`. When geometry is
available, coordinates are attached so the finding appears on the mini-map.

All eight are called with `Promise.all` — **one source failing never blocks the
others**. Each fetch is wrapped in an `AbortController` timeout and its error
is classified (`timeout` / `http` / `network` / `nokey`) and shown on that
source's status chip.

### OSM-driven locality resolution & relevance guard

Every search first resolves the typed text against the **OSM gazetteer** (the
map search bar's `window._osmPlaceLookup` on `OSM.geojson`, Nominatim as
fallback): the canonical diacritics-correct **locality name, its county
(județ) and its coordinates** are picked up and shown in the results header
(*📍 Miluani · jud. Sălaj*). The canonical name is what the text-indexed
sources get, wrapped in **quotes as an exact phrase** (`"Miluani" Sălaj`), so
their engines stop fuzzy-matching it into unrelated words.

On top of that, once the gazetteer confirms the locality, a **relevance
guard** removes fuzzy noise after aggregation: a finding must mention the
locality (typed / canonical spelling, diacritics-insensitive) or lie within
**30 km** of it (OSM places and CIMEC/RAN spatial results are locality-driven
by construction and always pass). *„Miljan Miljanić”* has no business among
the results for *„Miluani, Sălaj”* — the number of removed findings is
disclosed in the statistics row. A site name the gazetteer does not know
(e.g. *Apulum*) leaves the guard disarmed, so historical names keep working.

### Europeana API key

Europeana requires a free API key ([europeana.eu/api](https://pro.europeana.eu/page/get-api)).
The modal has a **Cheie API Europeana (opțional)** panel: the key is stored in
`localStorage` (`babel.europeanaKey`) and can also be pre-configured via
`window.DETECTLAB_EUROPEANA_KEY`. Without a key the source is simply marked
*fără cheie API* and the search continues with the other 6.

## Aggregation & de-duplication

1. Every item is normalised (`normKey`: diacritics stripped, `File:` prefix and
   extension removed, lower-cased) — so *“Ulpia Traiana Sarmizegetusa”* from
   Wikipedia, Wikidata and DBpedia becomes **one card with three source
   badges**.
2. The highest-priority type wins (`place` > `article` > `structured` >
   `document` > `map` > `image` > …); the first description, image,
   coordinates and year are kept; every contributing source stays linked.
3. Relevance score = `sources × 100 + rank bonus + image/coords bonuses` →
   multi-source findings rank first.
4. Statistics: total results, **N/8 active sources**, duplicates removed,
   duration — plus a live per-source chip row that doubles as a **source
   filter**.

## Result format (spec §FORMAT OUTPUT)

Every card carries **TITLU** (title, linked to the source page), **DESCRIERE**
(50–150 characters, HTML stripped, clamped), **TIP** (Articol Wikipedia /
Imagine / Hartă / Locație OSM / Dată SPARQL / Resursă semantică / Document
digital / Obiect de patrimoniu …) and **SURSĂ** (one badge per contributing
API, each linking to its own page). Extra metadata: year, coordinates,
licence/artist (Commons), data provider (Europeana), mediatype (Archive.org).

## Optional parameters

* **Filter by type** — article / structured data / place / document / map /
  image / collection / audio / video (only types that actually occur).
* **Filter by period** — Prehistoric, Bronze Age, Iron Age, Dacian, Roman,
  Migration, Medieval, Modern. Periods are **classified automatically** from
  keywords in the title + description (diacritic-insensitive, word-boundary
  regexes). The **Roman** period is decided by a broad lexical field of
  genuinely ancient-Roman terms (`castru`, `legiune`, `opaiț`, `burgus`,
  `villa`, `terme`, `amfiteatru`, `colonia`, `ulpia`, `traian`, `imperiul
  roman`, `dacia romana`, …) — the bare words *roman / romana / romani /
  romane / romanii / romanilor* are **not** triggers, because once diacritics
  are stripped they could also be *român / română / români / române…* (the
  Romanian language / nationality → false positives). “Romania” the country
  never triggers the *Roman* period. The classification is disclosed as
  automatic on every render.
* **Unspecified-period findings are excluded** — results the classifier cannot
  place on any period (perioada „nespecificată”) are removed from the Library
  of Babel output, so every shown finding carries at least one period label.
  Two locality-driven exceptions always stay: **OSM places** (the searched
  locality itself) and **CIMEC/RAN site records** (archaeological by
  definition — dropping them was hiding the sites around the locality).
* **Filter by source** — click a chip.
* **Export** — JSON and CSV (Excel-safe BOM, quoted fields) over the
  currently filtered rows, as `detectlab-babel-<locality>.{json,csv}`.

## Errors & edge cases (spec §ERORI)

| Case | Behaviour |
| --- | --- |
| A source does not answer | the other 6 continue; the chip names the failure class; a note lists the failed sources |
| 0 results | alternative searches suggested (diacritics-free variant, first word, `… arheologic`, `… archaeological`) |
| Ambiguous locality | **LOCAȚIE AMBIGUĂ** banner with every OSM match (name · type · county) as one-click refined searches |
| All 8 sources down | named error + retry + new-search buttons, never a hang |
| Europeana key rejected | `keyInvalid` note prompts the user to fix the stored key |

## Extensions already included

* **Timeline strip** — periods in chronological order with counts; clicking a
  period filters the list.
* **Leaflet mini-map** — every geolocated finding (OSM + Wikidata
  coordinates) as a circle marker; skipped gracefully when Leaflet is absent.
* **localStorage caching** — results cached 30 min per `language + query`,
  disclosed with a *Reîmprospătează* (bypass) button.
* **Dark theme** — the modal is dark by design.

## Files

| Path | Role |
| --- | --- |
| `js/library-of-babel.js` | the agent: 8 source adapters, aggregation, rendering, filters, exports |
| `css/library-of-babel.css` | panel row, modal chrome, chips, timeline, cards, toolbar |
| `index.html` | modal shell + panel row (crown names the 8 sources) |
| `sw.js` | cache `detectlab-v59-babel-multisource` + precached assets |
| `test-babel-i18n.js` | ro/en dictionary parity + agent-spec contract |
| `test-babel-multisource.js` | full render with realistic fixtures for all 8 APIs: aggregation, dedup, provenance, periods, filters, exports |
| `test-babel-resilience.js` | failing sources, total outage, zero results, ambiguity, cache |
| `test-babel-periods.js` | period-classification contract: unspecified exclusion + lexicon-driven *Roman* (no *român* false positive) |
| `test-babel-osm-locality.js` | shared gazetteer matcher, canonical-name resolution |
| `test-babel-nearby-sites.js` | locality + județ header, relevance guard (Miljan-Miljanić class), nearby RAN sites with distances, exact-phrase queries |

```bash
node test-babel-i18n.js
node test-babel-multisource.js
node test-babel-resilience.js
node test-babel-periods.js
node test-babel-osm-locality.js
node test-babel-nearby-sites.js
```

## Nominatim usage policy

Nominatim allows **1 request/second**. The module enforces a ≥1.1 s spacing
between Nominatim calls (`NOMINATIM_MIN_INTERVAL`); a search makes exactly one
Nominatim request.
