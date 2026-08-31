# Library of Babel — Multi-source archaeological search agent

Premium layer **Biblioteca din Babel**. The user types a **locality or site**
(ex. *Sarmizegetusa*, *Apulum*, *Grădiștea Muncelului*) and the agent queries
**7 open knowledge sources in parallel, directly from the browser**, aggregates
and de-duplicates the findings, and renders them with per-source provenance.

The previous implementation (SIRUTA register + `biblioteca-digitala.ro` crawl
through `POST /api/evidence/search`) was retired: it had a single point of
failure and a hard dependency on one source. The backend dossier pipeline
still exists as an API (see `HISTORICAL_DOSSIER.md`) but the UI no longer
calls it.

## The 7 sources

| # | Source | Endpoint | Result type | Rate limit |
| --- | --- | --- | --- | --- |
| 1 | Wikipedia (ro **and** en) | `{lang}.wikipedia.org/w/api.php` `list=search` | `article` | 200 req/s |
| 2 | Wikidata | `query.wikidata.org/sparql` (EntitySearch service) | `structured` (+ coordinates) | unlimited |
| 3 | OpenStreetMap Nominatim | `nominatim.openstreetmap.org/search` | `place` (+ ambiguity detection) | **1 req/s — enforced client-side** |
| 4 | Wikimedia Commons | `commons.wikimedia.org/w/api.php` (File: namespace) | `image` / `map` / `document` | generous |
| 5 | DBpedia Lookup | `lookup.dbpedia.org/api/search` | `structured` (semantic resource) | generous |
| 6 | Archive.org | `archive.org/advancedsearch.php` | `document` / `image` / `audio` / `video` / `collection` | 7 req/s |
| 7 | Europeana | `api.europeana.eu/record/v2/search.json` | heritage object | 10 req/s — **needs a free `wskey`** |

All seven are called with `Promise.all` — **one source failing never blocks the
others**. Each fetch is wrapped in an `AbortController` timeout and its error
is classified (`timeout` / `http` / `network` / `nokey`) and shown on that
source's status chip.

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
4. Statistics: total results, **N/7 active sources**, duplicates removed,
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
  Migration, Medieval, Modern, Unspecified. Periods are **classified
  automatically** from keywords in the title + description (diacritic-aware,
  word-boundary regexes — “Romania” never triggers the *Roman* period). The
  classification is disclosed as automatic on every render.
* **Filter by source** — click a chip.
* **Export** — JSON and CSV (Excel-safe BOM, quoted fields) over the
  currently filtered rows, as `detectlab-babel-<locality>.{json,csv}`.

## Errors & edge cases (spec §ERORI)

| Case | Behaviour |
| --- | --- |
| A source does not answer | the other 6 continue; the chip names the failure class; a note lists the failed sources |
| 0 results | alternative searches suggested (diacritics-free variant, first word, `… arheologic`, `… archaeological`) |
| Ambiguous locality | **LOCAȚIE AMBIGUĂ** banner with every OSM match (name · type · county) as one-click refined searches |
| All 7 sources down | named error + retry + new-search buttons, never a hang |
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
| `js/library-of-babel.js` | the agent: 7 source adapters, aggregation, rendering, filters, exports |
| `css/library-of-babel.css` | panel row, modal chrome, chips, timeline, cards, toolbar |
| `index.html` | modal shell + panel row (crown names the 7 sources) |
| `sw.js` | cache `detectlab-v59-babel-multisource` + precached assets |
| `test-babel-i18n.js` | ro/en dictionary parity + agent-spec contract |
| `test-babel-multisource.js` | full render with realistic fixtures for all 7 APIs: aggregation, dedup, provenance, periods, filters, exports |
| `test-babel-resilience.js` | failing sources, total outage, zero results, ambiguity, cache |

```bash
node test-babel-i18n.js
node test-babel-multisource.js
node test-babel-resilience.js
```

## Nominatim usage policy

Nominatim allows **1 request/second**. The module enforces a ≥1.1 s spacing
between Nominatim calls (`NOMINATIM_MIN_INTERVAL`); a search makes exactly one
Nominatim request.
