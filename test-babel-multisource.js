#!/usr/bin/env node
'use strict';

// End-to-end contract test of the multi-source archaeological search agent:
// realistic responses from all 7 APIs (stubbed fetch) → the real frontend
// module (stubbed DOM) → aggregation, de-duplication, per-source provenance,
// automatic period classification, statistics, filters and JSON/CSV exports.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;

/* ── fixtures shaped exactly like the live APIs answer ── */

const wikiRo = {
    query: { search: [
        { title: 'Ulpia Traiana Sarmizegetusa', snippet: '<span class="searchmatch">Ulpia Traiana</span> a fost capitala și cel mai mare oraș al provinciei romane <span class="searchmatch">Dacia</span>.', timestamp: '2026-03-11T07:20:04Z' },
        { title: 'Sarmizegetusa Regia', snippet: '<span class="searchmatch">Sarmizegetusa Regia</span> a fost capitala statului dac, cetate dacică din epoca fierului din Munții Orăștiei.', timestamp: '2026-06-10T16:57:39Z' },
        { title: 'Sarmizegetusa', snippet: '<span class="searchmatch">Sarmizegetusa</span> se poate referi la mai multe localități și situri arheologice din județul Hunedoara.', timestamp: '2025-02-24T15:00:54Z' }
    ] }
};
const wikiEn = {
    query: { search: [
        { title: 'Ulpia Traiana Sarmizegetusa', snippet: '<b>Ulpia Traiana Sarmizegetusa</b> was the capital and largest city of the Roman province of Dacia.', timestamp: '2026-01-01T00:00:00Z' },
        { title: 'Sarmizegetusa Regia', snippet: 'Sarmizegetusa Regia was the capital of the Dacian kingdom, in the Orăștie Mountains of Romania.', timestamp: '2026-01-02T00:00:00Z' }
    ] }
};
const wikidata = {
    results: { bindings: [
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q2671791' }, itemLabel: { value: 'Ulpia Traiana Sarmizegetusa' }, itemDescription: { value: 'așezare romană antică' }, coord: { datatype: 'wkt', value: 'Point(22.7881 45.5158)' } },
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q2671791' }, itemLabel: { value: 'Ulpia Traiana Sarmizegetusa' }, itemDescription: { value: 'așezare romană antică' }, coord: { datatype: 'wkt', value: 'Point(22.787654 45.517354)' } },
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q739802' }, itemLabel: { value: 'Sarmizegetusa Regia' }, itemDescription: { value: 'capitala Daciei' }, coord: { datatype: 'wkt', value: 'Point(23.31027778 45.62277778)' } },
        { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q123456' }, itemLabel: { value: 'Cetatea dacică de la Bănița' }, itemDescription: { value: 'cetate dacică din Munții Orăștiei, România' }, coord: { datatype: 'wkt', value: 'Point(23.15 45.53)' } }
    ] }
};
const nominatim = [
    { place_id: 1, osm_type: 'relation', osm_id: 10630982, lat: '45.5155', lon: '22.7848', category: 'boundary', type: 'administrative', name: 'Sarmizegetusa', display_name: 'Sarmizegetusa, Hunedoara, România', addresstype: 'village' },
    { place_id: 2, osm_type: 'node', osm_id: 999, lat: '45.6227', lon: '23.3102', category: 'historic', type: 'archaeological_site', name: 'Sarmizegetusa Regia', display_name: 'Sarmizegetusa Regia, Grădiștea de Munte, Hunedoara, România', addresstype: 'archaeological_site' }
];
const commons = {
    query: { pages: {
        101: { pageid: 101, ns: 6, title: 'File:Ulpia Traiana Sarmizegetusa amphitheatre.jpg', index: 1, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/ulpia.jpg/320px-ulpia.jpg', url: 'https://upload.wikimedia.org/wikipedia/commons/a/a1/ulpia.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ulpia_Traiana_Sarmizegetusa_amphitheatre.jpg', mime: 'image/jpeg', extmetadata: { ImageDescription: { value: 'Amphitheatre of the Roman city Ulpia Traiana' }, Artist: { value: 'Pudelek' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, Categories: { value: 'Ulpia Traiana Sarmizegetusa' } } }] },
        102: { pageid: 102, ns: 6, title: 'File:Harta castrelor romane din Dacia.svg', index: 2, imageinfo: [{ thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/harta.png/320px-harta.png', url: 'https://upload.wikimedia.org/wikipedia/commons/b/b2/harta.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Harta_castrelor_romane_din_Dacia.svg', mime: 'image/svg+xml', extmetadata: { ImageDescription: { value: 'Hartă a castrelor romane din Dacia' }, Artist: { value: 'Autor' }, LicenseShortName: { value: 'CC0' } } }] }
    } }
};
const dbpedia = {
    docs: [
        { label: ['Ulpia Traiana Sarmizegetusa</B>'], comment: ['Colonia Ulpia Traiana Augusta Dacica Sarmizegetusa was the capital and largest city of Roman Dacia.'], resource: ['http://dbpedia.org/resource/Ulpia_Traiana_Sarmizegetusa'], category: ['http://dbpedia.org/resource/Category:Archaeological_sites_in_Romania'] },
        { label: ['Sarmizegetusa Regia</B>'], comment: ['Sarmizegetusa Regia, the Dacian capital, is an archaeological site in Romania.'], resource: ['http://dbpedia.org/resource/Sarmizegetusa_Regia'], category: ['http://dbpedia.org/resource/Category:Dacian_fortresses'] },
        { label: ['Sarmizegetusa</B>'], comment: ['disambiguation page'], resource: ['http://de.dbpedia.org/resource/Sarmizegetusa'] }
    ]
};
const archive = {
    response: { numFound: 2, docs: [
        { identifier: 'cu31924029544785', title: 'Castrul roman de la Apulum', description: 'Studiu asupra castrului legiunii XIII Gemina de la Apulum.', year: 1930, mediatype: 'texts' },
        { identifier: 'sarmizegetusa-photos', title: 'Sarmizegetusa photographs collection', mediatype: 'collection' }
    ] }
};
const europeana = {
    itemsFound: 2, items: [
        { id: '/2048008/10374', title: ['Amphora from Ulpia Traiana'], edmDataProvider: ['Muzeul Național de Istorie a României'], edmType: 'IMAGE' },
        { id: '/abc/2', title: ['Roman coin hoard'], edmDataProvider: ['Europeana 280'], edmType: 'TEXT' }
    ]
};

function route(url) {
    if (url.includes('ro.wikipedia.org')) return wikiRo;
    if (url.includes('en.wikipedia.org')) return wikiEn;
    if (url.includes('query.wikidata.org')) return wikidata;
    if (url.includes('nominatim.openstreetmap.org')) return nominatim;
    if (url.includes('commons.wikimedia.org')) return commons;
    if (url.includes('lookup.dbpedia.org')) return dbpedia;
    if (url.includes('archive.org')) return archive;
    if (url.includes('europeana.eu')) return europeana;
    throw new Error('unexpected URL: ' + url);
}

function loadEngine() {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, { id, innerHTML: '', hidden: true, textContent: '', disabled: false, onclick: null, onchange: null, value: '', title: '', className: '', setAttribute() {}, getAttribute() { return null; }, focus() {}, classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    let currentLangCode = 'ro';
    const store = { 'babel.europeanaKey': 'TESTKEY' };
    const sandbox = {
        console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON,
        Blob: class {}, Object, Array, String, Number, Promise, Error, RegExp, Math,
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        window: null,
        document: {
            readyState: 'complete',
            getElementById: element,
            querySelectorAll: () => [],
            createElement: () => ({ click() {}, set href(v) {}, href: '', set download(v) {}, download: '' }),
            addEventListener() {}, body: { classList: { add() {}, remove() {} } }
        },
        fetch: (u) => Promise.resolve({ ok: true, status: 200, json: async () => route(String(u)) })
    };
    sandbox.window = sandbox;
    sandbox.window._currentLang = () => currentLangCode;
    sandbox.setLang = (v) => { currentLangCode = v; };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/library-of-babel.js'), 'utf8'), sandbox);
    sandbox.window.DetectLabEvidenceEngine._noThrottle();
    return { sandbox, body: () => element('babelBody').innerHTML, element, setLang: (v) => { currentLangCode = v; } };
}

(async () => {
    const app = loadEngine();
    await app.sandbox.window.DetectLabEvidenceEngine.research('Sarmizegetusa');
    const html = app.body();
    const E = app.element;

    /* ── STATISTICĂ: total results, active sources, duplicates removed ── */
    assert.ok(/„Sarmizegetusa”/.test(html), 'the head repeats the query');
    assert.ok(/<b>10<\/b>\s*rezultate/.test(html), `10 aggregated results (got: ${html.match(/<b>(\d+)<\/b>\s*rezultate/)})`);
    assert.ok(/<b>7\/7<\/b>\s*surse active/.test(html), 'all 7 sources answered');
    assert.ok(/<b>6<\/b>\s*duplicate eliminate/.test(html), '6 duplicates removed by cross-source merging (16 raw → 10)');

    /* ── per-source status chips with counts ── */
    assert.ok(/Wikipedia <b>3<\/b>/.test(html), 'Wikipedia chip reports 3 unique articles (ro+en merged)');
    assert.ok(/Wikidata <b>3<\/b>/.test(html), 'Wikidata chip reports 3 entities (Q2671791 deduplicated)');
    assert.ok(/OpenStreetMap <b>2<\/b>/.test(html), 'OSM chip reports 2 places');
    assert.ok(/Archive\.org <b>2<\/b>/.test(html), 'Archive.org chip reports 2 documents');
    assert.ok(/Europeana <b>2<\/b>/.test(html), 'Europeana chip reports 2 objects');

    /* ── aggregation + dedup: one card per finding, multi-source provenance ── */
    const titles = [...html.matchAll(/<h3><a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.strictEqual(titles.filter((x) => x === 'Ulpia Traiana Sarmizegetusa').length, 1, 'Ulpia Traiana appears exactly once (ro + en + Wikidata + DBpedia merged)');
    assert.strictEqual(titles[0], 'Sarmizegetusa Regia', 'the 4-source finding ranks first');
    assert.ok(/>4 surse<\/em>/.test(html), 'a 4-source merge shows its source count');
    assert.ok(/>3 surse<\/em>/.test(html), 'a 3-source merge shows its source count');
    assert.ok(/>Wikidata<\/a>/.test(html) && />DBpedia<\/a>/.test(html) && />Wikipedia \(RO\)<\/a>/.test(html), 'merged cards link every contributing source');

    /* ── FORMAT OUTPUT: TITLU ✓ / TIP ✓ / SURSĂ ✓ / DESCRIERE (50–150 chars) ── */
    assert.ok(/>Articol Wikipedia</.test(html), 'TIP: Wikipedia article badge');
    assert.ok(/>Locație OSM</.test(html), 'TIP: OSM location badge');
    assert.ok(/>Hartă</.test(html), 'TIP: map badge (SVG from Commons)');
    assert.ok(/>Imagine</.test(html), 'TIP: image badge');
    assert.ok(/>Dată SPARQL</.test(html), 'TIP: Wikidata SPARQL badge');
    const descs = [...html.matchAll(/<h3><a[\s\S]*?<\/h3>\s*<p>([^<]+)<\/p>/g)].map((m) => m[1]);
    assert.ok(descs.length >= 5, 'descriptions are rendered under every title');
    assert.ok(descs.every((d) => d.length <= 150), 'descriptions never exceed the 150-character window');

    /* ── automatic period classification ── */
    assert.ok(/<span>Roman<\/span>/.test(html), 'Roman period tag present');
    assert.ok(/<span>Dacic<\/span>/.test(html), 'Dacian period tag present');
    assert.ok(/<span>Epoca fierului<\/span>/.test(html), 'Iron Age period tag present');
    assert.ok(/babel-timeline/.test(html), 'the timeline strip is rendered');

    /* ── LOCaȚIE AMBIGUĂ: both OSM matches offered as refinements ── */
    assert.ok(/LOCAȚIE AMBIGUĂ/.test(html), 'ambiguity banner shown for 2 OSM matches');
    assert.ok(/data-query="Sarmizegetusa Regia"/.test(html) && /data-query="Sarmizegetusa"/.test(html), 'each OSM match offers a refined search');

    /* ── optional filters ── */
    assert.ok(/id="babelTypeFilter"/.test(html), 'type filter present');
    assert.ok(/id="babelPeriodFilter"/.test(html), 'period filter present');
    assert.ok(/Afișate: 10 din 10/.test(html), 'unfiltered view shows all 10');

    /* ── type filter: images only (Commons photo + Europeana IMAGE) ── */
    E('babelTypeFilter').value = 'image';
    E('babelTypeFilter').onchange();
    assert.ok(/Afișate: 2 din 10/.test(app.body()), 'image filter narrows to 2 results');
    E('babelTypeFilter').value = 'all';
    E('babelTypeFilter').onchange();

    /* ── period filter: Roman ── */
    E('babelPeriodFilter').value = 'roman';
    E('babelPeriodFilter').onchange();
    assert.ok(/Afișate: 6 din 10/.test(app.body()), 'Roman period filter narrows to 6 results');
    E('babelPeriodFilter').value = 'all';
    E('babelPeriodFilter').onchange();

    /* ── exports (JSON / CSV) ── */
    const json = JSON.parse(app.sandbox.window.DetectLabEvidenceEngine._export.json());
    assert.strictEqual(json.results.length, 10, 'JSON export contains all 10 aggregated results');
    assert.strictEqual(json.stats.activeSources, '7/7', 'JSON export carries the source statistics');
    for (const field of ['titlu', 'descriere', 'tip', 'sursa', 'perioade', 'url']) {
        assert.ok(field in json.results[0], `JSON export row has field ${field}`);
    }
    const csv = app.sandbox.window.DetectLabEvidenceEngine._export.csv();
    const lines = csv.split('\r\n');
    assert.strictEqual(lines.length, 11, 'CSV export = header + 10 rows');
    assert.ok(csv.startsWith('\uFEFFtitlu,descriere,tip,sursa,perioade'), 'CSV starts with a BOM and the header row');
    assert.ok(csv.includes('"Castrul roman de la Apulum"'), 'CSV contains a quoted title');
    assert.ok(csv.includes('1930'), 'CSV carries the archive.org year');

    /* ── EN variant renders the same data in English ── */
    app.sandbox.window.setLang('en'); // the module re-renders the open modal
    const htmlEn = app.body();
    assert.ok(/10<\/b>\s*results/.test(htmlEn), 'EN: statistics rendered in English');
    assert.ok(/>Wikipedia article</.test(htmlEn), 'EN: type badge translated');
    assert.ok(/>SPARQL data</.test(htmlEn), 'EN: Wikidata type label translated');
    assert.ok(/AMBIGUOUS LOCATION/.test(htmlEn), 'EN: ambiguity banner translated');
    const jsonEn = JSON.parse(app.sandbox.window.DetectLabEvidenceEngine._export.json());
    assert.strictEqual(jsonEn.language, 'en', 'EN: export metadata switches language');

    console.log('✓ Biblioteca din Babel multi-source aggregation tests passed');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
