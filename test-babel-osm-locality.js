#!/usr/bin/env node
'use strict';

// Regression test: "Biblioteca din Babel" must find localities exactly like the
// map search bar does — insensitive to Romanian diacritics ("Sacalaseni" →
// "Săcălășeni") and honouring a "Locality, County" qualifier instead of
// searching only for the county.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

/* ── 1. the shared matcher extracted from the search bar (map-app.js) ── */

const mapSource = fs.readFileSync('js/map-app.js', 'utf8');
const norm = mapSource.match(/function normalizeRoDiacritics\(str\) \{[\s\S]*?\n            \}/);
const split = mapSource.match(/function splitLocalityQuery\(term\) \{[\s\S]*?\n            \}/);
const lookup = mapSource.match(/function osmPlaceLookup\(term, limit\) \{[\s\S]*?\n            \}\n/);
assert(norm && split && lookup, 'map-app.js should expose the shared locality matcher');

const FEATURES = [
    { geometry: { coordinates: [23.62, 47.61] }, properties: { name: 'Săcălășeni', fclass: 'village', population: 1200 }, _judet: 'Maramureș' },
    { geometry: { coordinates: [24.0, 47.0] }, properties: { name: 'Baia Mare', fclass: 'city', population: 120000 }, _judet: 'Maramureș' },
    { geometry: { coordinates: [22.78, 45.51] }, properties: { name: 'Sarmizegetusa', fclass: 'village', population: 900 }, _judet: 'Hunedoara' },
    { geometry: { coordinates: [26.1, 44.4] }, properties: { name: 'Săcălășeni', fclass: 'hamlet', population: 30 }, _judet: 'Cluj' }
];

const sandbox = { console, Promise, loadOsmGeojson: () => Promise.resolve(prepared()), window: {} };
vm.runInNewContext(
    '(function(){' + norm[0] + split[0] + lookup[0] +
    'this.normalizeRoDiacritics = normalizeRoDiacritics;' +
    'this.osmPlaceLookup = osmPlaceLookup;}).call(this);',
    sandbox
);

function prepared() {
    return FEATURES.map(function (f) {
        const c = Object.assign({}, f);
        c._lname = (f.properties.name || '').toLowerCase();
        c._lnameNorm = sandbox.normalizeRoDiacritics(c._lname);
        c._ljudet = (f._judet || '').toLowerCase();
        c._ljudetNorm = sandbox.normalizeRoDiacritics(c._ljudet);
        return c;
    });
}

const osmPlaceLookup = sandbox.osmPlaceLookup;

(async function () {
    let m = await osmPlaceLookup('Sacalaseni', 8);
    assert(m.length >= 1, '"Sacalaseni" without diacritics must find "Săcălășeni"');
    assert(m.every(r => r.display_name === 'Săcălășeni'), 'only Săcălășeni entries are returned');

    m = await osmPlaceLookup('Sacalaseni, Maramures', 8);
    assert.strictEqual(m.length, 1, '"Locality, County" narrows down to one locality');
    assert.strictEqual(m[0].display_name, 'Săcălășeni');
    assert.strictEqual(m[0].judet, 'Maramureș', 'the county qualifier filters, it does not replace the name');

    m = await osmPlaceLookup('Sacalaseni, jud. Maramureș', 8);
    assert.strictEqual(m.length, 1, 'the "jud." prefix is tolerated in the qualifier');

    m = await osmPlaceLookup('Maramures', 8);
    assert(m.length >= 2, 'a bare county name still lists its localities (search-bar behaviour)');

    m = await osmPlaceLookup('Sacalaseni, Hunedoara', 8);
    assert.strictEqual(m.length, 0, 'a locality that does not exist in that county yields no false hit');

    /* ── 2. the Babel module must use that matcher, not raw Nominatim ── */

    const babel = fs.readFileSync('js/library-of-babel.js', 'utf8');
    assert(/window\._osmPlaceLookup/.test(babel), 'Babel reuses the search bar locality lookup');
    assert(/function resolveCanonicalQuery/.test(babel), 'Babel resolves the canonical diacritics-correct name');
    assert(
        /\{ id: 'wikipedia', run: function \(\) \{ return sourceWikipedia\(tq\); \} \}/.test(babel),
        'text sources are queried with the canonical spelling'
    );
    assert(
        /\{ id: 'osm', run: function \(\) \{ return sourceOsm\(query, lg\); \} \}/.test(babel),
        'the OSM gazetteer keeps the raw user query'
    );

    /* canonical resolution behaviour, driven through the real module */
    const sandbox2 = {
        console, Promise, setTimeout, clearTimeout, URL, URLSearchParams, Date, JSON, Math,
        fetch: () => Promise.reject(new Error('no network in test')),
        localStorage: { getItem: () => null, setItem: () => { } },
        document: {
            readyState: 'complete',
            getElementById: () => null,
            addEventListener: () => { },
            createElement: () => ({ style: {}, classList: { add() { }, remove() { } }, appendChild() { } }),
            body: { classList: { add() { }, remove() { } } }
        }
    };
    sandbox2.window = sandbox2;
    sandbox2.window._osmPlaceLookup = osmPlaceLookup;
    vm.runInNewContext(babel, sandbox2);
    const engine = sandbox2.window.DetectLabEvidenceEngine;
    assert(engine && engine._resolveCanonicalQuery, 'Babel exposes the canonical resolver');

    assert.strictEqual(
        await engine._resolveCanonicalQuery('Sacalaseni, Maramures'), 'Săcălășeni',
        'the diacritics-correct name is what the text sources get'
    );
    assert.strictEqual(
        await engine._resolveCanonicalQuery('Săcălășeni'), null,
        'an already-canonical query is left untouched'
    );
    assert.strictEqual(
        await engine._resolveCanonicalQuery('Ulpia Traiana'), null,
        'a query with no gazetteer match is left untouched'
    );

    console.log('✓ Biblioteca din Babel locality-matching tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
