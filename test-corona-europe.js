/*
 * test-corona-europe.js
 * ──────────────────────────────────────────────────────────────────────────
 * The two pieces that make "Satellite imagery 60's" work across the whole of
 * Europe instead of a hand-written Romania list:
 *
 *   A. the CATALOGUE PROXY — netlify/lib/corona-catalog.mjs +
 *      netlify/functions/corona-rasters.mjs. The original atlas gets its
 *      product list from corona.cast.uark.edu/corona/get_raster_names; that
 *      endpoint has no CORS header and answers with ~6 MB of worldwide
 *      coverage, so DetectLab fetches it server-side, clips it to Europe and
 *      serves it same-origin at /api/corona/rasters.
 *
 *   B. the COVERAGE OUTLINES — js/corona-coverage-layer.js. CORONA is a set
 *      of 1960s passes, so imagery exists only inside narrow strips; the KML
 *      of the coverage shapefile is drawn on the map so the gaps read as
 *      "no pass here" instead of "the layer is broken".
 *
 * Run:  node test-corona-europe.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
    checks++;
    if (cond) {
        console.log('  \u2713 ' + name);
    } else {
        failures++;
        console.error('  \u2717 ' + name + (detail ? ' — ' + detail : ''));
    }
}
function eq(name, actual, expected) {
    check(name, actual === expected,
        'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
}

/* ── the CAST catalogue shape, verbatim from the live endpoint ───────────── */
const CAST_FIXTURE = {
    '1002-1037Aft': {                                    // China
        label: '1002-1037Aft (Sep 25, 1963)',
        base: '1002-1037da',
        show_on_load: 'yes',
        location: '1002-1037Aft',
        extent: { minx: 111.917923584625, miny: 34.2769308567445, maxx: 114.807937481338, maxy: 35.2435570842842 },
        polygon: '{"type": "Polygon", "coordinates": [[[111.917923584625, 34.457038944353], [112.041319261419, 34.2769308567445], [114.807937481338, 35.0384371533671], [114.770689858159, 35.2435570842842], [111.917923584625, 34.457038944353]]]}',
        images: [{
            label: '1002-1037A113',
            ftp: '1002-1037d/1002-1037da/ds1002-1037da113.ntf',
            size_ntf: '883', size_tif: '664',
            location: '1002-1037da113',
            extent: { minx: 111.917923584625, miny: 34.2769308567445, maxx: 114.807937481338, maxy: 35.2435570842842 },
            polygon: '{"type": "Polygon", "coordinates": [[[112.041319261419, 34.2769308567445], [111.917923584625, 34.457038944353], [114.770689858159, 35.2435570842842], [112.041319261419, 34.2769308567445]]]}'
        }]
    },
    '1006-1025Aft': {                                    // Marmara — Europe
        label: '1006-1025Aft (Jun 05, 1964)',
        location: '1006-1025Aft',
        extent: { minx: 26.4446517691805, miny: 40.4005864822581, maxx: 29.3530463435642, maxy: 41.1514338171344 },
        polygon: '{"type": "Polygon", "coordinates": [[[26.4446517691805, 40.5753592535862], [26.5517479314811, 40.4005864822581], [29.3530463435642, 40.9569955606865], [29.3390408271658, 41.1514338171344], [26.4446517691805, 40.5753592535862]]]}',
        images: [{
            label: '1006-1025A120',
            ftp: '1006-1025d/1006-1025da/ds1006-1025da120.ntf',
            size_ntf: '877', size_tif: '370',
            location: '1006-1025da120',
            extent: { minx: 26.4446517691805, miny: 40.4005864822581, maxx: 29.3530463435642, maxy: 41.1514338171344 },
            polygon: '{"type": "Polygon", "coordinates": [[[26.5517479314811, 40.4005864822581], [26.4446517691805, 40.5753592535862], [29.3390408271658, 41.1514338171344], [26.5517479314811, 40.4005864822581]]]}'
        }]
    },
    '1007-1056Fore': {                                   // Moscow — Europe
        label: '1007-1056Fore (Jun 23, 1964)',
        location: '1007-1056Fore',
        extent: { minx: 35.0795819387989, miny: 55.3894498428335, maxx: 39.4756565800395, maxy: 55.9990673564469 },
        polygon: '{"type": "Polygon", "coordinates": [[[35.0795819387989, 55.5970777579305], [35.0844551110382, 55.3894498428335], [39.4756565800395, 55.7913740087951], [39.3532754954868, 55.9990673564469], [35.0795819387989, 55.5970777579305]]]}',
        images: []
    },
    '1006-2118Fore': {                                   // Kazakhstan
        label: '1006-2118Fore (Jun 12, 1964)',
        location: '1006-2118Fore',
        extent: { minx: 68.5666590903957, miny: 47.1002205271421, maxx: 72.1173299126664, maxy: 47.9783192648253 },
        polygon: '{"type": "Polygon", "coordinates": [[[68.5666590903957, 47.3091702624542], [68.6030905060963, 47.1002205271421], [72.1173299126664, 47.7851813360123], [71.9783036760562, 47.9783192648253], [68.5666590903957, 47.3091702624542]]]}',
        images: []
    }
};

