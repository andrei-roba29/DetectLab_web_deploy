#!/usr/bin/env node
'use strict';

// Regression test for the "Miluani, Sălaj" complaints:
//   1. the search resolves the locality through the OSM gazetteer and shows
//      the canonical name + county (județ) in the results header;
//   2. fuzzy noise that never mentions the locality ("Miljan Miljanić") is
//      removed by the relevance guard;
//   3. the archaeological sites AROUND the locality actually appear — the
//      CIMEC/RAN source searches the heritage layers spatially around the
//      locality's coordinates and reports the distance to each site;
//   4. the text sources are queried with the locality as an exact phrase.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;

/* Miluani, comuna Hida, județul Sălaj (approximate fixture coordinates). */
const MILUANI = { lat: 47.083, lon: 23.283 };

const wikiRo = {
    query: { search: [
        { title: 'Miluani, Sălaj', snippet: 'Sat în comuna Hida, județul Sălaj, atestat documentar în evul mediu.', timestamp: '2026-01-01T00:00:00Z' },
        /* the fuzzy-noise specimen from the bug report */
        { title: 'Miljan Miljanić', snippet: 'Antrenor iugoslav de fotbal, activ în epoca modernă la Real Madrid.', timestamp: '2026-01-02T00:00:00Z' }
    ] }
};
const empties = {
    wiki: { query: { search: [] } },
    wd: { results: { bindings: [] } },
    commons: { query: { pages: {} } },
    dbpedia: { docs: [] },
    archive: { response: { docs: [] } },
    europeana: { items: [] }
};

/* Heritage layers as the map page loads them (window._localLayerData):
 * two sites next to Miluani, one 200 km away that must NOT appear. */
function nearbyPoint(dLat, dLng) {
    return { lat: MILUANI.lat + dLat, lng: MILUANI.lon + dLng };
}
const LOCAL_LAYERS = {
    0: { type: 'FeatureCollection', features: [] },
    5: { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [nearbyPoint(0.018, 0).lng, nearbyPoint(0.018, 0).lat] }, properties: { Tip: 'Așezare', Eticheta: 'Așezarea dacică de la Miluani', Judet: 'Sălaj', Comuna: 'Hida' } }
    ] },
    6: { type: 'FeatureCollection', features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [MILUANI.lon + 0.03, MILUANI.lat] }, properties: { Nume: 'Tumulii de la Sânpetru Almașului', CodRAN: '142310.02', Localitate: 'Sânpetru Almașului', Judet: 'Sălaj' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [21.2, 45.7] }, properties: { Nume: 'Sit îndepărtat', CodRAN: '999999.01', Localitate: 'Departe', Judet: 'Timiș' } }
    ] }
};

function loadEngine() {
    const elements = new Map();
    const element = (id) => {
        if (!elements.has(id)) elements.set(id, { id, innerHTML: '', hidden: true, textContent: '', disabled: false, onclick: null, onchange: null, value: '', title: '', className: '', setAttribute() {}, getAttribute() { return null; }, focus() {}, classList: { add() {}, remove() {} } });
        return elements.get(id);
    };
    const fetched = [];
    const sandbox = {
        console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date, JSON,
        Blob: class {}, Object, Array, String, Number, Promise, Error, RegExp, Math,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        window: null,
        document: {
            readyState: 'complete',
            getElementById: element,
            querySelectorAll: () => [],
            createElement: () => ({ click() {}, href: '', download: '' }),
            addEventListener() {}, body: { classList: { add() {}, remove() {} } },
            head: { appendChild() {}, removeChild() {} }
        },
        fetch: (u) => {
            const url = String(u);
            fetched.push(url);
            if (url.includes('wikipedia.org')) return Promise.resolve({ ok: true, status: 200, json: async () => (url.includes('ro.wikipedia') ? wikiRo : empties.wiki) });
            if (url.includes('query.wikidata.org')) return Promise.resolve({ ok: true, status: 200, json: async () => empties.wd });
            if (url.includes('commons')) return Promise.resolve({ ok: true, status: 200, json: async () => empties.commons });
            if (url.includes('dbpedia')) return Promise.resolve({ ok: true, status: 200, json: async () => empties.dbpedia });
            if (url.includes('archive.org')) return Promise.resolve({ ok: true, status: 200, json: async () => empties.archive });
            if (url.includes('europeana')) return Promise.resolve({ ok: true, status: 200, json: async () => empties.europeana });
            if (url.includes('nominatim')) throw new Error('Nominatim must not be called when the OSM gazetteer resolves the locality');
            throw new Error('unexpected URL ' + url);
        }
    };
    sandbox.window = sandbox;
    sandbox.window._currentLang = () => 'ro';
    /* the map search bar's gazetteer — resolves name + county + coordinates */
    sandbox.window._osmPlaceLookup = (term) => {
        const t = String(term).toLowerCase();
        if (t.startsWith('miluani')) {
            return Promise.resolve([{ lat: MILUANI.lat, lon: MILUANI.lon, display_name: 'Miluani', fclass: 'village', judet: 'Sălaj', population: 300 }]);
        }
        return Promise.resolve([]);
    };
    /* heritage layers already loaded by the map page */
    sandbox.window._localLayerData = LOCAL_LAYERS;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/library-of-babel.js'), 'utf8'), sandbox);
    sandbox.window.DetectLabEvidenceEngine._noThrottle();
    return { sandbox, body: () => element('babelBody').innerHTML, fetched };
}

