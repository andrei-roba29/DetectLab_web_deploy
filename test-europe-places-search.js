#!/usr/bin/env node
'use strict';

// Regression test: cu o țară non-RO selectată pe glob, bara de search trebuie
// să găsească localitățile ACELEI țări din europe-places.geojsonseq (Supabase),
// stream-uit și filtrat pe țară; România rămâne pe OSM.geojson. Rulează codul
// REAL din js/map-app.js (extras prin regex, ca test-osm-manual-places.js)
// într-un context curat, cu fetch controlat.
// Usage: node test-europe-places-search.js

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

console.log('[Test] Europe places search (europe-places.geojsonseq)...');

const mapSource = fs.readFileSync('js/map-app.js', 'utf8');

function grab(re, what) {
    const m = mapSource.match(re);
    assert(m, 'map-app.js should still contain ' + what);
    return m[0];
}

// ── bucăți existente (aceleași ca în test-osm-manual-places.js) ──
const PICK = grab(/function _pickOsmProp\(props, candidates\) \{[\s\S]*?\n {12}\}/, '_pickOsmProp');
const NORM = grab(/function normalizeRoDiacritics\(str\) \{[\s\S]*?\n {12}\}/, 'normalizeRoDiacritics');
const SPLIT = grab(/function splitLocalityQuery\(term\) \{[\s\S]*?\n {12}\}/, 'splitLocalityQuery');
const LOOKUP = grab(/function osmPlaceLookup\(term, limit\) \{[\s\S]*?\n {12}\}\n/, 'osmPlaceLookup');
const LIST = grab(/var OSM_MANUAL_PLACES = \[[\s\S]*?\n {12}\];/, 'OSM_MANUAL_PLACES');
const ANNOTATE = grab(/function _annotateOsmFeature\(feat\) \{[\s\S]*?\n {12}\}/, '_annotateOsmFeature');
const MANUAL = grab(/function _manualOsmFeatures\(\) \{[\s\S]*?\n {12}\}/, '_manualOsmFeatures');
const MERGE = grab(/function _mergeManualPlaces\(feats\) \{[\s\S]*?\n {12}\}/, '_mergeManualPlaces');
const LOAD = grab(/function loadOsmGeojson\(\) \{[\s\S]*?\n {12}\}/, 'loadOsmGeojson');

// ── bucățile noi pentru setul european ──
const EU_URL = grab(/var EUROPE_PLACES_URL = '[^']+';/, 'EUROPE_PLACES_URL');
const EU_MAX = grab(/var EUROPE_PLACES_MAX = \d+;/, 'EUROPE_PLACES_MAX');
const EU_TOKENS = grab(/var EU_COUNTRY_TOKENS = \{[\s\S]*?\n {12}\};/, 'EU_COUNTRY_TOKENS');
const EU_TOKMAP = grab(/var _euTokenToIso = \{\};[\s\S]*?\n {12}\}\);/, '_euTokenToIso builder');
const EU_FOLD = grab(/function _euFold\(s\) \{[\s\S]*?\n {12}\}/, '_euFold');
const EU_RESOLVE = grab(/function _euResolveCountryToken\(value\) \{[\s\S]*?\n {12}\}/, '_euResolveCountryToken');
const EU_PROPS = grab(/var _EU_COUNTRY_PROPS = \[[\s\S]*?\];/, '_EU_COUNTRY_PROPS');
const EU_ISO = grab(/function _euIsoOfPlaceProps\(props\) \{[\s\S]*?\n {12}\}/, '_euIsoOfPlaceProps');
const EU_POINT = grab(/function _euPlacePoint\(geom\) \{[\s\S]*?\n {12}\}/, '_euPlacePoint');
const EU_PARSE = grab(/function _euParseSeqLine\(line\) \{[\s\S]*?\n {12}\}/, '_euParseSeqLine');
const EU_ACCEPT = grab(/function _euAcceptPlace\(obj, iso, bbox\) \{[\s\S]*?\n {12}\}/, '_euAcceptPlace');
const EU_STREAM = grab(/function _euStreamPlaces\(iso, bbox\) \{[\s\S]*?\n {12}\}/, '_euStreamPlaces');
const EU_LOADP = grab(/function loadEuropePlaces\(iso\) \{[\s\S]*?\n {12}\}/, 'loadEuropePlaces');
const EU_LOOKUP = grab(/function europePlaceLookup\(iso, term, limit\) \{[\s\S]*?\n {12}\}/, 'europePlaceLookup');