/* ── a KML in the shape of corona2.kml (buffered, world-wide) ────────────── */
const KML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>corona2</name>
<Folder><Placemark><MultiGeometry>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>
    22.000000,44.000000 22.000100,44.000100 22.000200,44.000150 23.200000,44.000000 25.200000,48.000000 24.000000,48.000000 22.000000,44.000000
  </coordinates></LinearRing></outerBoundaryIs></Polygon>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>
    111.900000,34.400000 112.000000,34.200000 114.800000,35.000000 114.700000,35.200000 111.900000,34.400000
  </coordinates></LinearRing></outerBoundaryIs></Polygon>
  <Polygon><outerBoundaryIs><LinearRing><coordinates>
    -180.009951,3.800980 -180.000000,3.810000 -179.666067,3.810000 -179.684312,4.090000 -180.009951,3.800980
  </coordinates></LinearRing></outerBoundaryIs></Polygon>
</MultiGeometry></Placemark></Folder>
</Document></kml>`;

/* ══════════════════════════════════════════════════════════════════════════
 * A. The catalogue proxy (netlify/lib/corona-catalog.mjs)
 * ═════════════════════════════════════════════════════════════════════════ */
async function testCatalogLib() {
    console.log('\n[A] Catalogue proxy — CAST payload → slim Europe catalogue');

    const lib = await import('./netlify/lib/corona-catalog.mjs');

    eq('the upstream is the atlas\'s own endpoint', lib.CAST_CATALOG_URL,
        'https://corona.cast.uark.edu/corona/get_raster_names');
    eq('Europe bbox covers Iceland to the Urals and Crete to Svalbard',
        lib.EUROPE_BBOX.join(','), '-25,34,60,72');

    const payload = lib.buildCatalogPayload(CAST_FIXTURE, lib.EUROPE_BBOX);
    const ids = payload.blocks.map((b) => b.id).sort();
    eq('only the European passes are returned', ids.join(','), '1006-1025Aft,1007-1056Fore');
    eq('the pass count is reported', payload.passes, 2);
    eq('the frame count is reported', payload.frames, 1);
    check('the payload records where it came from', payload.source === lib.CAST_CATALOG_URL);
    check('the payload records when it was built', !!Date.parse(payload.generated));

    const marmara = payload.blocks.find((b) => b.id === '1006-1025Aft');
    eq('the GeoServer product name is kept verbatim', marmara.location, '1006-1025Aft');
    eq('the frame product name is kept verbatim', marmara.images[0].location, '1006-1025da120');
    check('the footprint polygon survives as rings',
        Array.isArray(marmara.rings) && marmara.rings[0].length === 5);
    check('coordinates are rounded to 5 decimals (~1 m)',
        marmara.rings[0].every(([lon, lat]) =>
            String(lon).split('.')[1]?.length <= 5 && String(lat).split('.')[1]?.length <= 5),
        JSON.stringify(marmara.rings[0][0]));
    check('the download link is preserved for the frame', !!marmara.images[0].ftp);
    check('the raw CAST payload is much larger than the slim one',
        JSON.stringify(payload.blocks).length < JSON.stringify(CAST_FIXTURE).length,
        JSON.stringify(payload.blocks).length + ' vs ' + JSON.stringify(CAST_FIXTURE).length);

    // A smaller bbox (Romania) narrows the answer further.
    const ro = lib.buildCatalogPayload(CAST_FIXTURE, [20, 43, 30, 49]);
    eq('a narrower bbox returns fewer passes', ro.passes, 0);

    eq('parseBbox reads a query string', lib.parseBbox('10,40,20,50').join(','), '10,40,20,50');
    eq('parseBbox normalises a reversed bbox', lib.parseBbox('20,50,10,40').join(','), '10,40,20,50');
    eq('parseBbox falls back on junk', lib.parseBbox('nope').join(','), lib.EUROPE_BBOX.join(','));

    // MultiPolygon footprints (a few CAST products have them) flatten to rings.
    const multi = lib.toRings('{"type":"MultiPolygon","coordinates":[[[[0,0],[1,0],[1,1],[0,0]]],[[[5,5],[6,5],[6,6],[5,5]]]]}');
    eq('MultiPolygon footprints become a flat ring list', multi.length, 2);

    console.log('\n[A2] The Netlify function wiring');
    const fn = fs.readFileSync(path.join(__dirname, 'netlify/functions/corona-rasters.mjs'), 'utf8');
    check('the function is routed at /api/corona/rasters',
        /path:\s*'\/api\/corona\/rasters'/.test(fn));
    check('it answers JSON with CORS for the browser',
        /Access-Control-Allow-Origin/.test(fn) && /application\/json/.test(fn));
    check('it caches on the CDN (the archive never changes)',
        /Netlify-CDN-Cache-Control/.test(fn) && /Cache-Control/.test(fn));
    check('it keeps a warm in-memory copy', /MEMORY_TTL_MS/.test(fn));
    check('it serves stale data rather than failing', /if \(cached\) return cached\.catalog/.test(fn));

    const toml = fs.readFileSync(path.join(__dirname, 'netlify.toml'), 'utf8');
    check('netlify.toml declares the functions directory',
        /\[functions\]/.test(toml) && /netlify\/functions/.test(toml));
    check('netlify.toml redirects /api/corona/rasters to the function',
        /from = "\/api\/corona\/rasters"/.test(toml) &&
        /to = "\/\.netlify\/functions\/corona-rasters"/.test(toml));

    const tool = fs.readFileSync(path.join(__dirname, 'tools/build-corona-europe-catalog.mjs'), 'utf8');
    check('a generator exists for the static snapshot',
        /data\/corona-europe-catalog\.json/.test(tool) && /fetchCoronaCatalog/.test(tool));
}

/* ══════════════════════════════════════════════════════════════════════════
 * B. The coverage outlines (js/corona-coverage-layer.js)
 * ═════════════════════════════════════════════════════════════════════════ */
const MOCK_L = {
    extend: function (t) {
        for (let i = 1; i < arguments.length; i++) {
            const s = arguments[i] || {};
            for (const k in s) t[k] = s[k];
        }
        return t;
    },
    polygon: function (latlngs, options) { return { latlngs: latlngs, options: options }; },
    layerGroup: function (layers) { return { layers: layers }; },
    canvas: function (o) { return { canvas: true, options: o }; }
};

function coverageSandbox(extra) {
    const sandbox = Object.assign({
        console: console, L: MOCK_L, Promise: Promise,
        fetch: function () { return Promise.reject(new Error('no network in tests')); }
    }, extra || {});
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/corona-coverage-layer.js'), 'utf8'),
        sandbox, { filename: 'corona-coverage-layer.js' });
    return sandbox;
}

async function testCoverageLayer() {
    console.log('\n[B] Coverage outlines — KML parsing of the Corona footprints');

    const sandbox = coverageSandbox();
    const Coverage = sandbox.CoronaCoverage;

    check('the module exposes a coverage API', typeof Coverage === 'object' && typeof Coverage.load === 'function');
    eq('it points at the KML the user supplied', Coverage.DEFAULT_KML_URL,
        'https://dacboefvooxgsngxkavx.supabase.co/storage/v1/object/public/Harti/corona2.kml');

    const rings = Coverage.parseKml(KML_FIXTURE, [-25, 34, 60, 72]);
    eq('only the European footprint is kept', rings.length, 1);
    check('the kept footprint is the Romanian strip',
        rings[0].some(([lon, lat]) => Math.round(lon) === 25 && Math.round(lat) === 48),
        JSON.stringify(rings[0]));
    check('the Chinese footprint is dropped',
        !rings.some((r) => r.some(([lon]) => lon > 100)));
    check('the antimeridian footprint is dropped',
        !rings.some((r) => r.some(([lon]) => lon < -170)));

    // The buffered corners (16 near-identical vertices in the real file) are
    // collapsed; the shape itself is untouched.
    check('near-duplicate buffer vertices are collapsed', rings[0].length < 7, String(rings[0].length));
    const far = Coverage.parseKml(KML_FIXTURE, [-180, -90, 180, 90]);
    eq('with a world bbox every footprint is kept', far.length, 3);
    check('longitudes beyond ±180 are clamped',
        far.every((r) => r.every(([lon]) => lon >= -180 && lon <= 180)));

    // The real corona2.kml union contains a degenerate ring that walks the
    // antimeridian around the whole planet. Its bbox intersects every bbox,
    // so before this filter it rendered as ONE map-wide semi-transparent
    // sheet over Europe. A real pass strip spans a few degrees, never more
    // than MAX_RING_SPAN_DEG.
    const GIANT_RING_KML = `<?xml version="1.0"?><kml><Document><Placemark><Polygon>
      <outerBoundaryIs><LinearRing><coordinates>
        -180.01,3.80 -179.66,3.81 179.98,45.0 60.0,71.9 -24.9,50.0 -180.01,3.80
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    eq('a world-spanning union ring is dropped (the "giant rectangle" bug)',
        Coverage.parseKml(GIANT_RING_KML, [-25, 34, 60, 72]).length, 0);
    check('a sane span cap exists and allows a real pass strip (~4°)',
        Coverage.MAX_RING_SPAN_DEG >= 6 && Coverage.MAX_RING_SPAN_DEG <= 45,
        String(Coverage.MAX_RING_SPAN_DEG));

    console.log('\n[B3] Outlines come from the imagery catalogue — like the atlas');

    // The original atlas draws the footprint polygons it receives from
    // /corona/get_raster_names. Our outlines use the SAME catalogue (via
    // CoronaAtlas.loadCatalog), so a strip is drawn exactly where a GetMap
    // request can answer with imagery — Europe-wide, not just Romania.
    const CATALOG_BLOCKS = [
        { id: '1006-1025Aft', label: '1006-1025Aft (Jun 05, 1964)', location: '1006-1025Aft',
          extent: [26.44465, 40.40059, 29.35305, 41.15143],
          rings: [[[26.44465, 40.57536], [26.55175, 40.40059], [29.35305, 40.957], [29.33904, 41.15143], [26.44465, 40.57536]]] },
        { id: '1104-2155Fore', label: '1104-2155Fore (Nov 04, 1968)', location: '1104-2155Fore',
          extent: [21.5, 44.1, 26.8, 48.3],
          rings: [[[21.5, 47.9], [22.1, 44.1], [26.8, 44.6], [26.2, 48.3], [21.5, 47.9]]] },
        { id: 'degenerate', label: 'degenerate', location: 'degenerate',
          extent: [-180, -90, 180, 90],
          rings: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] }
    ];

    const fromCatalog = Coverage.ringsFromCatalog(CATALOG_BLOCKS, [-25, 34, 60, 72]);
    eq('every real pass footprint becomes an outline', fromCatalog.length, 2);
    check('degenerate world-sized catalogue rings are dropped too',
        !fromCatalog.some((r) => r.some(([lon]) => lon === -180)));

    // End-to-end: load() prefers the catalogue and never touches the KML.
    let kmlFetches = 0;
    const catSandbox = coverageSandbox({
        CoronaAtlas: {
            EUROPE_BBOX: [-25, 34, 60, 72],
            loadCatalog: function () {
                return Promise.resolve({ blocks: CATALOG_BLOCKS, source: 'data/corona-europe-catalog.json' });
            }
        },
        fetch: function () { kmlFetches++; return Promise.reject(new Error('KML must not be needed')); }
    });
    const catRings = await catSandbox.CoronaCoverage.load();
    eq('load() draws the outlines from the imagery catalogue', catRings.length, 2);
    eq('the KML is not downloaded when the catalogue answers', kmlFetches, 0);
    eq('the source is reported for diagnostics', catSandbox.CoronaCoverage.getSource(), 'catalog');

    // And when the catalogue is empty/unreachable, the KML fallback still works.
    let fallbackFetches = 0;
    const kmlSandbox = coverageSandbox({
        CoronaAtlas: {
            EUROPE_BBOX: [-25, 34, 60, 72],
            loadCatalog: function () { return Promise.reject(new Error('catalogue down')); }
        },
        fetch: function () {
            fallbackFetches++;
            return Promise.resolve({ ok: true, text: function () { return Promise.resolve(KML_FIXTURE); } });
        }
    });
    const kmlRings = await kmlSandbox.CoronaCoverage.load();
    eq('without a catalogue the KML fallback is used', fallbackFetches, 1);
    eq('…and still yields the European footprints', kmlRings.length, 1);
    eq('the fallback source is reported', kmlSandbox.CoronaCoverage.getSource(), 'kml');

    console.log('\n[B4] The misleading Europe-wide red rectangle is retired');
    const mapAppSrc = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
    const satEntryStart = mapAppSrc.indexOf('satellite60s: {');
    const satEntry = mapAppSrc.slice(satEntryStart, mapAppSrc.indexOf('},', satEntryStart));
    check('the satellite60s coverage entry opts out of the red rectangle',
        satEntryStart !== -1 && /noCoverageRect:\s*true/.test(satEntry));
    check('the rectangle factory honours the opt-out',
        /if\s*\(data\.noCoverageRect\)\s*return;/.test(mapAppSrc));
    check('the entry keeps its bounds for the layer-row highlight',
        /bounds:\s*\[\[34\.0,\s*-25\.0\],\s*\[72\.0,\s*60\.0\]\]/.test(satEntry));

    console.log('\n[B5] The static snapshot is baked at deploy time');
    const toml = fs.readFileSync(path.join(__dirname, 'netlify.toml'), 'utf8');
    check('netlify.toml builds data/corona-europe-catalog.json on every deploy',
        /\[build\]/.test(toml) && /build-corona-europe-catalog\.mjs/.test(toml));
    check('a snapshot build failure cannot break the deploy (proxy covers it)',
        /build-corona-europe-catalog\.mjs \|\| true/.test(toml));
    const gitignore = fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8');
    check('the generated snapshot is not committed',
        gitignore.indexOf('data/corona-europe-catalog.json') !== -1);

    console.log('\n[B2] Wiring in the app');
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

    const scriptSrcs = (indexHtml.match(/<script[^>]+src="[^"]+"/g) || [])
        .map((tag) => tag.match(/src="([^"?]+)/)[1]);
    check('index.html loads the coverage layer before map-app.js',
        scriptSrcs.indexOf('js/corona-coverage-layer.js') !== -1 &&
        scriptSrcs.indexOf('js/corona-coverage-layer.js') < scriptSrcs.indexOf('js/map-app.js'),
        scriptSrcs.join(' '));
    check('index.html loads the WMS/catalogue layer before map-app.js',
        scriptSrcs.indexOf('js/corona-wms-layer.js') !== -1 &&
        scriptSrcs.indexOf('js/corona-wms-layer.js') < scriptSrcs.indexOf('js/map-app.js'));
    check('the layer panel has a coverage-outlines switch',
        /id="satellite60sCoverageToggle"/.test(indexHtml) &&
        /toggleSatellite60sCoverage\(this\.checked\)/.test(indexHtml));
    check('the switch has a translatable label',
        /data-key="layer_sat60_coverage"/.test(indexHtml));
    check('turning the imagery on also shows where it exists',
        /CoronaCoverage\.show\(map\)/.test(mapApp));
    check('turning the imagery off hides the outlines',
        /CoronaCoverage\.hide\(\)/.test(mapApp));
    check('the service worker pre-caches the coverage layer',
        sw.indexOf('js/corona-coverage-layer.js') !== -1);

    const translations = fs.readFileSync(path.join(__dirname, 'js/translations.js'), 'utf8');
    check('the label is translated in every language',
        (translations.match(/layer_sat60_coverage:/g) || []).length ===
        (translations.match(/layer_satellite60s:/g) || []).length,
        (translations.match(/layer_sat60_coverage:/g) || []).length + ' of ' +
        (translations.match(/layer_satellite60s:/g) || []).length);
}

(async function main() {
    await testCatalogLib();
    await testCoverageLayer();

    console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
    if (failures > 0) {
        console.error(failures + ' FAILED');
        process.exit(1);
    }
    console.log('All CORONA Europe catalogue-proxy / coverage-outline checks passed.');
})();
