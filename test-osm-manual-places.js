#!/usr/bin/env node
'use strict';

// Regression test: localitățile adăugate manual în stratul OSM (OSM_MANUAL_PLACES
// din js/map-app.js) trebuie să ajungă în același set de facilități ca sursa
// remote OSM.geojson — deci să apară și pe layerul „OSM Places”, și în bara de
// search — fără duplicate dacă sursa le conține deja, și chiar și când sursa
// remote nu răspunde.

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const mapSource = fs.readFileSync('js/map-app.js', 'utf8');

function grab(re, what) {
    const m = mapSource.match(re);
    assert(m, 'map-app.js should still contain ' + what);
    return m[0];
}

const PICK = grab(/function _pickOsmProp\(props, candidates\) \{[\s\S]*?\n {12}\}/, '_pickOsmProp');
const NORM = grab(/function normalizeRoDiacritics\(str\) \{[\s\S]*?\n {12}\}/, 'normalizeRoDiacritics');
const SPLIT = grab(/function splitLocalityQuery\(term\) \{[\s\S]*?\n {12}\}/, 'splitLocalityQuery');
const LOOKUP = grab(/function osmPlaceLookup\(term, limit\) \{[\s\S]*?\n {12}\}\n/, 'osmPlaceLookup');
const LIST = grab(/var OSM_MANUAL_PLACES = \[[\s\S]*?\n {12}\];/, 'OSM_MANUAL_PLACES');
const ANNOTATE = grab(/function _annotateOsmFeature\(feat\) \{[\s\S]*?\n {12}\}/, '_annotateOsmFeature');
const MANUAL = grab(/function _manualOsmFeatures\(\) \{[\s\S]*?\n {12}\}/, '_manualOsmFeatures');
const MERGE = grab(/function _mergeManualPlaces\(feats\) \{[\s\S]*?\n {12}\}/, '_mergeManualPlaces');
const LOAD = grab(/function loadOsmGeojson\(\) \{[\s\S]*?\n {12}\}/, 'loadOsmGeojson');

// Colțan exact cum există deja în OSM (place=quarter, nod 13418756573):
// folosit pentru testul de de-duplicare.
const COLTAN_IN_SOURCE = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [21.8013972, 45.3678331] },
    properties: { name: 'Colțan', fclass: 'suburb', adm2_name: 'Caraș-Severin', fid: 4711 }
};

function otherSourceFeatures() {
    return [
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [21.7099, 45.3468] },
            properties: { name: 'Bocșa', fclass: 'town', adm2_name: 'Caraș-Severin', population: 15000, fid: 12 }
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [21.2189, 45.7541] },
            properties: { name: 'Timișoara', fclass: 'city', adm2_name: 'Timiș', population: 300000, fid: 7 }
        }
    ];
}

// Rulează codul real din map-app.js într-un context curat, cu fetch controlat.
function boot(fetchImpl, listSource) {
    const sandbox = {
        console: { log() { }, warn() { }, error() { } },
        Promise, Math, JSON, Object, Error,
        fetch: fetchImpl,
        OSM_GEOJSON_URL: 'https://example.invalid/OSM.geojson'
    };
    sandbox.window = sandbox;
    vm.runInNewContext(
        '(function(){' +
        // cache-ul din map-app.js, de care depinde loadOsmGeojson()
        'var _osmGeojsonFeatures = null; var _osmGeojsonPromise = null;' +
        PICK + NORM + SPLIT + (listSource || LIST) + ANNOTATE + MANUAL + MERGE + LOAD + LOOKUP +
        'this.loadOsmGeojson = loadOsmGeojson;' +
        'this.osmPlaceLookup = osmPlaceLookup;' +
        'this._manualOsmFeatures = _manualOsmFeatures;' +
        'this._mergeManualPlaces = _mergeManualPlaces;' +
        '}).call(this);',
        sandbox
    );
    return sandbox;
}

function okResponse(features) {
    return () => Promise.resolve({ ok: true, json: () => Promise.resolve({ type: 'FeatureCollection', features }) });
}

function manualEntry() {
    const list = vm.runInNewContext('(' + LIST.match(/\[[\s\S]*\]/)[0] + ')', {});
    const coltan = list.filter(p => p.name === 'Colțan');
    assert.strictEqual(coltan.length, 1, 'OSM_MANUAL_PLACES must contain Colțan exactly once');
    return coltan[0];
}