(async () => {
    const app = loadEngine();
    const engine = app.sandbox.window.DetectLabEvidenceEngine;

    /* ── locality resolution: name + județ + coordinates from OSM ── */
    const loc = await engine._resolveLocality('Miluani, Salaj');
    assert.ok(loc, 'the locality resolves through the OSM gazetteer');
    assert.strictEqual(loc.name, 'Miluani', 'canonical locality name');
    assert.strictEqual(loc.judet, 'Sălaj', 'the county (județ) is picked up');
    assert.ok(Math.abs(loc.lat - MILUANI.lat) < 1e-6 && Math.abs(loc.lon - MILUANI.lon) < 1e-6, 'coordinates are picked up');

    await engine.research('Miluani, Salaj');
    const html = app.body();

    /* ── 1: header shows the resolved locality + county ── */
    assert.ok(/babel-locality/.test(html), 'the locality line is rendered');
    assert.ok(/<b>Miluani<\/b>/.test(html), 'the canonical locality name is shown');
    assert.ok(/jud\. Sălaj/.test(html), 'the county is shown next to the locality');

    /* ── 2: fuzzy noise is gone, real article stays ── */
    assert.ok(/Miluani, Sălaj/.test(html), 'the genuine Wikipedia article is kept');
    assert.ok(!/Miljan Miljanić/.test(html), '"Miljan Miljanić" is removed by the relevance guard');
    assert.ok(/<b>1<\/b>\s*irelevante eliminate/.test(html), 'the removal is disclosed in the statistics');

    /* ── 3: the sites around the locality appear, with distances ── */
    assert.ok(/Așezarea dacică de la Miluani/.test(html), 'a nearby layer-5 site is listed');
    assert.ok(/Tumulii de la Sânpetru Almașului/.test(html), 'a nearby layer-6 site (other village) is listed');
    assert.ok(/ran\.cimec\.ro\/sel\.asp\?codran=142310\.02/.test(html), 'the RAN record is linked');
    assert.ok(/~2\.0 km|~2,0 km/.test(html), 'the distance to the locality is reported');
    assert.ok(!/Sit îndepărtat/.test(html), 'a site 200 km away is NOT listed');

    /* ── 4: text sources receive the locality as an exact phrase ── */
    const wikiUrl = app.fetched.find((u) => u.includes('ro.wikipedia.org'));
    assert.ok(wikiUrl && decodeURIComponent(wikiUrl).includes('"Miluani"'), 'Wikipedia is queried with the exact phrase "Miluani"');
    const archiveUrl = app.fetched.find((u) => u.includes('archive.org'));
    assert.ok(archiveUrl && decodeURIComponent(archiveUrl.replace(/\+/g, ' ')).includes('"Miluani"'), 'Archive.org is queried with the exact phrase "Miluani"');

    console.log('✓ Biblioteca din Babel locality + nearby-sites tests passed');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
