/* DetectLab — "Biblioteca din Babel" multi-source archaeological search agent.
 *
 * The old single-source dossier search was retired; this module now queries
 * 7 open knowledge sources DIRECTLY from the browser, in parallel, aggregates
 * and de-duplicates the findings and renders them with per-source provenance:
 *
 *   1. Wikipedia (ro + en)   — articles about localities and sites
 *   2. Wikidata (SPARQL)     — structured entities + coordinates
 *   3. OpenStreetMap Nominatim — geocoding / gazetteer (max 1 req/sec!)
 *   4. Wikimedia Commons     — images, plans and old maps
 *   5. DBpedia Lookup        — semantic resources
 *   6. Archive.org           — digitised old documents and collections
 *   7. Europeana             — museum objects and cultural collections
 *                              (free API key required, stored locally)
 *
 * Contract (see AGENT spec): a source that fails never blocks the others,
 * zero results yields suggested alternative searches, an ambiguous locality
 * surfaces the OSM matches, results can be filtered by type / period /
 * source and exported as JSON or CSV. Every UI string exists in BOTH site
 * language variants (ro / en — parity is tested).
 */
(function () {
    'use strict';

    /* ── tuning constants ── */
    var NOMINATIM_MIN_INTERVAL = 1100;   // hard usage-policy limit: 1 req/sec
    var CACHE_TTL = 30 * 60 * 1000;      // 30 minutes of local result caching
    var WIKI_LIMIT = 8, COMMONS_LIMIT = 12, OTHER_LIMIT = 10;
    var SOURCE_ORDER = ['wikipedia', 'wikidata', 'osm', 'commons', 'dbpedia', 'archive', 'europeana'];
    /* dominant type wins when the same finding arrives from several sources */
    var TYPE_PRIORITY = { place: 9, article: 8, structured: 7, document: 6, map: 5, image: 4, collection: 3, audio: 2, video: 2 };
    var TYPE_ORDER = ['article', 'structured', 'place', 'document', 'map', 'image', 'collection', 'audio', 'video'];
    var PERIOD_ORDER = ['prehistory', 'bronze', 'iron', 'dacian', 'roman', 'migration', 'medieval', 'modern'];

    /* ── state ── */
    var running = false, searchSeq = 0;
    var runState = 'form';               // form | searching | results | error
    var lastQuery = '', lastAgg = null, lastStats = null, cachedAt = null, lastError = null;
    var sourceStatuses = {};             // live per-source status while searching
    var uiFilters = { type: 'all', period: 'all', source: 'all' };
    var mapRef = null, lastNominatimAt = 0, formValues = { query: '' };

    /* ── i18n dictionaries — kept in strict ro/en parity (tested) ── */
    var C = {
        ro: {
            title: 'Biblioteca din Babel',
            subtitle: 'Căutare arheologică multi-sursă · 7 surse deschise',
            button: 'Caută o localitate',
            close: 'Închide',
            intro: 'Introdu o localitate sau un sit (ex. Sarmizegetusa, Apulum). Căutarea pornește simultan în 7 surse deschise; rezultatele sunt agregate, deduplicate și marcate cu sursa de proveniență.',
            sourcesPolicy: 'Surse: Wikipedia (ro/en) · Wikidata · OpenStreetMap · Wikimedia Commons · DBpedia · Archive.org · Europeana',
            locality: 'Localitate / sit arheologic',
            placeholder: 'ex. Sarmizegetusa, Apulum, Grădiștea Muncelului…',
            run: 'Caută', searching: 'Interogăm cele 7 surse în paralel…',
            failed: 'Căutarea nu a putut fi finalizată.',
            allSourcesFailed: 'Niciuna dintre cele 7 surse nu a răspuns. Verifică conexiunea la internet și reîncearcă.',
            retry: 'Reîncearcă', newSearch: 'Caută altceva',
            noResults: 'Nu am găsit niciun rezultat pentru',
            noResultsHelp: 'Încearcă o variantă de mai jos, un nume istoric (ex. Ulpia Traiana în loc de Sarmizegetusa) sau forma engleză / maghiară / germană a numelui.',
            suggestions: 'Căutări sugerate',
            results: 'rezultate', activeSources: 'surse active', duplicates: 'duplicate eliminate',
            shown: 'Afișate', of: 'din', seconds: 's',
            perSourceTitle: 'Surse',
            srcOk: 'activă', srcEmpty: 'fără rezultate', srcError: 'indisponibilă',
            srcTimeout: 'fără răspuns (timeout)', srcNetwork: 'inaccesibilă (rețea/CORS)',
            srcHttp: 'eroare server', srcNokey: 'fără cheie API', srcPartial: 'parțial',
            type: 'Tip', period: 'Perioadă', source: 'Sursa', all: 'Toate',
            type_article: 'Articol Wikipedia', type_structured: 'Dată structurată',
            type_place: 'Locație OSM', type_image: 'Imagine', type_map: 'Hartă',
            type_document: 'Document', type_audio: 'Audio', type_video: 'Video', type_collection: 'Colecție',
            sparqlData: 'Dată SPARQL', semanticResource: 'Resursă semantică',
            heritageObject: 'Obiect de patrimoniu', digitalDocument: 'Document digital',
            src_wikipedia: 'Wikipedia', src_wikidata: 'Wikidata', src_osm: 'OpenStreetMap',
            src_commons: 'Wikimedia Commons', src_dbpedia: 'DBpedia', src_archive: 'Archive.org',
            src_europeana: 'Europeana',
            p_prehistory: 'Preistorie', p_bronze: 'Epoca bronzului', p_iron: 'Epoca fierului',
            p_dacian: 'Dacic', p_roman: 'Roman', p_migration: 'Epoca migrațiilor',
            p_medieval: 'Medieval', p_modern: 'Modern', p_unspecified: 'Nespecificată',
            timeline: 'Cronologie', timelineNote: 'clasificare automată',
            mapView: 'Locații pe hartă',
            ambiguousTitle: 'LOCAȚIE AMBIGUĂ',
            ambiguousHelp: 'OpenStreetMap a găsit mai multe potriviri pentru acest nume. Alege una pentru a rafina căutarea:',
            exportJson: 'Export JSON', exportCsv: 'Export CSV',
            cachedFrom: 'Rezultate din cache local', refresh: 'Reîmprospătează',
            keyTitle: 'Cheie API Europeana (opțional)', keyHelp: 'Europeana cere o cheie API gratuită, obținută în câteva minute la europeana.eu/api. Cheia se salvează doar local, în browserul tău. Fără cheie, căutarea continuă automat cu celelalte 6 surse.',
            keyPlaceholder: 'wskey Europeana', keySave: 'Salvează cheia', keySaved: 'Cheia a fost salvată local.',
            keyInvalid: 'Cheia a fost respinsă de Europeana — verifică-o și salveaz-o din nou.',
            year: 'An', generated: 'Generat', query: 'Căutare',
            periodNote: 'Perioadele sunt clasificate automat după cuvinte-cheie din titlu și descriere — verifică întotdeauna sursa originală.',
            partialNote: 'Surse care nu au răspuns (căutarea a continuat cu celelalte):',
            sourcesCount: 'surse'
        },
        en: {
            title: 'Library of Babel',
            subtitle: 'Multi-source archaeological search · 7 open sources',
            button: 'Search a locality',
            close: 'Close',
            intro: 'Enter a locality or site (e.g. Sarmizegetusa, Apulum). The search runs simultaneously across 7 open sources; results are aggregated, de-duplicated and tagged with their source.',
            sourcesPolicy: 'Sources: Wikipedia (ro/en) · Wikidata · OpenStreetMap · Wikimedia Commons · DBpedia · Archive.org · Europeana',
            locality: 'Locality / archaeological site',
            placeholder: 'e.g. Sarmizegetusa, Apulum, Grădiștea Muncelului…',
            run: 'Search', searching: 'Querying all 7 sources in parallel…',
            failed: 'The search could not be completed.',
            allSourcesFailed: 'None of the 7 sources responded. Check your internet connection and try again.',
            retry: 'Try again', newSearch: 'Search something else',
            noResults: 'No results found for',
            noResultsHelp: 'Try one of the variants below, a historical name (e.g. Ulpia Traiana instead of Sarmizegetusa) or the English / Hungarian / German form of the name.',
            suggestions: 'Suggested searches',
            results: 'results', activeSources: 'active sources', duplicates: 'duplicates removed',
            shown: 'Showing', of: 'of', seconds: 's',
            perSourceTitle: 'Sources',
            srcOk: 'active', srcEmpty: 'no results', srcError: 'unavailable',
            srcTimeout: 'no response (timeout)', srcNetwork: 'unreachable (network/CORS)',
            srcHttp: 'server error', srcNokey: 'no API key', srcPartial: 'partial',
            type: 'Type', period: 'Period', source: 'Source', all: 'All',
            type_article: 'Wikipedia article', type_structured: 'Structured data',
            type_place: 'OSM location', type_image: 'Image', type_map: 'Map',
            type_document: 'Document', type_audio: 'Audio', type_video: 'Video', type_collection: 'Collection',
            sparqlData: 'SPARQL data', semanticResource: 'Semantic resource',
            heritageObject: 'Heritage object', digitalDocument: 'Digital document',
            src_wikipedia: 'Wikipedia', src_wikidata: 'Wikidata', src_osm: 'OpenStreetMap',
            src_commons: 'Wikimedia Commons', src_dbpedia: 'DBpedia', src_archive: 'Archive.org',
            src_europeana: 'Europeana',
            p_prehistory: 'Prehistoric', p_bronze: 'Bronze Age', p_iron: 'Iron Age',
            p_dacian: 'Dacian', p_roman: 'Roman', p_migration: 'Migration period',
            p_medieval: 'Medieval', p_modern: 'Modern', p_unspecified: 'Unspecified',
            timeline: 'Timeline', timelineNote: 'automatic classification',
            mapView: 'Locations on map',
            ambiguousTitle: 'AMBIGUOUS LOCATION',
            ambiguousHelp: 'OpenStreetMap found several matches for this name. Pick one to refine the search:',
            exportJson: 'Export JSON', exportCsv: 'Export CSV',
            cachedFrom: 'Results from local cache', refresh: 'Refresh',
            keyTitle: 'Europeana API key (optional)', keyHelp: 'Europeana requires a free API key, obtainable in a few minutes at europeana.eu/api. The key is stored locally in your browser only. Without a key the search automatically continues with the other 6 sources.',
            keyPlaceholder: 'Europeana wskey', keySave: 'Save key', keySaved: 'The key was saved locally.',
            keyInvalid: 'The key was rejected by Europeana — check it and save it again.',
            year: 'Year', generated: 'Generated', query: 'Query',
            periodNote: 'Periods are classified automatically from keywords in the title and description — always check the original source.',
            partialNote: 'Sources that did not respond (the search continued with the others):',
            sourcesCount: 'sources'
        }
    };

    /* Period detection heuristics (diacritics-insensitive, word-aware —
     * "Romania" the country must NOT trigger the Roman period). */
    var PERIOD_RULES = [
        { id: 'prehistory', re: /preistor|prehistor|pal[eae]olit|neolit|eneolit|cucuteni|hamangia|gumelnita|\bboian\b|vinca|starcevo|turdas|petresti/i },
        { id: 'bronze', re: /\bbronz|otomani|wietenberg|monteoru|coslogeni|succuleni/i },
        { id: 'iron', re: /epoca fierului|iron age|hallstatt|halstatt|la[ -]?tene|latene|\bcelt|scythian|scitic|bastarn|thracian|tracic|basarabi|padea|babadag/i },
        { id: 'dacian', re: /\bdacic|\bdacian|\bdacii\b|\bdacilor\b|\bdacia\b|\bgeto\b|\bgetii\b|burebista|decebal|sarmizegetusa regia|cetatile dacice|gradistea de munte/i },
        { id: 'roman', re: /\bromans?\b|\bromane\b|\bromana\b|\bromani\b|\bromanii\b|\bromanilor\b|ulpia|apulum|porolissum|drobeta|tropaeum|adamclisi|castru|castra\b|castren|legion|legiune|\bcolonia\b|amphiteatr|amphitheatr|termele|thermae|villa rustica|trajan|traian|imperiul roman|roman empire|roman province|provincia dacia|dacia romana|roman fort|roman city|roman town|roman camp|roman road|roman bath|roman villa|drum roman|asezare roman/i },
        { id: 'migration', re: /gepids?|gepiz|avars?\b|huns?\b|\bhuni\b|slavs?\b|\bslavi\b|goths?\b|\bgoti\b|epoca migratiilor|migration period/i },
        { id: 'medieval', re: /medieval|mediev|evul mediu|middle ages|secolul (x|xi|xii|xiii|xiv|xv|xvi|xvii)\b|1[1-7]th century|cetate medievala|cetatea medievala|medieval fortress|medieval castle|castel|citadel|fortified church|biserica fortificata|fortareata|\bsaxons?\b|\bsasi\b|husit|secuiesc|knights?/i },
        { id: 'modern', re: /\bmodern|secolul (xviii|xix|xx|xxi)\b|1[89]th century|20th century|21st century|habsburg|austro-ungar|austro-hungarian|world war|razboiul mondial|primul razboi|al doilea razboi/i }
    ];

    /* ── small helpers ── */
    function lang() { return typeof window._currentLang === 'function' && window._currentLang() === 'en' ? 'en' : 'ro'; }
    function t(k) { var d = C[lang()] || C.ro; return (d[k] != null) ? d[k] : k; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function safeUrl(v) { try { var u = new URL(v, 'https://example.invalid'); return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : '#'; } catch (_) { return '#'; } }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function first(v) { return Array.isArray(v) ? v[0] : v; }
    function stripHtml(v) {
        return String(v == null ? '' : v)
            .replace(/<[^>]*>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ').trim();
    }
    function stripDiacritics(v) { return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    /* de-duplication key: "File:Ulpia Traiana.jpg" ≡ "Ulpia Traiana" */
    function normKey(v) {
        return stripDiacritics(v).toLowerCase()
            .replace(/^file\s*:\s*/, '')
            .replace(/\.(jpe?g|jpeg|png|gif|svg|tiff?|webp|pdf|djvu|jp2)$/i, '')
            .replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();
    }
    /* DESCRIPTION: 50–150 characters from the source (spec §OUTPUT FORMAT) */
    function clampDesc(v) {
        var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
        if (s.length > 150) return s.slice(0, 147).replace(/[\s,;.:]+\S*$/, '') + '…';
        return s;
    }
    function slug(v) { return stripDiacritics(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'localitate'; }

    function open() { var m = document.getElementById('babelModal'); if (m) { m.hidden = false; document.body.classList.add('babel-modal-open'); } }
    function close() { var m = document.getElementById('babelModal'); if (m) { m.hidden = true; document.body.classList.remove('babel-modal-open'); } destroyMap(); }
    function isPremium() { if (typeof window._dlIsPremium === 'function') return window._dlIsPremium(); var u = typeof window._authUser === 'function' ? window._authUser() : null; return !!(u && u.plan === 'premium'); }
    function updateButton() { var b = document.getElementById('babelSearchBtn'); if (!b) return; b.disabled = running; b.textContent = running ? '…' : t('button'); }

    /* ── resilient JSON fetch: timeout via AbortController, error classes ── */
    function fetchJson(url, timeout) {
        var c = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var timer = c ? setTimeout(function () { c.abort(); }, timeout || 15000) : null;
        var opts = c ? { signal: c.signal } : {};
        return fetch(url, opts).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (data) {
                if (!r.ok) {
                    var e = new Error((data && (data.message || data.error)) || ('HTTP ' + r.status));
                    e.status = r.status; e.data = data; throw e;
                }
                return data;
            });
        }, function (e) {
            if (timer) clearTimeout(timer);
            throw e;
        }).then(function (v) { if (timer) clearTimeout(timer); return v; });
    }
    function classifyError(e) {
        if (e && e.name === 'AbortError') return 'timeout';
        if (e && e.status) return 'http';
        return 'network';
    }
    function settle(p) { return p.then(function (v) { return { ok: true, value: v }; }, function (e) { return { ok: false, error: e }; }); }

    /* ════════════════════════ THE 7 SOURCES ════════════════════════ */

    /* 1. Wikipedia — ro AND en, both attempted; one failing keeps the other. */
    function wikiSearchOnce(query, lg) {
        var u = new URL('https://' + lg + '.wikipedia.org/w/api.php');
        u.search = new URLSearchParams({ action: 'query', format: 'json', origin: '*', list: 'search', srsearch: query, srlimit: WIKI_LIMIT, srprop: 'snippet|timestamp' });
        return fetchJson(u.href, 12000).then(function (d) {
            return ((d.query && d.query.search) || []).map(function (r, i) {
                return {
                    title: r.title, description: clampDesc(stripHtml(r.snippet)),
                    type: 'article', source: 'wikipedia', lang: lg,
                    url: 'https://' + lg + '.wikipedia.org/wiki/' + encodeURIComponent(String(r.title).replace(/ /g, '_')),
                    rank: i, meta: { lang: lg, updated: r.timestamp || null }
                };
            });
        });
    }
    function sourceWikipedia(query) {
        return Promise.all([settle(wikiSearchOnce(query, 'ro')), settle(wikiSearchOnce(query, 'en'))]).then(function (rs) {
            var oks = rs.filter(function (r) { return r.ok; });
            if (!oks.length) throw rs[0].error;
            var results = [], seen = {};
            oks.forEach(function (r) {
                r.value.forEach(function (item) { var k = normKey(item.title); if (!k || seen[k]) return; seen[k] = 1; results.push(item); });
            });
            return { results: results, partial: oks.length < 2 };
        });
    }

    /* 2. Wikidata — SPARQL EntitySearch + labels/descriptions/coordinates. */
    function sourceWikidata(query, lg) {
        var sparql = 'SELECT ?item ?itemLabel ?itemDescription ?coord WHERE {'
            + ' SERVICE wikibase:mwapi { bd:serviceParam wikibase:endpoint "www.wikidata.org";'
            + ' wikibase:api "EntitySearch"; mwapi:search "' + String(query).replace(/"/g, '\\"') + '";'
            + ' mwapi:language "' + lg + '"; mwapi:limit "20". ?item wikibase:apiOutputItem mwapi:item. }'
            + ' OPTIONAL { ?item wdt:P625 ?coord. }'
            + ' SERVICE wikibase:label { bd:serviceParam wikibase:language "' + lg + ',en". } } LIMIT 40';
        var u = new URL('https://query.wikidata.org/sparql');
        u.search = new URLSearchParams({ format: 'json', query: sparql });
        return fetchJson(u.href, 30000).then(function (d) {
            var bindings = (d.results && d.results.bindings) || [], seen = {}, results = [];
            bindings.forEach(function (b, i) {
                var id = String((b.item && b.item.value) || '').split('/').pop();
                if (!id || seen[id]) return;
                seen[id] = 1;
                var label = (b.itemLabel && b.itemLabel.value) || id;
                var desc = (b.itemDescription && b.itemDescription.value) || '';
                var pt = String((b.coord && b.coord.value) || ''), coords = null;
                var m = pt.match(/Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/);
                if (m) coords = { lat: Number(m[2]), lng: Number(m[1]) };
                results.push({
                    title: label, description: clampDesc(desc), type: 'structured', source: 'wikidata',
                    url: 'https://www.wikidata.org/wiki/' + id, rank: i, coords: coords,
                    typeKey: 'sparqlData', meta: { entityId: id }
                });
            });
            return { results: results };
        });
    }

    /* 3. OpenStreetMap Nominatim — gazetteer + ambiguity detection.
     * Strictly throttled to 1 request/second (usage policy). */
    function sourceOsm(query, lg) {
        var wait = NOMINATIM_MIN_INTERVAL - (Date.now() - lastNominatimAt);
        return (wait > 0 ? sleep(wait) : Promise.resolve()).then(function () {
            lastNominatimAt = Date.now();
            var u = new URL('https://nominatim.openstreetmap.org/search');
            u.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: 8, addressdetails: 1, 'accept-language': lg });
            return fetchJson(u.href, 15000);
        }).then(function (d) {
            var arr = Array.isArray(d) ? d : [];
            var results = arr.map(function (r, i) {
                var name = r.name || String(r.display_name || '').split(',')[0] || '?';
                return {
                    title: name, description: clampDesc(r.display_name || name),
                    type: 'place', source: 'osm',
                    url: 'https://www.openstreetmap.org/' + (r.osm_type || 'node') + '/' + (r.osm_id || ''),
                    rank: i, coords: { lat: Number(r.lat), lng: Number(r.lon) },
                    meta: { category: r.category || null, osmType: r.type || null }
                };
            });
            return { results: results, osmMatches: arr.map(function (r) { return { name: r.name || String(r.display_name || '').split(',')[0], display: r.display_name || '', type: r.type || '', category: r.category || '' }; }) };
        });
    }

    /* 4. Wikimedia Commons — photos, plans and old maps (namespace File:). */
    function sourceCommons(query) {
        var u = new URL('https://commons.wikimedia.org/w/api.php');
        u.search = new URLSearchParams({
            action: 'query', format: 'json', origin: '*', generator: 'search',
            gsrsearch: query, gsrlimit: COMMONS_LIMIT, gsrnamespace: 6,
            prop: 'imageinfo', iiprop: 'url|extmetadata|mime|size', iiurlwidth: 320
        });
        return fetchJson(u.href, 15000).then(function (d) {
            var pages = (d.query && d.query.pages) || {};
            var arr = Object.keys(pages).map(function (k) { return pages[k]; })
                .filter(function (p) { return p.imageinfo && p.imageinfo[0]; })
                .sort(function (a, b) { return (a.index || 99) - (b.index || 99); });
            var results = [];
            arr.forEach(function (p, i) {
                var ii = p.imageinfo[0], em = ii.extmetadata || {}, mime = ii.mime || '';
                if (/^audio\//.test(mime) || /^video\//.test(mime)) return; // media noise
                var fname = String(p.title || '').replace(/^File:/, '');
                var desc = stripHtml(em.ImageDescription && em.ImageDescription.value || '');
                var cats = String(em.Categories && em.Categories.value || '');
                var isMap = mime === 'image/svg+xml' || /\b(map|maps|hart|plan|kart|atlas)\b/i.test(fname + ' ' + desc + ' ' + cats);
                var type = (mime === 'application/pdf' || mime === 'image/vnd.djvu') ? 'document' : (isMap ? 'map' : 'image');
                results.push({
                    title: fname.replace(/\.[a-z0-9]+$/i, ''),
                    description: clampDesc(desc || (em.ObjectName && stripHtml(em.ObjectName.value)) || fname),
                    type: type, source: 'commons',
                    url: ii.descriptionurl || ('https://commons.wikimedia.org/wiki/' + encodeURIComponent(String(p.title).replace(/ /g, '_'))),
                    image: ii.thumburl || ii.url || null, rank: i,
                    meta: { license: em.LicenseShortName && em.LicenseShortName.value || null, artist: stripHtml(em.Artist && em.Artist.value || '') || null }
                });
            });
            return { results: results };
        });
    }

    /* 5. DBpedia Lookup — semantic resources (English DBpedia only; the
     * de/fr/… interwiki hits are duplicates of the same entities). */
    function sourceDbpedia(query) {
        var u = new URL('https://lookup.dbpedia.org/api/search');
        u.search = new URLSearchParams({ query: query, limit: OTHER_LIMIT, format: 'JSON' });
        return fetchJson(u.href, 15000).then(function (d) {
            var docs = (d && d.docs) || [], results = [];
            docs.forEach(function (doc, i) {
                var res = String(first(doc.resource || doc.id) || '');
                if (!/^https?:\/\/dbpedia\.org\/resource\//.test(res)) return;
                var label = stripHtml(first(doc.label) || '') || decodeURIComponent(res.split('/resource/')[1] || 'DBpedia');
                var cats = (doc.category || []).map(function (c) { return String(c).split('Category:').pop(); }).filter(Boolean).slice(0, 4);
                results.push({
                    title: label, description: clampDesc(stripHtml(first(doc.comment) || '')),
                    type: 'structured', source: 'dbpedia', url: res, rank: i,
                    typeKey: 'semanticResource', meta: { categories: cats }
                });
            });
            return { results: results };
        });
    }

    /* 6. Archive.org — digitised old documents and collections. */
    function sourceArchive(query) {
        var u = new URL('https://archive.org/advancedsearch.php');
        var qs = new URLSearchParams({ q: query, rows: OTHER_LIMIT, page: 1, output: 'json' });
        ['identifier', 'title', 'description', 'year', 'mediatype'].forEach(function (f) { qs.append('fl[]', f); });
        u.search = qs;
        return fetchJson(u.href, 15000).then(function (d) {
            var docs = (d.response && d.response.docs) || [];
            var MT = { texts: 'document', image: 'image', audio: 'audio', movies: 'video', collection: 'collection', software: 'collection', etree: 'audio' };
            return {
                results: docs.map(function (doc, i) {
                    var id = doc.identifier || ('archive-' + i);
                    var desc = Array.isArray(doc.description) ? doc.description[0] : doc.description;
                    return {
                        title: stripHtml(doc.title || id) || id,
                        description: clampDesc(stripHtml(desc || '')),
                        type: MT[doc.mediatype] || 'document', source: 'archive',
                        url: 'https://archive.org/details/' + encodeURIComponent(id),
                        rank: i, year: doc.year || null,
                        typeKey: doc.mediatype === 'texts' ? 'digitalDocument' : null,
                        meta: { mediatype: doc.mediatype || null }
                    };
                })
            };
        });
    }

    /* 7. Europeana — museum objects and cultural collections (needs a free
     * wskey; without one the source is simply marked inactive). */
    function europeanaKey() {
        try {
            if (typeof localStorage !== 'undefined') {
                var k = localStorage.getItem('babel.europeanaKey');
                if (k) return String(k);
            }
        } catch (_) { /* private mode */ }
        return (typeof window !== 'undefined' && window.DETECTLAB_EUROPEANA_KEY) || '';
    }
    function saveEuropeanaKey(key) {
        try { if (typeof localStorage !== 'undefined') localStorage.setItem('babel.europeanaKey', String(key || '').trim()); } catch (_) { }
    }
    function sourceEuropeana(query, key) {
        if (!key) { var e = new Error('nokey'); e.code = 'nokey'; return Promise.reject(e); }
        var u = new URL('https://api.europeana.eu/record/v2/search.json');
        u.search = new URLSearchParams({ wskey: key, query: query, rows: OTHER_LIMIT, profile: 'minimal' });
        return fetchJson(u.href, 15000).then(function (d) {
            if (d && d.success === false) {
                var err = new Error(d.message || d.error || 'Europeana error');
                err.code = (d && d.code) || 'invalid_apikey';
                throw err;
            }
            var items = d.items || [];
            var ET = { IMAGE: 'image', TEXT: 'document', VIDEO: 'video', SOUND: 'audio', '3D': 'image' };
            return {
                results: items.map(function (it, i) {
                    var title = (Array.isArray(it.title) ? it.title[0] : it.title) || t('heritageObject');
                    var prov = (Array.isArray(it.edmDataProvider) ? it.edmDataProvider[0] : it.edmDataProvider) || '';
                    return {
                        title: title, description: clampDesc(prov),
                        type: ET[it.edmType] || 'document', source: 'europeana',
                        url: 'https://www.europeana.eu/item' + (it.id || ''),
                        rank: i, typeKey: 'heritageObject',
                        meta: { provider: prov || null, edmType: it.edmType || null }
                    };
                })
            };
        });
    }

    /* ══════════════════ parallel orchestration + aggregation ══════════════════ */

    function searchAll(query, lg, key, seq, onSource) {
        var t0 = Date.now();
        var runners = [
            { id: 'wikipedia', run: function () { return sourceWikipedia(query); } },
            { id: 'wikidata', run: function () { return sourceWikidata(query, lg); } },
            { id: 'osm', run: function () { return sourceOsm(query, lg); } },
            { id: 'commons', run: function () { return sourceCommons(query); } },
            { id: 'dbpedia', run: function () { return sourceDbpedia(query); } },
            { id: 'archive', run: function () { return sourceArchive(query); } },
            { id: 'europeana', run: function () { return sourceEuropeana(query, key); } }
        ];
        var tasks = runners.map(function (r) {
            return r.run().then(function (out) {
                var st = {
                    id: r.id, status: out.results && out.results.length ? 'ok' : 'empty',
                    count: out.results ? out.results.length : 0, ms: Date.now() - t0,
                    partial: !!out.partial, message: ''
                };
                if (seq === searchSeq && onSource) onSource(st);
                return { source: st, results: out.results || [], extra: out };
            }, function (e) {
                var kind = (e && e.code === 'nokey') ? 'nokey' : classifyError(e);
                var st = {
                    id: r.id, status: kind, count: 0, ms: Date.now() - t0,
                    message: (e && e.message) || '', invalidKey: !!(e && e.code === 'invalid_apikey') || !!(e && e.data && e.data.code === 'invalid_apikey')
                };
                if (seq === searchSeq && onSource) onSource(st);
                return { source: st, results: [], extra: {} };
            });
        });
        return Promise.all(tasks).then(function (outs) {
            return { perSource: outs, durationMs: Date.now() - t0 };
        });
    }

    /* Merge findings across sources by normalised title, attach automatic
     * period tags and a cross-source relevance score. */
    function detectPeriods(r) {
        var text = stripDiacritics((r.title || '') + ' ' + (r.description || '') + ' ' + (r.meta ? JSON.stringify(r.meta) : '')).toLowerCase();
        var ids = [];
        PERIOD_RULES.forEach(function (rule) { if (rule.re.test(text)) ids.push(rule.id); });
        return ids;
    }
    function aggregate(outs, durationMs) {
        var map = {}, order = [], totalBefore = 0;
        outs.forEach(function (out) {
            (out.results || []).forEach(function (item, rank) {
                var key = normKey(item.title);
                if (!key) return;
                totalBefore++;
                var ex = map[key];
                if (!ex) {
                    ex = item;
                    ex.sources = [{ id: item.source, url: item.url, lang: item.lang || null }];
                    ex.rank = rank; ex.periods = [];
                    map[key] = ex; order.push(ex);
                } else {
                    if (!ex.sources.some(function (s) { return s.id === item.source; })) {
                        ex.sources.push({ id: item.source, url: item.url, lang: item.lang || null });
                    }
                    if (!ex.description && item.description) ex.description = item.description;
                    if (!ex.image && item.image) ex.image = item.image;
                    if (!ex.coords && item.coords) ex.coords = item.coords;
                    if (!ex.year && item.year) ex.year = item.year;
                    if ((TYPE_PRIORITY[item.type] || 0) > (TYPE_PRIORITY[ex.type] || 0)) {
                        ex.type = item.type; ex.typeKey = item.typeKey || null; ex.url = item.url; ex.title = item.title;
                    }
                    ex.rank = Math.min(ex.rank, rank);
                }
            });
        });
        order.forEach(function (r) {
            r.periods = detectPeriods(r);
            r.description = clampDesc(r.description || '');
            r.score = r.sources.length * 100 + Math.max(0, 60 - r.rank * 5) + (r.image ? 4 : 0) + (r.coords ? 4 : 0);
        });
        order.sort(function (a, b) { return b.score - a.score; });
        return { results: order, totalBeforeDedup: totalBefore, durationMs: durationMs };
    }

    function buildStats(query, perSource, agg) {
        var sources = SOURCE_ORDER.map(function (id) {
            var out = perSource.filter(function (o) { return o.source.id === id; })[0];
            return out ? out.source : { id: id, status: 'error', count: 0, message: 'not run' };
        });
        return {
            query: query, generatedAt: new Date().toISOString(),
            durationMs: agg.durationMs,
            total: agg.results.length,
            totalBeforeDedup: agg.totalBeforeDedup,
            duplicatesRemoved: agg.totalBeforeDedup - agg.results.length,
            active: sources.filter(function (s) { return s.status === 'ok' || s.status === 'empty'; }).length,
            sources: sources,
            osmMatches: (perSource.filter(function (o) { return o.source.id === 'osm'; })[0] || { extra: {} }).extra.osmMatches || []
        };
    }

    /* ── local result cache (localStorage, TTL) ── */
    function cacheKey(q, lg) { return 'babel.cache.v1.' + lg + '.' + slug(q); }
    function cacheGet(q, lg) {
        try {
            if (typeof localStorage === 'undefined') return null;
            var raw = localStorage.getItem(cacheKey(q, lg));
            if (!raw) return null;
            var v = JSON.parse(raw);
            if (!v || !v.ts || (Date.now() - v.ts) > CACHE_TTL) return null;
            return v;
        } catch (_) { return null; }
    }
    function cacheSet(q, lg, data) {
        try {
            if (typeof localStorage === 'undefined') return;
            localStorage.setItem(cacheKey(q, lg), JSON.stringify({ ts: Date.now(), data: data }));
        } catch (_) { /* quota / private mode */ }
    }

    /* ════════════════════════ rendering ════════════════════════ */

    function destroyMap() { if (mapRef) { try { mapRef.remove(); } catch (_) { } mapRef = null; } }

    function renderSearching() {
        runState = 'searching';
        var chips = SOURCE_ORDER.map(function (id) { return sourceChipHtml(sourceStatuses[id] || { id: id, status: 'pending' }); }).join('');
        document.getElementById('babelBody').innerHTML =
            '<div class="babel-state is-loading"><span class="babel-orbit"></span><p>' + esc(t('searching')) + '</p></div>' +
            '<div class="babel-chip-label">' + esc(t('perSourceTitle')) + '</div>' +
            '<div class="babel-chips" id="babelChips">' + chips + '</div>';
    }

    function statusClass(status) {
        if (status === 'ok') return 'is-ok';
        if (status === 'empty') return 'is-empty';
        if (status === 'nokey') return 'is-nokey';
        if (status === 'pending') return 'is-pending';
        return 'is-err';
    }
    function chipNote(st) {
        if (st.status === 'pending') return '…';
        if (st.status === 'ok') return st.partial ? t('srcPartial') : t('srcOk');
        if (st.status === 'empty') return t('srcEmpty');
        if (st.status === 'nokey') return t('srcNokey');
        if (st.status === 'timeout') return t('srcTimeout');
        if (st.status === 'http') return t('srcHttp');
        if (st.status === 'network') return t('srcNetwork');
        return t('srcError');
    }
    function chipInner(st) {
        var count = st.status === 'ok' ? '<b>' + st.count + '</b>' : '';
        return esc(t('src_' + st.id)) + ' ' + count + (statusClass(st.status) === 'is-err' ? '<i>✕</i>' : '') + '<small>' + esc(chipNote(st)) + '</small>';
    }
    function sourceChipHtml(st, asButton) {
        var open = asButton ? '<button type="button" class="babel-chip ' + statusClass(st.status) + (asButton.active ? ' is-active' : '') + '" data-source="' + esc(st.id) + '" title="' + esc(chipNote(st)) + '">'
            : '<span class="babel-chip ' + statusClass(st.status) + '" id="babel-src-' + esc(st.id) + '" data-source="' + esc(st.id) + '" title="' + esc(chipNote(st)) + '">';
        var close = asButton ? '</button>' : '</span>';
        return open + chipInner(st) + close;
    }

    function chipUpdate(st) {
        sourceStatuses[st.id] = st;
        var el = document.getElementById('babel-src-' + st.id);
        if (el) {
            el.className = 'babel-chip ' + statusClass(st.status);
            el.title = chipNote(st);
            el.innerHTML = chipInner(st);
        }
    }

    function renderForm(prefill) {
        runState = 'form';
        destroyMap();
        document.getElementById('babelBody').innerHTML =
            '<div class="babel-intro"><span class="babel-intro-seal">7×</span><div>' +
            '<h2>' + esc(t('title')) + '</h2><p>' + esc(t('intro')) + '</p>' +
            '<p class="babel-policy">' + esc(t('sourcesPolicy')) + '</p></div></div>' +
            '<form id="babelForm" class="babel-searchbar">' +
            '<label><span class="vh">' + esc(t('locality')) + '</span>' +
            '<input id="babelQuery" required maxlength="120" autocomplete="off" placeholder="' + esc(t('placeholder')) + '" value="' + esc(prefill != null ? prefill : formValues.query) + '"></label>' +
            '<button type="submit">' + esc(t('run')) + '</button></form>' +
            '<details class="babel-keypanel"><summary>' + esc(t('keyTitle')) + '</summary>' +
            '<p>' + esc(t('keyHelp')) + '</p>' +
            '<div class="babel-keyrow"><input id="babelKey" maxlength="80" autocomplete="off" placeholder="' + esc(t('keyPlaceholder')) + '" value="' + esc(europeanaKey()) + '">' +
            '<button type="button" id="babelKeySave">' + esc(t('keySave')) + '</button></div>' +
            '<p class="babel-keynote" id="babelKeyNote" hidden></p></details>';
        var f = document.getElementById('babelForm');
        f.onsubmit = function (e) { e.preventDefault(); run(document.getElementById('babelQuery').value); };
        var qi = document.getElementById('babelQuery');
        if (qi && typeof qi.focus === 'function') qi.focus();
        var saveBtn = document.getElementById('babelKeySave');
        saveBtn.onclick = function () {
            saveEuropeanaKey(document.getElementById('babelKey').value);
            var n = document.getElementById('babelKeyNote');
            n.hidden = false; n.textContent = t('keySaved');
        };
    }

    /* Filtered view of the aggregated results (type + period + source). */
    function filteredResults() {
        return (lastAgg || []).filter(function (r) {
            if (uiFilters.type !== 'all' && r.type !== uiFilters.type) return false;
            if (uiFilters.period === 'unspecified') { if (r.periods.length) return false; }
            else if (uiFilters.period !== 'all' && r.periods.indexOf(uiFilters.period) === -1) return false;
            if (uiFilters.source !== 'all' && !r.sources.some(function (s) { return s.id === uiFilters.source; })) return false;
            return true;
        });
    }

    function resultHtml(r) {
        var typeLabel = r.typeKey ? t(r.typeKey) : t('type_' + r.type);
        var badges = (r.sources || []).map(function (s) {
            var url = safeUrl(s.url || '');
            var lab = t('src_' + s.id) + (s.lang ? ' (' + s.lang.toUpperCase() + ')' : '');
            return url !== '#' ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(lab) + '</a>' : '<span>' + esc(lab) + '</span>';
        }).join('');
        var meta = [];
        if (r.year) meta.push(esc(t('year')) + ': ' + esc(r.year));
        if (r.coords) meta.push(esc(r.coords.lat.toFixed(4)) + ', ' + esc(r.coords.lng.toFixed(4)));
        if (r.meta && r.meta.license) meta.push(esc(r.meta.license));
        if (r.meta && r.meta.artist) meta.push(esc(r.meta.artist));
        if (r.meta && r.meta.provider) meta.push(esc(r.meta.provider));
        if (r.meta && r.meta.mediatype) meta.push(esc(r.meta.mediatype));
        return '<article class="babel-result" data-source="' + esc((r.sources[0] || {}).id || '') + '">' +
            (r.image && safeUrl(r.image) !== '#' ? '<img src="' + esc(safeUrl(r.image)) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') +
            '<div class="babel-result-main">' +
            '<div class="babel-result-top"><span class="babel-result-type t-' + esc(r.type) + '">' + esc(typeLabel) + '</span>' +
            '<span class="babel-result-sources">' + badges + (r.sources && r.sources.length > 1 ? '<em>' + r.sources.length + ' ' + esc(t('sourcesCount')) + '</em>' : '') + '</span></div>' +
            '<h3><a href="' + esc(safeUrl(r.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(r.title) + '</a></h3>' +
            (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
            (r.periods && r.periods.length ? '<div class="babel-periods">' + r.periods.map(function (p) { return '<span>' + esc(t('p_' + p)) + '</span>'; }).join('') + '</div>' : '') +
            (meta.length ? '<div class="babel-result-meta">' + meta.join(' · ') + '</div>' : '') +
            '</div></article>';
    }

    function renderResults() {
        runState = 'results';
        destroyMap();
        var s = lastStats, q = lastQuery;
        var active = s.active, total = s.total;
        var failed = s.sources.filter(function (x) { return x.status === 'timeout' || x.status === 'http' || x.status === 'network' || x.status === 'error'; });
        var invalidKey = s.sources.some(function (x) { return x.id === 'europeana' && x.invalidKey; });
        var visible = filteredResults();
        var hasCoords = (lastAgg || []).some(function (r) { return r.coords; });
        var mapAvailable = typeof window.L !== 'undefined' && typeof window.L.map === 'function';

        /* head + stats */
        var html =
            '<header class="babel-results-head"><div><span>DETECTLAB · MULTI-SOURCE SEARCH</span>' +
            '<h2>„' + esc(q) + '”</h2><p><b>' + total + '</b> ' + esc(t('results')) + ' · <b>' + active + '/7</b> ' + esc(t('activeSources')) +
            (s.duplicatesRemoved > 0 ? ' · <b>' + s.duplicatesRemoved + '</b> ' + esc(t('duplicates')) : '') +
            ' · ' + (s.durationMs / 1000).toFixed(1) + ' ' + esc(t('seconds')) + '</p></div>' +
            '<button type="button" id="babelNew">' + esc(t('newSearch')) + '</button></header>';

        /* live per-source chips (clickable → filter by source) */
        html += '<div class="babel-chip-label">' + esc(t('perSourceTitle')) + '</div>' +
            '<div class="babel-chips" id="babelChips">' + s.sources.map(function (st) {
            return sourceChipHtml(st, { active: uiFilters.source === st.id });
        }).join('') + '</div>';

        if (cachedAt) html += '<p class="babel-cachenote">' + esc(t('cachedFrom')) + ' · ' + esc(new Date(cachedAt).toLocaleString()) + ' <button type="button" id="babelRefresh">' + esc(t('refresh')) + '</button></p>';
        if (failed.length) {
            html += '<p class="babel-partial">' + esc(t('partialNote')) + ' ' + failed.map(function (f) {
                return '<span>' + esc(t('src_' + f.id)) + ' (' + esc(t('src' + f.status.charAt(0).toUpperCase() + f.status.slice(1)) || f.status) + ')</span>';
            }).join('') + '</p>';
        }
        if (invalidKey) html += '<p class="babel-partial">' + esc(t('keyInvalid')) + '</p>';

        /* ambiguity: several OSM matches → refine buttons (spec §EDGE CASES) */
        if (s.osmMatches && s.osmMatches.length > 1) {
            html += '<div class="babel-ambiguous"><b>⚠ ' + esc(t('ambiguousTitle')) + '</b><p>' + esc(t('ambiguousHelp')) + '</p><div class="babel-ambiguous-list">' +
                s.osmMatches.map(function (m) {
                    var where = String(m.display || '').split(',').slice(1, 3).join(',').trim();
                    return '<button type="button" class="babel-pick" data-query="' + esc(m.name) + '"><strong>' + esc(m.name) + '</strong><span>' + esc([m.type, where].filter(Boolean).join(' · ')) + '</span></button>';
                }).join('') + '</div></div>';
        }

        /* zero results → suggested alternative searches (spec §EDGE CASES) */
        if (total === 0) {
            var variants = [stripDiacritics(q), q.split(/[\s,]+/)[0], q + ' arheologic', q + ' archaeological'].filter(function (v, i, a) { return v && v.length > 2 && a.indexOf(v) === i; });
            html += '<div class="babel-empty"><p>' + esc(t('noResults')) + ' „' + esc(q) + '”.</p><p>' + esc(t('noResultsHelp')) + '</p>' +
                '<div class="babel-suggest"><b>' + esc(t('suggestions')) + ':</b> ' + variants.map(function (v) { return '<button type="button" class="babel-pick" data-query="' + esc(v) + '">' + esc(v) + '</button>'; }).join('') + '</div></div>';
        } else {
            /* timeline of periods (automatic classification, clickable filter) */
            var counts = {};
            (lastAgg || []).forEach(function (r) { r.periods.forEach(function (p) { counts[p] = (counts[p] || 0) + 1; }); var u = r.periods.length === 0; if (u) counts.unspecified = (counts.unspecified || 0) + 1; });
            var tl = PERIOD_ORDER.filter(function (p) { return counts[p]; }).map(function (p) {
                return '<button type="button" data-period="' + p + '"' + (uiFilters.period === p ? ' class="is-active"' : '') + '><span>' + esc(t('p_' + p)) + '</span><b>' + counts[p] + '</b></button>';
            }).join('');
            if (counts.unspecified) tl += '<button type="button" data-period="unspecified"' + (uiFilters.period === 'unspecified' ? ' class="is-active"' : '') + '><span>' + esc(t('p_unspecified')) + '</span><b>' + counts.unspecified + '</b></button>';
            if (tl) html += '<div class="babel-timeline"><span class="babel-timeline-label">' + esc(t('timeline')) + ' <small>(' + esc(t('timelineNote')) + ')</small></span><div class="babel-timeline-strip">' + tl + '</div></div>';

            /* mini map with every geolocated finding */
            if (hasCoords && mapAvailable) html += '<div class="babel-mapwrap"><span class="babel-maplabel">' + esc(t('mapView')) + '</span><div class="babel-map" id="babelMap"></div></div>';

            /* filters */
            var types = TYPE_ORDER.filter(function (ty) { return (lastAgg || []).some(function (r) { return r.type === ty; }); });
            html += '<div class="babel-toolbar">' +
                '<label><span>' + esc(t('type')) + '</span><select id="babelTypeFilter"><option value="all">' + esc(t('all')) + '</option>' +
                types.map(function (ty) { return '<option value="' + ty + '"' + (uiFilters.type === ty ? ' selected' : '') + '>' + esc(t('type_' + ty)) + '</option>'; }).join('') + '</select></label>' +
                '<label><span>' + esc(t('period')) + '</span><select id="babelPeriodFilter"><option value="all">' + esc(t('all')) + '</option>' +
                PERIOD_ORDER.filter(function (p) { return counts[p]; }).map(function (p) { return '<option value="' + p + '"' + (uiFilters.period === p ? ' selected' : '') + '>' + esc(t('p_' + p)) + '</option>'; }).join('') +
                (counts.unspecified ? '<option value="unspecified"' + (uiFilters.period === 'unspecified' ? ' selected' : '') + '>' + esc(t('p_unspecified')) + '</option>' : '') +
                '</select></label>' +
                '<span class="babel-showing">' + esc(t('shown')) + ': ' + visible.length + ' ' + esc(t('of')) + ' ' + total + '</span></div>';

            /* the results themselves */
            html += '<div class="babel-results">' + (visible.length ? visible.map(resultHtml).join('') : '<div class="babel-empty">0 ' + esc(t('results')) + '</div>') + '</div>';
        }

        /* exports + provenance note */
        html += '<div class="babel-exportbar"><span class="babel-period-note">' + esc(t('periodNote')) + '</span>' +
            '<button type="button" id="babelExportJson">↓ ' + esc(t('exportJson')) + '</button>' +
            '<button type="button" id="babelExportCsv">↓ ' + esc(t('exportCsv')) + '</button></div>' +
            '<p class="babel-footer-meta">' + esc(t('generated')) + ': ' + esc(s.generatedAt) + '</p>';

        document.getElementById('babelBody').innerHTML = html;
        wireResults();
        if (hasCoords && mapAvailable) mountMap();
    }

    function wireResults() {
        var el;
        el = document.getElementById('babelNew'); if (el) el.onclick = function () { cachedAt = null; renderForm(lastQuery); };
        el = document.getElementById('babelRefresh'); if (el) el.onclick = function () { run(lastQuery, { bypassCache: true }); };
        el = document.getElementById('babelExportJson'); if (el) el.onclick = function () { download(slug(lastQuery) + '.json', buildJsonExport(), 'application/json;charset=utf-8'); };
        el = document.getElementById('babelExportCsv'); if (el) el.onclick = function () { download(slug(lastQuery) + '.csv', buildCsvExport(), 'text/csv;charset=utf-8'); };
        Array.prototype.forEach.call(document.querySelectorAll('.babel-pick'), function (btn) {
            btn.onclick = function () { run(btn.getAttribute('data-query'), { bypassCache: true }); };
        });
        Array.prototype.forEach.call(document.querySelectorAll('#babelChips .babel-chip'), function (btn) {
            btn.onclick = function () {
                var id = btn.getAttribute('data-source');
                uiFilters.source = (uiFilters.source === id) ? 'all' : id;
                renderResults();
            };
        });
        Array.prototype.forEach.call(document.querySelectorAll('.babel-timeline-strip button'), function (btn) {
            btn.onclick = function () {
                var p = btn.getAttribute('data-period');
                uiFilters.period = (uiFilters.period === p) ? 'all' : p;
                renderResults();
            };
        });
        var tf = document.getElementById('babelTypeFilter');
        if (tf) tf.onchange = function () { uiFilters.type = tf.value; renderResults(); };
        var pf = document.getElementById('babelPeriodFilter');
        if (pf) pf.onchange = function () { uiFilters.period = pf.value; renderResults(); };
    }

    /* Leaflet mini-map with every geolocated finding (extension idea). */
    function mountMap() {
        var host = document.getElementById('babelMap');
        if (!host) return;
        var pts = (lastAgg || []).filter(function (r) { return r.coords; }).slice(0, 60);
        if (!pts.length) return;
        try {
            var map = window.L.map(host, { scrollWheelZoom: false, zoomControl: true });
            window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
            var latlngs = [];
            pts.forEach(function (r) {
                var ll = [r.coords.lat, r.coords.lng];
                latlngs.push(ll);
                window.L.circleMarker(ll, { radius: 7, color: '#d3a35d', weight: 2, fillColor: '#8a5a20', fillOpacity: 0.85 })
                    .addTo(map).bindPopup('<b>' + esc(r.title) + '</b><br><small>' + esc((r.sources || []).map(function (s) { return t('src_' + s.id); }).join(' · ')) + '</small>');
            });
            map.fitBounds(latlngs, { padding: [18, 18], maxZoom: 13 });
            setTimeout(function () { try { map.invalidateSize(); } catch (_) { } }, 80);
            mapRef = map;
        } catch (_) { /* leaflet missing or container hidden */ }
    }

    /* ── exports (JSON / CSV) over the CURRENTLY FILTERED results ── */
    function exportRows() {
        return filteredResults().map(function (r) {
            return {
                titlu: r.title,
                descriere: r.description,
                tip: r.typeKey ? t(r.typeKey) : t('type_' + r.type),
                sursa: (r.sources || []).map(function (s) { return t('src_' + s.id) + (s.lang ? ' (' + s.lang + ')' : ''); }).join(' + '),
                perioade: (r.periods || []).map(function (p) { return t('p_' + p); }).join(', '),
                an: r.year || '',
                coordonate: r.coords ? (r.coords.lat + ', ' + r.coords.lng) : '',
                url: r.url
            };
        });
    }
    function buildJsonExport() {
        return JSON.stringify({
            query: lastQuery, language: lang(), generatedAt: lastStats && lastStats.generatedAt,
            stats: {
                total: lastStats.total, activeSources: lastStats.active + '/7',
                duplicatesRemoved: lastStats.duplicatesRemoved, durationMs: lastStats.durationMs,
                sources: lastStats.sources.map(function (s) { return { source: s.id, status: s.status, results: s.count }; })
            },
            results: exportRows()
        }, null, 2);
    }
    function buildCsvExport() {
        var rows = exportRows();
        var cols = ['titlu', 'descriere', 'tip', 'sursa', 'perioade', 'an', 'coordonate', 'url'];
        var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
        return '\uFEFF' + [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); })).join('\r\n');
    }

    function download(name, content, mime) {
        var u = URL.createObjectURL(new Blob([content], { type: mime }));
        var a = document.createElement('a');
        a.href = u; a.download = 'detectlab-babel-' + name; a.click();
        setTimeout(function () { URL.revokeObjectURL(u); }, 1000);
    }

    /* ════════════════════════ flow control ════════════════════════ */

    /* every source down, or an unexpected crash → named error + retry */
    function renderError() {
        runState = 'error';
        destroyMap();
        var allFailed = lastError && lastError.allFailed;
        document.getElementById('babelBody').innerHTML =
            '<div class="babel-state"><p>' + esc(allFailed ? t('allSourcesFailed') : t('failed')) + '</p>' +
            (!allFailed && lastError && lastError.message ? '<small>' + esc(lastError.message) + '</small>' : '') +
            '<button type="button" class="babel-retry" id="babelRetry">' + esc(t('retry')) + '</button>' +
            '<button type="button" class="babel-retry secondary" id="babelRetryForm">' + esc(t('newSearch')) + '</button></div>';
        var rb = document.getElementById('babelRetry');
        if (rb) rb.onclick = function () { run(lastError && lastError.query || lastQuery, { bypassCache: true }); };
        var rf = document.getElementById('babelRetryForm');
        if (rf) rf.onclick = function () { renderForm(lastQuery || ''); };
    }

    async function run(query, opts) {
        query = String(query || '').trim();
        if (!query || running) return;
        opts = opts || {};
        formValues.query = query;
        uiFilters = { type: 'all', period: 'all', source: 'all' };
        cachedAt = null;
        lastError = null;
        var lg = lang(), seq = ++searchSeq;
        running = true; updateButton(); open();

        /* cache hit? (30 min TTL, bypass with opts.bypassCache) */
        if (!opts.bypassCache) {
            var hit = cacheGet(query, lg);
            if (hit) {
                lastQuery = query; lastAgg = hit.data.agg; lastStats = hit.data.stats; cachedAt = hit.ts;
                running = false; updateButton(); renderResults(); return;
            }
        }

        sourceStatuses = {};
        SOURCE_ORDER.forEach(function (id) { sourceStatuses[id] = { id: id, status: 'pending' }; });
        renderSearching();
        try {
            var out = await searchAll(query, lg, europeanaKey(), seq, chipUpdate);
            if (seq !== searchSeq) return; /* superseded by a newer search */
            var agg = aggregate(out.perSource, out.durationMs);
            var stats = buildStats(query, out.perSource, agg);
            lastQuery = query; lastAgg = agg.results; lastStats = stats;

            if (stats.active === 0) {
                /* every source failed — say it plainly and offer a retry */
                lastError = { allFailed: true, query: query };
                renderError();
                return;
            }
            cacheSet(query, lg, { agg: agg.results, stats: stats });
            renderResults();
        } catch (e) {
            if (seq !== searchSeq) return;
            lastError = { message: (e && e.message) || '', query: query };
            renderError();
        } finally {
            if (seq === searchSeq) { running = false; updateButton(); }
        }
    }

    function begin() {
        if (running) return;
        if (!isPremium()) { if (typeof window.openPremiumModal === 'function') window.openPremiumModal(); return; }
        open();
        renderForm(lastQuery || formValues.query);
    }

    function apply() {
        var title = document.getElementById('babelModalTitle'), sub = document.getElementById('babelScrollSubtitle'), closeBtn = document.getElementById('babelClose'), scrollTitle = document.getElementById('babelScrollTitle');
        if (title) title.textContent = t('title');
        if (scrollTitle) scrollTitle.textContent = t('title');
        if (sub) sub.textContent = t('subtitle');
        if (closeBtn) closeBtn.setAttribute('aria-label', t('close'));
        var m = document.getElementById('babelModal');
        if (m && !m.hidden) {
            if (runState === 'error') renderError();
            else if (runState === 'results' && lastStats) renderResults();
            else if (runState === 'searching') renderSearching();
            else renderForm(lastQuery || formValues.query);
        }
        updateButton();
    }

    function init() {
        var b = document.getElementById('babelSearchBtn'), x = document.getElementById('babelClose'), m = document.getElementById('babelModal');
        if (!b || !m) return;
        b.onclick = begin; x.onclick = close; m.onclick = function (e) { if (e.target === m) close(); };
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !m.hidden) close(); });
        var old = window.setLang; if (typeof old === 'function') window.setLang = function (v) { old(v); apply(); };
        apply();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    /* Public surface — research() drives the tests; _noThrottle() speeds them up. */
    window.DetectLabEvidenceEngine = {
        open: begin, close: close, research: run,
        _noThrottle: function () { NOMINATIM_MIN_INTERVAL = 0; },
        _export: { json: buildJsonExport, csv: buildCsvExport, rows: exportRows },
        _filters: function () { return uiFilters; }
    };
})();