(async function () {
    /* ── 1. intrarea manuală e cea cerută ── */
    const entry = manualEntry();
    assert.strictEqual(entry.lat, 45.367584, 'Colțan latitude');
    assert.strictEqual(entry.lon, 21.802154, 'Colțan longitude');
    assert.strictEqual(entry.judet, 'Caraș-Severin', 'Colțan county');

    /* ── 2. intrarea ajunge în setul încărcat de loadOsmGeojson() ── */
    const app = boot(okResponse(otherSourceFeatures()));
    const feats = await app.loadOsmGeojson();
    const coltanFeats = feats.filter(f => f._lnameNorm === 'coltan');
    assert.strictEqual(coltanFeats.length, 1, 'Colțan is appended to the OSM feature set');
    // Array.from: obiectele vin din alt context vm, iar deepStrictEqual compară și prototipul
    assert.deepStrictEqual(Array.from(coltanFeats[0].geometry.coordinates), [21.802154, 45.367584],
        'GeoJSON order is [lon, lat]');
    assert.strictEqual(coltanFeats[0]._judet, 'Caraș-Severin', 'the county is normalised like the source ones');
    assert.strictEqual(coltanFeats[0].properties.fid, 'manual_45.367584_21.802154',
        'manual features carry their own fid, so the layer renderer does not merge them with source ones');
    assert.strictEqual(feats.length, otherSourceFeatures().length + 1, 'source features are left untouched');

    /* ── 3. e găsită de search exact ca o localitate din sursă ── */
    let m = await app.osmPlaceLookup('Coltan', 8);
    assert.strictEqual(m.length, 1, '"Coltan" (fără diacritice) găsește localitatea adăugată manual');
    assert.strictEqual(m[0].display_name, 'Colțan');
    assert.strictEqual(m[0].judet, 'Caraș-Severin');
    assert.strictEqual(m[0].lat, 45.367584);
    assert.strictEqual(m[0].lon, 21.802154);

    m = await app.osmPlaceLookup('Coltan, Caras-Severin', 8);
    assert.strictEqual(m.length, 1, 'calificatorul „Locality, County” funcționează și aici');

    m = await app.osmPlaceLookup('Caras', 8);
    const names = m.map(r => r.display_name);
    assert(names.indexOf('Colțan') !== -1, 'a county query lists the manual locality too (search-bar behaviour)');

    /* ── 4. fără duplicat dacă sursa remote conține deja localitatea ── */
    const withDup = boot(okResponse(otherSourceFeatures().concat([COLTAN_IN_SOURCE])));
    const feats2 = await withDup.loadOsmGeojson();
    const dupes = feats2.filter(f => f._lnameNorm === 'coltan');
    assert.strictEqual(dupes.length, 1, 'a Colțan already present within ~1 km is not added twice');
    assert.strictEqual(dupes[0].properties.fid, 4711, 'the feature from the source wins');

    /* ── 5. localitățile manuale supraviețuiesc unui eșec al sursei remote ── */
    const offline = boot(() => Promise.reject(new Error('network down')));
    const feats3 = await offline.loadOsmGeojson();
    assert.strictEqual(feats3.length, 1, 'without the remote source only the manual entries remain');
    assert.strictEqual(feats3[0].properties.name, 'Colțan');
    const offlineSearch = await offline.osmPlaceLookup('Coltan', 8);
    assert.strictEqual(offlineSearch.length, 1, 'search still finds Colțan when the remote source fails');

    /* ── 6. intrările incomplete din listă sunt ignorate ── */
    const bogusList = 'var OSM_MANUAL_PLACES = [null, {}, { name: "Fără coordonate" }, ' +
        '{ lat: 45.1, lon: 21.1 }, { lat: 45.1, lon: 21.1, name: "Valid", judet: "Timiș" }];';
    const bogus = boot(okResponse([]), bogusList);
    const bogusManual = bogus._manualOsmFeatures();
    assert.strictEqual(bogusManual.length, 1, 'entries without name or coordinates are skipped');
    const bogusFeats = await bogus.loadOsmGeojson();
    assert.strictEqual(bogusFeats.length, 1, 'only the valid entry reaches the map');
    assert.strictEqual(bogusFeats[0].properties.name, 'Valid');
    assert.strictEqual(bogusFeats[0].properties.fclass, 'locality', 'fclass defaults to "locality" when omitted');

    console.log('✓ OSM manual-places (Colțan, Caraș-Severin) tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