// ── fixture: fișierul geojsonseq simulat (mai multe țări, scheme diferite) ──
const RS = '\u001e'; // RFC 8142 record separator
const SEQ_LINES = [
    // Germania — cod ISO2 + diacritice germane
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [11.575, 48.1374] }, properties: { name: 'München', country_code: 'DE', place: 'city', admin1: 'Bayern', population: 1488000 } }),
    RS + JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [11.4257, 48.7636] }, properties: { name: 'München', country_code: 'DE', place: 'village', admin1: 'Bayern', population: 120 } }),
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [13.405, 52.52] }, properties: { name: 'Berlin', country_code: 'DE', place: 'city', admin1: 'Berlin', population: 3645000 } }),
    // Franța — cod ISO3, altă cheie de nume/regiune
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [2.3522, 48.8566] }, properties: { NAME: 'Paris', ISO3: 'FRA', fclass: 'city', adm1_name: 'Île-de-France', POP_MAX: 2140000 } }),
    // Polonia — numele țării ca text + diacritice poloneze
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [19.455, 51.7592] }, properties: { name: 'Łódź', country: 'Poland', type: 'city', region: 'łódzkie', pop: 672000 } }),
    // Fără NICIO proprietate de țară → trebuie să cadă pe bbox-ul țării selectate
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [10.0, 50.5] }, properties: { name: 'Bboxdorf', place: 'hamlet' } }),
    // Poligon (centrul bbox-ului primului inel) în Germania
    JSON.stringify({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[9.9, 49.9], [10.1, 49.9], [10.1, 50.1], [9.9, 50.1], [9.9, 49.9]]] }, properties: { name: 'Polygonia', country: 'Germany', place: 'suburb' } }),
    // România — există și în setul european; nu trebuie să polueze căutarea DE
    JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [26.1025, 44.4268] }, properties: { name: 'București', country_code: 'RO', place: 'city', population: 1716000 } }),
    // gunoaie care nu trebuie să dărâme parserul
    '', '   ', 'not json at all', JSON.stringify({ type: 'Feature', properties: { name: 'NoGeom' } })
];
const SEQ_TEXT = SEQ_LINES.join('\n');

const DE_BBOX = [5.87, 47.27, 15.04, 55.06];

// ── sandbox cu codul real ──
function boot(fetchImpl, selectedIso, selectedBbox) {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        Promise, Math, JSON, Object, Error, Number, String, Array, isFinite, parseFloat,
        fetch: fetchImpl,
        document: { addEventListener() {} }
    };
    sandbox.window = sandbox;
    if (selectedIso) {
        sandbox._detectlabSelectedCountry = selectedIso;
        sandbox._detectlabCountryBounds = selectedBbox || null;
    }
    vm.runInNewContext(
        '(function(){' +
        'var _osmGeojsonFeatures = null; var _osmGeojsonPromise = null;' +
        'var OSM_GEOJSON_URL = "https://example.invalid/OSM.geojson";' +
        PICK + NORM + SPLIT + LIST + ANNOTATE + MANUAL + MERGE + LOAD +
        EU_URL + EU_MAX + 'var _euPlacesByIso = {}; var _euPlacesPromises = {};' +
        EU_TOKENS + EU_TOKMAP + EU_FOLD + EU_RESOLVE + EU_PROPS + EU_ISO +
        EU_POINT + EU_PARSE + EU_ACCEPT + EU_STREAM + EU_LOADP + EU_LOOKUP + LOOKUP +
        'this.osmPlaceLookup = osmPlaceLookup;' +
        'this.europePlaceLookup = europePlaceLookup;' +
        'this.loadEuropePlaces = loadEuropePlaces;' +
        'this._euResolveCountryToken = _euResolveCountryToken;' +
        'this._euIsoOfPlaceProps = _euIsoOfPlaceProps;' +
        'this._euParseSeqLine = _euParseSeqLine;' +
        'this._euAcceptPlace = _euAcceptPlace;' +
        'this._euPlacePoint = _euPlacePoint;' +
        'this._euFold = _euFold;' +
        'this.EUROPE_PLACES_URL = EUROPE_PLACES_URL;' +
        '}).call(this);',
        sandbox
    );
    return sandbox;
}

function seqResponse() {
    return { ok: true, text: () => Promise.resolve(SEQ_TEXT), body: null };
}
function roResponse() {
    return {
        ok: true,
        json: () => Promise.resolve({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [26.1025, 44.4268] }, properties: { name: 'București', fclass: 'city', adm2_name: 'București', population: 1716000 } }]
        })
    };
}
function routedFetch(log) {
    return (url) => {
        log.push(String(url));
        if (String(url).indexOf('europe-places.geojsonseq') !== -1) return Promise.resolve(seqResponse());
        return Promise.resolve(roResponse());
    };
}

(async function () {
    /* ── 1. URL-ul cerut e exact bucketul Supabase ── */
    const app = boot(routedFetch([]), 'DE', DE_BBOX);
    assert.strictEqual(app.EUROPE_PLACES_URL,
        'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/europe-places.geojsonseq',
        'the Supabase europe-places URL is used');
    console.log('  ✓ Supabase europe-places.geojsonseq is the data source');

    /* ── 2. rezolvarea țării: ISO2 / ISO3 / nume ── */
    assert.strictEqual(app._euResolveCountryToken('DE'), 'DE');
    assert.strictEqual(app._euResolveCountryToken('fr'), 'FR');
    assert.strictEqual(app._euResolveCountryToken('FRA'), 'FR');
    assert.strictEqual(app._euResolveCountryToken('Poland'), 'PL');
    assert.strictEqual(app._euResolveCountryToken('United Kingdom'), 'GB');
    assert.strictEqual(app._euResolveCountryToken('Türkiye'), 'TR');
    assert.strictEqual(app._euResolveCountryToken('Atlantis'), null);
    assert.strictEqual(app._euIsoOfPlaceProps({ country_code: 'DE' }), 'DE');
    assert.strictEqual(app._euIsoOfPlaceProps({ ISO3: 'POL' }), 'PL');
    assert.strictEqual(app._euIsoOfPlaceProps({ country: 'Germany' }), 'DE');
    assert.strictEqual(app._euIsoOfPlaceProps({ country: '???', iso_a2: 'IT' }), 'IT',
        'the first RESOLVABLE country property wins');
    assert.strictEqual(app._euIsoOfPlaceProps({ name: 'x' }), null);
    console.log('  ✓ country detection: ISO2, ISO3, names, diacritics');

    /* ── 3. parserul de linii: NDJSON + prefix RS (RFC 8142) + gunoaie ── */
    assert(app._euParseSeqLine(SEQ_LINES[0]), 'plain NDJSON line parses');
    assert(app._euParseSeqLine(SEQ_LINES[1]), 'RS-prefixed line parses');
    assert.strictEqual(app._euParseSeqLine('not json'), null);
    assert.strictEqual(app._euParseSeqLine(''), null);
    assert.strictEqual(app._euParseSeqLine(JSON.stringify({ properties: {} })), null, 'geometry is required');
    console.log('  ✓ GeoJSONSeq/NDJSON line parsing');

    /* ── 4. filtrarea pe țară + fallback bbox + geometrii non-punct ── */
    const munchen = JSON.parse(SEQ_LINES[0]);
    assert(app._euAcceptPlace(munchen, 'DE', DE_BBOX), 'DE feature kept for DE');
    assert.strictEqual(app._euAcceptPlace(JSON.parse(SEQ_LINES[0]), 'FR', null), null, 'DE feature rejected for FR');
    const noCountry = JSON.parse(SEQ_LINES[5]);
    assert(app._euAcceptPlace(JSON.parse(SEQ_LINES[5]), 'DE', DE_BBOX), 'feature without country props falls back to the country bbox');
    assert.strictEqual(app._euAcceptPlace(noCountry, 'DE', null), null, 'without props AND without bbox it cannot be attributed');
    const poly = app._euAcceptPlace(JSON.parse(SEQ_LINES[6]), 'DE', DE_BBOX);
    assert(poly && Math.abs(poly._euLon - 10.0) < 1e-9 && Math.abs(poly._euLat - 50.0) < 1e-9,
        'polygon features use the centre of the first ring bbox');
    console.log('  ✓ per-country filtering with bbox fallback');

    /* ── 5. stream + lookup end-to-end pentru Germania ── */
    let m = await app.europePlaceLookup('DE', 'Munchen', 8);
    assert(m.length >= 2, 'both München entries found');
    assert.strictEqual(m[0].display_name, 'München', 'diacritics-folded match ("Munchen" → "München")');
    assert(m[0].population > m[1].population, 'sorted by population');
    assert.strictEqual(m[0].region, 'Bayern', 'region (admin1) exposed for the result meta');
    assert.strictEqual(m[0].judet, '', 'the RO-only "jud." label is not used for European places');

    m = await app.europePlaceLookup('DE', 'Lodz', 8);
    assert.strictEqual(m.length, 0, 'Polish places never leak into the German set');
    m = await app.europePlaceLookup('DE', 'Bucuresti', 8);
    assert.strictEqual(m.length, 0, 'Romanian places never leak into the German set');
    m = await app.europePlaceLookup('DE', 'Bboxdorf', 8);
    assert.strictEqual(m.length, 1, 'bbox-attributed feature is searchable');
    console.log('  ✓ Germany end-to-end: stream, filter, fold, sort');

    /* ── 6. Polonia: nume de țară ca text + diacritice poloneze ── */
    const appPL = boot(routedFetch([]), 'PL', [14.12, 49.0, 24.15, 54.84]);
    m = await appPL.europePlaceLookup('PL', 'Lodz', 8);
    assert.strictEqual(m.length, 1, '"Lodz" finds "Łódź" (generic diacritic folding)');
    assert.strictEqual(m[0].display_name, 'Łódź');
    m = await appPL.europePlaceLookup('PL', 'Lodz, lodzkie', 8);
    assert.strictEqual(m.length, 1, 'the "Locality, Region" qualifier works for European places');
    console.log('  ✓ Poland: country-name attribution + Łódź folding + qualifier');

    /* ── 7. rutarea din osmPlaceLookup în funcție de țara selectată ── */
    const logDE = [];
    const appDE = boot(routedFetch(logDE), 'DE', DE_BBOX);
    m = await appDE.osmPlaceLookup('Berlin', 8);
    assert.strictEqual(m.length, 1, 'with DE selected, the search bar serves German places');
    assert.strictEqual(m[0].display_name, 'Berlin');
    assert(logDE.some(u => u.indexOf('europe-places.geojsonseq') !== -1), 'the Supabase file was fetched');
    assert(!logDE.some(u => u.indexOf('OSM.geojson') !== -1), 'the Romanian OSM.geojson is not needed for DE');

    const logRO = [];
    const appRO = boot(routedFetch(logRO), 'RO', [19.5, 43.5, 30.5, 48.5]);
    m = await appRO.osmPlaceLookup('Bucuresti', 8);
    assert(m.length >= 1 && m[0].judet === 'București', 'with RO selected, the richer OSM.geojson source still answers');
    assert(logRO.some(u => u.indexOf('OSM.geojson') !== -1), 'OSM.geojson fetched for RO');
    assert(!logRO.some(u => u.indexOf('europe-places') !== -1), 'europe-places not fetched for RO');

    const logNone = [];
    const appNone = boot(routedFetch(logNone), null, null);
    m = await appNone.osmPlaceLookup('Bucuresti', 8);
    assert(m.length >= 1, 'with no country selected the legacy behaviour is intact');
    assert(!logNone.some(u => u.indexOf('europe-places') !== -1), 'europe-places not touched without a selection');
    console.log('  ✓ osmPlaceLookup routing: DE → europe-places, RO/none → OSM.geojson');

    /* ── 8. cache per țară + retry la eșec ── */
    const logCache = [];
    const appC = boot(routedFetch(logCache), 'DE', DE_BBOX);
    await appC.loadEuropePlaces('DE');
    await appC.loadEuropePlaces('DE');
    assert.strictEqual(logCache.length, 1, 'the file is streamed once per country, then cached');
    let failures = 0;
    const appF = boot(() => { failures++; return Promise.reject(new Error('offline')); }, 'FR', null);
    await appF.loadEuropePlaces('FR').catch(() => {});
    await appF.loadEuropePlaces('FR').catch(() => {});
    assert.strictEqual(failures, 2, 'a failed stream is not cached — the next search retries');
    console.log('  ✓ per-country cache + retry after failure');

    /* ── 9. integrarea în shell: versiuni + UI meta ── */
    const indexHtml = fs.readFileSync('index.html', 'utf8');
    assert(indexHtml.includes('js/map-app.js?v=20261008-eu-places-search'), 'index.html loads the re-versioned map-app.js');
    const swJs = fs.readFileSync('sw.js', 'utf8');
    assert(swJs.includes("'js/map-app.js?v=20261008-eu-places-search'"), 'sw.js precaches the new map-app.js version');
    assert(!/['"][^'"\n]*europe-places\.geojsonseq[^'"\n]*['"]/.test(swJs),
        'the big places file itself is NOT precached (comments may mention it)');
    const shellVersion = Number((swJs.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
    assert(shellVersion >= 165, 'sw.js cache must be v165 or newer');
    assert(/var cacheKey = String\(window\._detectlabSelectedCountry \|\| ''\) \+ '\|'/.test(mapSource),
        'the search cache key includes the selected country');
    assert(/item\.region\s*\n?\s*\? item\.region/.test(mapSource) || mapSource.indexOf('item.region + (typeLabel') !== -1,
        'displaySearchResults shows the region for European places');
    console.log('  ✓ shell integration: versions, cache key, result meta');

    console.log('\nAll europe-places search tests passed ✔');
})().catch(function (err) {
    console.error('\n✗ ' + (err && err.message));
    console.error(err && err.stack);
    process.exit(1);
});
