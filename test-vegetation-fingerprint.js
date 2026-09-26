// Smoke test for the premium layer group
//   „Amprenta Vegetației / Vegetation Fingerprint” — CLMS HR-VPP
// and its first sublayer:
//   PPI (Plant Phenology Index, 10 m, one image every 10 days, 2017–2024)
//
// Verifies:
//   1. The WMTS source: HTTPS phenology endpoint (the WMS :8080 endpoint from
//      the capabilities is plain HTTP → mixed content on the HTTPS site), the
//      exact KVP GetTile format, the CLMS_HRVPP_ST_PPI_10M layer and the TIME
//      dimension.
//   2. Romania-only tile fetching: the `bounds` envelope, the simplified
//      Romania polygon (superset — every Romanian extreme inside, foreign
//      cities outside) and the getTileUrl mask with the transparent pixel.
//   3. The dekad date list matches the service's TIME dimension
//      (2017-01-01 … 2024-12-21, days 01/11/21 of every month — 288 dates).
//   4. UI wiring: premium group row + master toggle + expandable sublayer
//      panel, PPI toggle, date selector with ‹ › steppers, opacity slider,
//      info buttons with the Copernicus attribution and description.
//   5. Premium gating: toggle functions wrapped by subscriptions.js
//      PREMIUM_TOGGLE_FNS, lock badge via data-category="premium".
//   6. Integrations: vertical opacity mirror (LAYER_NAMES + LAYER_TOGGLE_MAP),
//      coverage rectangle (premiumMapCoverageBounds), layer-visibility
//      highlight (layerDefs + groups), translations (en + ro) and the
//      service-worker rollout (CACHE_NAME v140, versioned URLs, passthrough
//      host).
//
// Run: node test-vegetation-fingerprint.js  (from repo root)
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
    return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

const mapApp = read('js/map-app.js');
const html = read('index.html');
const subscriptions = read('js/subscriptions.js');
const translations = read('js/translations.js');
const voc = read('js/vertical-opacity-control.js');
const sw = read('sw.js');

console.log('[Test] Amprenta Vegetației / Vegetation Fingerprint (CLMS HR-VPP PPI)...');

// ── 1. Service & tile URL ──────────────────────────────────────────────
assert.match(
    mapApp,
    /var VEGFP_WMTS_BASE = 'https:\/\/phenology\.hrvpp2\.vgt\.vito\.be\/wmts'/,
    'PPI must be served over HTTPS by the phenology WMTS endpoint (the WMS :8080 endpoint is HTTP-only → mixed content)'
);
assert.match(
    mapApp,
    /var VEGFP_PPI_LAYER_NAME = 'CLMS_HRVPP_ST_PPI_10M'/,
    'PPI sublayer must request the CLMS_HRVPP_ST_PPI_10M layer'
);
assert.match(
    mapApp,
    /'\?SERVICE=WMTS'/,
    'Tile requests are WMTS KVP GetTile (direct GeoWebCache hits)'
);
assert.match(
    mapApp,
    /'&TILEMATRIXSET=EPSG%3A3857'/,
    'TileMatrixSet is EPSG:3857 (the standard XYZ grid)'
);
assert.match(
    mapApp,
    /'&TILEMATRIX=EPSG%3A3857%3A\{z\}'/,
    'TileMatrix template uses {z} on the EPSG:3857 matrix'
);
assert.match(mapApp, /'&TILEROW=\{y\}'/, 'TileRow template uses {y}');
assert.match(mapApp, /'&TILECOL=\{x\}'/, 'TileCol template uses {x}');
assert.match(
    mapApp,
    /'&FORMAT=image%2Fpng'/,
    'Tiles are requested as image/png'
);
assert.match(mapApp, /'&STYLE='/, 'STYLE is sent empty (accepted by GeoWebCache)');
assert.match(mapApp, /'&TIME=' \+ time/, 'The TIME dimension is appended to every tile URL');
assert.match(
    mapApp,
    /attribution: "© European Union's Copernicus Land Monitoring Service information"/,
    'The layer carries the required Copernicus attribution'
);
assert.match(
    mapApp,
    /var VEGFP_ATTRIBUTION = "© European Union's Copernicus Land Monitoring Service information"/,
    'The info popups carry the same Copernicus attribution'
);

// Zoom range: 10 m product — tiles from z6, native ceiling z15.
assert.match(mapApp, /var VEGFP_PPI_MIN_ZOOM = 6/, 'PPI tiles start at z6');
assert.match(mapApp, /var VEGFP_PPI_MAX_NATIVE_ZOOM = 15/, 'PPI native zoom ceiling is z15');

// ── 2. Romania-only tile fetching ──────────────────────────────────────
assert.match(
    mapApp,
    /bounds: VEGFP_RO_TILE_BOUNDS/,
    'The tile layer is clipped to the Romania envelope via the `bounds` option'
);
assert.match(
    mapApp,
    /var VEGFP_RO_TILE_BOUNDS = L\.latLngBounds\(VEGFP_RO_POLYGON\)/,
    'The envelope is derived from the Romania polygon (no hand-typed rect that could miss a corner)'
);

// Extract the polygon exactly as shipped in map-app.js.
const polyMatch = mapApp.match(/var VEGFP_RO_POLYGON = \[([\s\S]*?)\];/);
assert.ok(polyMatch, 'VEGFP_RO_POLYGON must be defined in js/map-app.js');
const POLY = Function('return [' + polyMatch[1] + '];')(); // [[lat, lng], …]
assert.ok(Array.isArray(POLY) && POLY.length >= 20,
    'The simplified Romania polygon has a sane number of vertices (got ' + POLY.length + ')');

function pointInPolygon(lat, lng, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const latI = poly[i][0], lngI = poly[i][1];
        const latJ = poly[j][0], lngJ = poly[j][1];
        if (((latI > lat) !== (latJ > lat)) &&
            (lng < (lngJ - lngI) * (lat - latI) / (latJ - latI) + lngI)) {
            inside = !inside;
        }
    }
    return inside;
}

// 2a. Every Romanian geographic extreme and a spread of cities stay inside.
const RO_POINTS = [
    [46.77, 23.60, 'Cluj-Napoca'],
    [44.43, 26.10, 'București'],
    [45.15, 29.66, 'Sulina (extrema estică)'],
    [46.13, 20.27, 'Beba Veche (extrema vestică)'],
    [48.25, 26.45, 'Horodiștea (extrema nordică)'],
    [43.62, 25.55, 'Zimnicea (extrema sudică)'],
    [43.75, 28.57, 'Vama Veche'],
    [47.97, 23.75, 'Sighetu Marmației'],
    [44.90, 29.60, 'Sfântu Gheorghe (Delta)'],
    [47.20, 27.78, 'Ungheni (Prut)'],
    [44.63, 22.65, 'Drobeta-Turnu Severin'],
    [47.05, 21.92, 'Oradea'],
    [45.75, 21.23, 'Timișoara'],
    [46.55, 26.90, 'Bacău'],
    [44.17, 28.65, 'Constanța']
];
RO_POINTS.forEach(([lat, lng, name]) => {
    assert.ok(pointInPolygon(lat, lng, POLY),
        name + ' (' + lat + ', ' + lng + ') must be inside the Romania tile polygon');
});

// 2b. Foreign cities well inside the neighbours are rejected.
const FOREIGN_POINTS = [
    [47.50, 19.04, 'Budapesta (HU)'],
    [44.80, 20.46, 'Belgrad (SRB)'],
    [42.70, 23.32, 'Sofia (BG)'],
    [47.01, 28.86, 'Chișinău (MD)'],
    [46.48, 30.73, 'Odesa (UA)'],
    [49.84, 24.03, 'Lviv (UA)'],
    [43.21, 27.91, 'Varna (BG)'],
    [50.45, 30.52, 'Kyiv (UA)'],
    [42.14, 24.75, 'Plovdiv (BG)'],
    [48.15, 17.13, 'Bratislava (SK)']
];
FOREIGN_POINTS.forEach(([lat, lng, name]) => {
    assert.ok(!pointInPolygon(lat, lng, POLY),
        name + ' (' + lat + ', ' + lng + ') must be OUTSIDE the Romania tile polygon');
});

// 2c. The polygon envelope covers Romania's documented extremes with a margin.
let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
POLY.forEach(([lat, lng]) => {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
});
assert.ok(minLat < 43.62, 'polygon must reach south of Romania (min lat ' + minLat + ')');
assert.ok(maxLat > 48.26, 'polygon must reach north of Romania (max lat ' + maxLat + ')');
assert.ok(minLng < 20.27, 'polygon must reach west of Romania (min lng ' + minLng + ')');
assert.ok(maxLng > 29.66, 'polygon must reach east of Romania (max lng ' + maxLng + ')');

// 2d. The mask itself: getTileUrl rejects foreign tiles with a transparent pixel.
assert.match(
    mapApp,
    /var VegFpTileLayer = L\.TileLayer\.extend\(\{/,
    'A dedicated TileLayer subclass carries the Romania mask'
);
const maskBlock = mapApp.slice(mapApp.indexOf('var VegFpTileLayer'), mapApp.indexOf('function _vegfpBuildPpiUrl'));
assert.match(maskBlock, /getTileUrl: function \(coords\)/, 'the mask hooks getTileUrl');
assert.match(maskBlock, /_vegfpTileInRomania\(z, coords\.x, coords\.y\)/,
    'each tile is tested against the Romania mask before any request');
assert.match(maskBlock, /L\.emptyImageUrl/, 'rejected tiles get Leaflet\u2019s transparent pixel (no network request)');
assert.match(mapApp, /window\._vegfpTileInRomania = _vegfpTileInRomania/,
    'the mask is exported for tests/debugging');
assert.match(mapApp, /_vegfpMaskCache/, 'mask decisions are cached per (z,x,y)');

// 2e. Functional tile-mask simulation (same XYZ grid the WMTS matrix uses):
//     the tile over Cluj fetches, the tiles over Budapest / Sofia / Odesa do not.
function lngToTileX(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
function latToTileY(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
}
function tileCenterInPolygon(lat, lng, z) {
    const x = lngToTileX(lng, z), y = latToTileY(lat, z), n = Math.pow(2, z);
    const cLng = (x + 0.5) / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)));
    return pointInPolygon(latRad * 180 / Math.PI, cLng, POLY);
}
[8, 11, 13].forEach((z) => {
    assert.ok(tileCenterInPolygon(46.77, 23.60, z),
        'tile over Cluj at z' + z + ' must be fetched');
    assert.ok(!tileCenterInPolygon(47.50, 19.04, z),
        'tile over Budapest at z' + z + ' must NOT be fetched');
    assert.ok(!tileCenterInPolygon(42.70, 23.32, z),
        'tile over Sofia at z' + z + ' must NOT be fetched');
    assert.ok(!tileCenterInPolygon(46.48, 30.73, z),
        'tile over Odesa at z' + z + ' must NOT be fetched');
    assert.ok(!tileCenterInPolygon(47.01, 28.86, z),
        'tile over Chișinău at z' + z + ' must NOT be fetched');
});

// ── 3. Dekad TIME list (matches the WMS/WMTS capabilities) ─────────────
const yearsMatch = mapApp.match(/var VEGFP_PPI_YEARS = \[([^\]]*)\]/);
const daysMatch = mapApp.match(/var VEGFP_PPI_DEKAD_DAYS = \[([^\]]*)\]/);
assert.ok(yearsMatch && daysMatch, 'dekad constants (years + days) must exist');
const YEARS = yearsMatch[1].split(',').map((s) => parseInt(s.trim(), 10));
const DAYS = daysMatch[1].split(',').map((s) => parseInt(s.trim(), 10));
assert.deepStrictEqual(YEARS, [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024],
    'the service covers 2017–2024');
assert.deepStrictEqual(DAYS, [1, 11, 21], 'dekads fall on the 1st, 11th and 21st');

const dates = [];
YEARS.forEach((y) => {
    for (let m = 1; m <= 12; m++) {
        DAYS.forEach((d) => {
            dates.push(y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'));
        });
    }
});
assert.strictEqual(dates.length, 288, '8 years × 36 dekads = 288 dates');
assert.strictEqual(dates[0], '2017-01-01', 'the list starts where the capabilities start');
assert.strictEqual(dates[dates.length - 1], '2024-12-21', 'the list ends where the capabilities end');
assert.ok(dates.indexOf('2017-01-21') < dates.indexOf('2017-02-01'), 'dekads sort chronologically');
assert.ok(dates.indexOf('2024-07-01') !== -1, 'the default date exists in the list');
assert.match(
    mapApp,
    /var VEGFP_PPI_DEFAULT_TIME = '2024-07-01'/,
    'default dekad is mid-season of the latest year'
);
assert.match(mapApp, /group\.label = y;/, 'the date selector groups options by year');
assert.match(mapApp, /opt\.value = d;/, 'the option value is the raw ISO date (the TIME value)');

// Date switching: URL rebuilt + tiles reloaded; ‹ › steppers clamp at the ends.
assert.match(mapApp, /_vegfpPpiLayer\.setUrl\(_vegfpBuildPpiUrl\(dateStr\)\)/,
    'changing the date reloads the layer with the new TIME');
assert.match(mapApp, /window\.vegfpPpiStepDekad = function \(dir\)/,
    'the ‹ › buttons step one dekad at a time');
assert.match(mapApp, /if \(next < 0 \|\| next >= dates\.length\) return;/,
    'stepping clamps at the first/last dekad');
assert.match(mapApp, /prev\.disabled = \(idx <= 0\)/, 'the ‹ button disables at the first dekad');

// ── 4. UI wiring in index.html ─────────────────────────────────────────
assert.match(html, /<div class="transp-layer-row" data-category="premium" id="vegfpRow">/,
    'the group is a PREMIUM row (lock badge + gating come from data-category)');
assert.match(html, /data-key="layer_vegfp_group"[^>]*>Amprenta Vegetației \/ Vegetation Fingerprint</,
    'the group label is bilingual by default and translated via data-key');
assert.match(html, /id="vegfpToggle" onchange="toggleVegfpLayer\(this\.checked\)"/,
    'master toggle is wired');
assert.match(html, /<button onclick="toggleVegfpSubLayers\(\)" id="vegfpExpandBtn"/,
    'the expand button opens the sublayer panel');
assert.match(html, /id="vegfpExpandIcon"/, 'the expand chevron icon exists (group highlight)');
assert.match(html, /id="vegfpSubLayers"/, 'the sublayer panel container exists');
assert.match(html, /id="vegfpPpiRow"/, 'the PPI sublayer row exists');
assert.match(html, /data-key="layer_vegfp_ppi">PPI</, 'the PPI label is translatable');
assert.match(html, /Plant Phenology Index</, 'the PPI row names the product');
assert.match(html, /id="vegfpPpiToggle" onchange="toggleVegfpPpiLayer\(this\.checked\)"/,
    'the PPI toggle is wired');
assert.match(html, /id="vegfpPpiDateSelect" onchange="setVegfpPpiDate\(this\.value\)"/,
    'the dekad selector is wired');
assert.match(html, /id="vegfpPpiPrevBtn" onclick="vegfpPpiStepDekad\(-1\)"/, '‹ stepper wired');
assert.match(html, /id="vegfpPpiNextBtn" onclick="vegfpPpiStepDekad\(1\)"/, '› stepper wired');
assert.match(html, /id="vegfpPpiOpacitySlider"/, 'the opacity slider exists');
assert.match(html, /oninput="setVegfpPpiOpacity\(this\.value\)"/, 'the opacity slider is wired');
assert.match(html, /id="vegfpPpiPct">85%</, 'the opacity readout starts at the layer default');
assert.match(html, /showVegfpInfo\(\)/, 'the group info button opens the Copernicus info popup');
assert.match(html, /showVegfpPpiInfo\(\)/, 'the PPI info button opens the Copernicus info popup');
assert.match(html, /data-key="layer_vegfp_ro_note"/,
    'the panel states that tiles load only over Romania');
// The vertical mirror derives the layer name from the first [data-key^="layer_"]
// inside the slider's parent row — that must be the PPI label, not the date label.
const ppiRowHtml = html.slice(html.indexOf('id="vegfpPpiRow"'), html.indexOf('/vegfpSubLayers'));
assert.ok(ppiRowHtml.indexOf('layer_vegfp_ppi') < ppiRowHtml.indexOf('layer_vegfp_date_label'),
    'the PPI title precedes the date label (vertical mirror naming)');

// ── 5. Premium gating ──────────────────────────────────────────────────
assert.match(subscriptions, /'toggleVegfpLayer',[^\n]*\n\s*'toggleVegfpPpiLayer'/,
    'both vegetation toggles are wrapped by PREMIUM_TOGGLE_FNS');
assert.match(subscriptions, /prem_feat_vegfp/,
    'the premium modal lists the Vegetation Fingerprint feature');
assert.match(mapApp, /var _vegfpPpiLayer = null;/, 'the PPI layer instance is cached');
assert.match(mapApp, /window\._vegfpPpiLayer = _vegfpPpiLayer;/,
    'the instance is exposed for the coverage rectangle');

// Master/substrate coupling (same behaviour as „Harti istorice”).
assert.match(mapApp, /window\.toggleVegfpLayer = function \(on\) \{[\s\S]*?window\.toggleVegfpPpiLayer\(false\);/,
    'turning the group OFF turns every sublayer OFF');
assert.match(mapApp, /window\.toggleVegfpPpiLayer = function \(on\) \{[\s\S]*?window\.toggleVegfpLayer\(true\);/,
    'turning PPI ON also turns the group ON');

// ── 6. Integrations ────────────────────────────────────────────────────
// Vertical opacity mirror.
assert.match(voc, /vegfpPpiOpacitySlider: 'PPI · Vegetation Fingerprint'/,
    'the vertical mirror knows the PPI slider name');
assert.match(voc, /vegfpPpiOpacitySlider: 'vegfpPpiToggle'/,
    'the vertical mirror auto-activates the PPI layer');

// Red coverage rectangle below the minimum zoom.
assert.match(mapApp, /vegfpPpi: \{[\s\S]*?layerVar: '_vegfpPpiLayer',\s*\n\s*coverageMinZoom: 6/,
    'the coverage rectangle is registered for PPI with the z6 minimum');

// Layer-visibility highlight (row + group arrow).
assert.match(mapApp, /key: 'vegfp_ppi',\s*\n\s*bounds: ROMANIA_BOUNDS,\s*\n\s*getRow: function\(\) \{ return document\.getElementById\('vegfpPpiRow'\); \},\s*\n\s*group: 'vegfp'/,
    'the PPI row is registered with the visibility highlight');
assert.match(mapApp, /vegfp: \{ expandIconId: 'vegfpExpandIcon', sublayerKeys: \['vegfp_ppi', 'vegfp_smx', 'vegfp_sgu', 'vegfp_sgd'\] \}/,
    'the vegfp group arrow is registered');
assert.match(mapApp, /groupVisible = \{ hist: false, lidar: false, roman: false, histPremium: false, vegfp: false \}/,
    'group visibility tracking includes vegfp');

// Translations (both languages carry the same key set).
const enBlock = translations.slice(translations.indexOf('en: {'), translations.indexOf('ro: {'));
const roBlock = translations.slice(translations.indexOf('ro: {'));
[
    ['layer_vegfp_group', 'Vegetation Fingerprint', 'Amprenta Vegetației'],
    ['layer_vegfp_ppi', 'PPI', 'PPI'],
    ['layer_vegfp_date_label', 'Date', 'Dată'],
    ['layer_vegfp_prev_dekad', 'Previous 10-day period', 'Perioada de 10 zile anterioară'],
    ['layer_vegfp_next_dekad', 'Next 10-day period', 'Perioada de 10 zile următoare'],
    ['layer_vegfp_ro_note', 'Tiles are fetched only for Romania', 'Tile-urile se încarcă doar pentru suprafața României'],
    ['layer_vegfp_smx', 'SMX', 'SMX'],
    ['layer_vegfp_sgu', 'SGU', 'SGU'],
    ['layer_vegfp_year_label', 'Year', 'An'],
    ['layer_vegfp_prev_year', 'Previous year', 'Anul anterior'],
    ['layer_vegfp_next_year', 'Next year', 'Anul următor'],
    ['layer_vegfp_sgd', 'SGD', 'SGD']
].forEach(([key, en, ro]) => {
    assert.ok(enBlock.indexOf(key + ": '" + en + "'") !== -1,
        'EN translation for ' + key + ' must be “' + en + '”');
    assert.ok(roBlock.indexOf(key + ": '" + ro + "'") !== -1,
        'RO translation for ' + key + ' must be “' + ro + '”');
});
assert.ok(enBlock.indexOf('prem_feat_vegfp') !== -1 && roBlock.indexOf('prem_feat_vegfp') !== -1,
    'the premium modal feature line exists in both languages');

// Info popup description (RO default, EN fallback) — the exact requested text.
assert.match(mapApp, /Arată sănătatea vegetației la fiecare 10 zile de-a lungul sezonului\./,
    'the RO info description is the requested text');
assert.match(mapApp, /Structurile îngropate schimbă ritmul de creștere al culturii deasupra lor,/,
    'the RO info description explains the buried-structures signature');
assert.match(mapApp, /Shows vegetation health every 10 days throughout the season\./,
    'the EN fallback description exists');

// SMX info description — the exact requested text (RO) + EN fallback.
assert.match(mapApp, /Valoarea maximă de vegetație atinsă într-un an\./,
    'the RO SMX description is the requested text');
assert.match(mapApp, /Un zid sau o ' \+/,
    'the RO SMX description introduces the buried wall/foundation');
assert.match(mapApp, /fundație sub sol limitează cât de mult poate crește cultura/,
    'the RO SMX description explains the buried foundation limit');
assert.match(mapApp, /'și în plin sezon\.'/,
    'the RO SMX description ends with the peak-season phrase');
assert.match(mapApp, /The maximum vegetation value reached in a year\./,
    'the EN SMX fallback description exists');
assert.match(mapApp, /even in peak ' \+/,
    'the EN SMX fallback carries the peak-season close');

// SGU info description — the exact requested text (RO) + EN fallback.
assert.match(mapApp, /Cât de repede crește vegetația la începutul sezonului\./,
    'the RO SGU description is the requested text');
assert.match(mapApp, /Solul subțire de deasupra unei structuri îngropate se încălzește și/,
    'the RO SGU description explains the thin-soil mechanism');
assert.match(mapApp, /o diferență vizibilă exact în perioada de /,
    'the RO SGU description carries the early-growth visibility note');
assert.match(mapApp, /'creștere timpurie\.'/,
    'the RO SGU description ends with the early-growth period phrase');
assert.match(mapApp, /How fast the vegetation grows at the start of the season\./,
    'the EN SGU fallback description exists');
assert.match(mapApp, /Cât de rapid se ofilește vegetația spre final de sezon\./,
    'the RO SGD description is the requested text');
assert.match(mapApp, /sezon\. Șanțurile ' \+/,
    'the RO SGD description introduces the buried-ditch marker');
assert.match(mapApp, /umplute cu sol mai afânat rețin apa mai mult, întârziind ofilirea /,
    'the RO SGD description explains the loose-soil water retention');
assert.match(mapApp, /'deasupra lor\.'/,
    'the RO SGD description ends above the ditch');
assert.match(mapApp, /How quickly the vegetation wilts toward the end of the season\./,
    'the EN SGD fallback description exists');
assert.match(mapApp, /window\.showVegfpSgdInfo = function/,
    'the SGD info window is exposed');
assert.match(mapApp, /_vegfpInfoDescription\('sgd'\)/,
    'the SGD info window requests its own description');
assert.match(mapApp, /window\.showVegfpSmxInfo = function/,
    'the SMX info window is exposed');
assert.match(mapApp, /showLayerInfo\('SMX — Season Maximum value \(MAXV\)'/,
    'the SMX info window carries the MAXV title');
assert.match(mapApp, /window\.showVegfpSguInfo = function/,
    'the SGU info window is exposed');
assert.match(mapApp, /_vegfpInfoDescription\('ppi'\)/,
    'the PPI info window requests its own description');
assert.match(mapApp, /_vegfpInfoDescription\('smx'\)/,
    'the SMX info window requests its own description');
assert.match(mapApp, /_vegfpInfoDescription\('sgu'\)/,
    'the SGU info window requests its own description');

// Service worker rollout.
assert.match(sw, /const CACHE_NAME = 'detectlab-v143-vegfp-smx'/,
    'the app-shell cache is re-versioned so installed PWAs pick up the new layer');
[
    'js/map-app.js?v=20260926-vegfp-smx',
    'js/translations.js?v=20260926-vegfp-smx',
    'js/subscriptions.js?v=20260926-vegfp-smx',
    'js/vertical-opacity-control.js?v=20260926-vegfp-smx'
].forEach((url) => {
    assert.ok(sw.indexOf("'" + url + "'") !== -1, 'SW precaches ' + url);
    assert.ok(html.indexOf(url) !== -1, 'index.html references ' + url);
});
assert.match(sw, /'hrvpp2\.vgt\.vito\.be'/,
    'the HR-VPP tile host is listed as a passthrough (never app-shell cached)');

// ══════════════════════════════════════════════════════════════════
// SMX — al doilea substrat (VPP MAXV SEASON1, „time” anual)
// ══════════════════════════════════════════════════════════════════

assert.match(mapApp, /var VEGFP_SMX_LAYER_NAME = 'CLMS_HRVPP_VPP_MAXV_SEASON1_10M';/,
    'SMX uses the VPP MAXV SEASON1 layer (season maximum value)');

const smxBuilder = mapApp.slice(mapApp.indexOf('function _vegfpBuildSmxUrl'),
    mapApp.indexOf('function _vegfpBuildSmxUrl') + 1200);
[
    /VEGFP_WMTS_BASE \+/, /'&LAYER=' \+ VEGFP_SMX_LAYER_NAME/, /&STYLE=/,
    /&FORMAT=image%2Fpng/, /&TILEMATRIXSET=EPSG%3A3857/,
    /&TILEMATRIX=EPSG%3A3857%3A\{z\}/, /&TILEROW=\{y\}/, /&TILECOL=\{x\}/,
    /'&TIME=' \+ time/
].forEach((re) => assert.ok(re.test(smxBuilder), 'SMX builder matches ' + re));

assert.match(mapApp, /var VEGFP_SMX_DEFAULT_TIME = '2024-01-01';/,
    'the SMX default TIME is the latest complete year');
assert.match(mapApp, /return new VegFpTileLayer\(_vegfpBuildSmxUrl\(_vegfpSmxTime\), _vegfpTilePerfOptions\(\{/,
    'the SMX layer reuses the masked VegFpTileLayer class');
assert.match(mapApp, /className: 'vegfp-smx-tiles',/,
    'the SMX tiles get their own CSS class');
assert.match(mapApp, /window\._vegfpSmxLayer = _vegfpSmxLayer;/,
    'the SMX instance is exposed for the coverage rectangle');
assert.match(mapApp, /_vegfpSmxLayer\.setUrl\(_vegfpBuildSmxUrl\(timeStr\)\)/,
    'switching the year rebuilds the URL and reloads visible tiles');
assert.match(mapApp, /window\.vegfpSmxStepYear = function \(dir\)/,
    'the ‹ › steppers walk the year list');
assert.match(mapApp, /layer === 'smx'/,
    'the SMX description branch is keyed correctly');

assert.match(mapApp, /var smxToggle = document\.getElementById\('vegfpSmxToggle'\);[\s\S]*?window\.toggleVegfpSmxLayer\(false\);/,
    'turning the master off also stops SMX');
assert.match(mapApp, /window\.toggleVegfpSmxLayer = function[\s\S]*?master\.checked = true;/,
    'starting SMX auto-starts the group master');

[
    ['id="vegfpSmxRow"', 'the SMX sublayer row exists'],
    ['id="vegfpSmxToggle" onchange="toggleVegfpSmxLayer(this.checked)"', 'the SMX switch is wired'],
    ['id="vegfpSmxYearSelect" onchange="setVegfpSmxYear(this.value)"', 'the year selector is wired'],
    ['id="vegfpSmxPrevBtn" onclick="vegfpSmxStepYear(-1)"', 'the ‹ year stepper is wired'],
    ['id="vegfpSmxNextBtn" onclick="vegfpSmxStepYear(1)"', 'the › year stepper is wired'],
    ['id="vegfpSmxOpacitySlider"', 'the SMX opacity slider exists'],
    ['oninput="setVegfpSmxOpacity(this.value)"', 'the SMX opacity slider is wired'],
    ['id="vegfpSmxPct">85%', 'the SMX opacity readout starts at the layer default'],
    ['showVegfpSmxInfo()', 'the SMX info button calls its info window'],
    ['data-key="layer_vegfp_smx"', 'the SMX label is translated'],
    ['title="Valoarea maximă de vegetație — anul"', 'the year selector is titled for the maximum value'],
    ["showLayerInfo('SMX — Season Maximum value'", 'the SMX fallback info title is correct']
].forEach(([needle, why]) => assert.ok(html.indexOf(needle) !== -1, why));
const smxRowHtml = html.slice(html.indexOf('id="vegfpSmxRow"'), html.indexOf('id="vegfpSguRow"'));
assert.ok(smxRowHtml.indexOf('layer_vegfp_smx') < smxRowHtml.indexOf('layer_vegfp_year_label'),
    'the SMX label comes first in the row (vertical mirror names the slider “SMX”)');
assert.ok(html.indexOf('id="vegfpPpiRow"') < html.indexOf('id="vegfpSmxRow"') &&
    html.indexOf('id="vegfpSmxRow"') < html.indexOf('id="vegfpSguRow"') &&
    html.indexOf('id="vegfpSguRow"') < html.indexOf('id="vegfpSgdRow"'),
    'the panel rows are ordered PPI → SMX → SGU → SGD');
['vegfpSmxRow', 'vegfpSmxToggle', 'vegfpSmxYearSelect', 'vegfpSmxPrevBtn',
 'vegfpSmxNextBtn', 'vegfpSmxOpacitySlider', 'vegfpSmxPct'].forEach((id) => {
    assert.strictEqual((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
        'id ' + id + ' must be unique');
});

assert.match(voc, /vegfpSmxOpacitySlider: 'SMX · Vegetation Fingerprint'/,
    'the vertical mirror knows the SMX slider title');
assert.match(voc, /vegfpSmxOpacitySlider: 'vegfpSmxToggle'/,
    'the vertical mirror links the SMX slider to its toggle');

assert.match(mapApp, /vegfpSmx: \{[\s\S]*?layerVar: '_vegfpSmxLayer',\s*\n\s*coverageMinZoom: 6/,
    'the coverage rectangle is registered for SMX with the z6 minimum');
assert.match(mapApp, /key: 'vegfp_smx',[\s\S]*?group: 'vegfp'/,
    'the SMX row is registered for visibility highlighting');

// ══════════════════════════════════════════════════════════════════
// SGU — al treilea substrat (VPP LSLOPE SEASON1, „time” anual)
// ══════════════════════════════════════════════════════════════════

// Endpoint + layer name: same HTTPS WMTS KVP service, VPP LSLOPE SEASON1.
assert.match(mapApp, /var VEGFP_SGU_LAYER_NAME = 'CLMS_HRVPP_VPP_LSLOPE_SEASON1_10M';/,
    'SGU uses the VPP LSLOPE SEASON1 layer (rate of growth at season start)');

// The SGU URL builder carries the same verified KVP shape with its own layer.
const sguBuilder = mapApp.slice(mapApp.indexOf('function _vegfpBuildSguUrl'),
    mapApp.indexOf('function _vegfpBuildSguUrl') + 1200);
[
    /VEGFP_WMTS_BASE \+/, /'&LAYER=' \+ VEGFP_SGU_LAYER_NAME/, /&STYLE=/,
    /&FORMAT=image%2Fpng/, /&TILEMATRIXSET=EPSG%3A3857/,
    /&TILEMATRIX=EPSG%3A3857%3A\{z\}/, /&TILEROW=\{y\}/, /&TILECOL=\{x\}/,
    /'&TIME=' \+ time/
].forEach((re) => assert.ok(re.test(sguBuilder), 'SGU builder matches ' + re));

// Annual TIME dimension: 2017-01-01 … 2024-01-01, default = the latest year.
const vppYearsFn = mapApp.slice(mapApp.indexOf('var VEGFP_VPP_YEARS'),
    mapApp.indexOf('var VEGFP_VPP_YEARS') + 400);
assert.match(vppYearsFn, /\[2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024\]/,
    'the shared VPP year list (SMX + SGU + SGD) covers 2017–2024');
assert.match(mapApp, /var VEGFP_SGU_DEFAULT_TIME = '2024-01-01';/,
    'the SGU default TIME is the latest complete year');
assert.match(mapApp, /years\[i\]\.slice\(0, 4\); \/\/ doar anul/,
    'the year selector shows just the year, value stays YYYY-01-01');

// Year switching + clamping at both ends of the list.
assert.match(mapApp, /_vegfpSguLayer\.setUrl\(_vegfpBuildSguUrl\(timeStr\)\)/,
    'switching the year rebuilds the URL and reloads visible tiles');
assert.match(mapApp, /window\.vegfpSguStepYear = function \(dir\)/,
    'the ‹ › steppers walk the year list');
assert.match(mapApp, /if \(next < 0 \|\| next >= years\.length\) return; \/\/ capetele listei/,
    'the year stepper clamps at the ends of the list');
assert.match(mapApp, /!\/\^\\d\{4\}-01-01\$\/\.test\(timeStr\)/,
    'only YYYY-01-01 values are accepted for the SGU time');

// Same mask, bounds and zoom discipline as PPI (shared VegFpTileLayer).
assert.match(mapApp, /return new VegFpTileLayer\(_vegfpBuildSguUrl\(_vegfpSguTime\), _vegfpTilePerfOptions\(\{/,
    'the SGU layer reuses the masked VegFpTileLayer class');
assert.match(mapApp, /className: 'vegfp-sgu-tiles',/,
    'the SGU tiles get their own CSS class');
assert.match(mapApp, /window\._vegfpSguLayer = _vegfpSguLayer;/,
    'the SGU instance is exposed for the coverage rectangle');

// Master ↔ sub cascade, both directions, for SGU as well.
assert.match(mapApp, /var sguToggle = document\.getElementById\('vegfpSguToggle'\);[\s\S]*?window\.toggleVegfpSguLayer\(false\);/,
    'turning the master off also stops SGU');
assert.match(mapApp, /window\.toggleVegfpSguLayer = function[\s\S]*?master\.checked = true;/,
    'starting SGU auto-starts the group master');

// HTML wiring: the full SGU row (premium, like PPI).
[
    ['id="vegfpSguRow"', 'the SGU sublayer row exists'],
    ['id="vegfpSguToggle" onchange="toggleVegfpSguLayer(this.checked)"', 'the SGU switch is wired'],
    ['id="vegfpSguYearSelect" onchange="setVegfpSguYear(this.value)"', 'the year selector is wired'],
    ['id="vegfpSguPrevBtn" onclick="vegfpSguStepYear(-1)"', 'the ‹ year stepper is wired'],
    ['id="vegfpSguNextBtn" onclick="vegfpSguStepYear(1)"', 'the › year stepper is wired'],
    ['id="vegfpSguOpacitySlider"', 'the SGU opacity slider exists'],
    ['oninput="setVegfpSguOpacity(this.value)"', 'the SGU opacity slider is wired'],
    ['id="vegfpSguPct">85%', 'the SGU opacity readout starts at the layer default'],
    ['showVegfpSguInfo()', 'the SGU info button calls its info window'],
    ['data-key="layer_vegfp_sgu"', 'the SGU label is translated'],
    ['data-key="layer_vegfp_year_label"', 'the year label is translated']
].forEach(([needle, why]) => assert.ok(html.indexOf(needle) !== -1, why));
// Vertical-mirror naming: inside the SGU row, the SGU label precedes the year label.
const sguRowHtml = html.slice(html.indexOf('id="vegfpSguRow"'), html.indexOf('/vegfpSubLayers'));
assert.ok(sguRowHtml.indexOf('layer_vegfp_sgu') < sguRowHtml.indexOf('layer_vegfp_year_label'),
    'the SGU label comes first in the row (vertical mirror names the slider “SGU”)');
assert.ok(sguRowHtml.indexOf('data-category="premium"') === -1 &&
    /data-category="premium" id="vegfpRow"/.test(html),
    'the SGU row inherits the premium category from the group row');
// No duplicate ids introduced.
['vegfpSguRow', 'vegfpSguToggle', 'vegfpSguYearSelect', 'vegfpSguPrevBtn',
 'vegfpSguNextBtn', 'vegfpSguOpacitySlider', 'vegfpSguPct'].forEach((id) => {
    assert.strictEqual((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
        'id ' + id + ' must be unique');
});

// Premium gating: SGU's toggle is wrapped too.
assert.match(subscriptions, /'toggleVegfpPpiLayer',[^\n]*\n\s*'toggleVegfpSmxLayer'/,
    'the SMX toggle is wrapped by PREMIUM_TOGGLE_FNS right after PPI');
assert.match(subscriptions, /'toggleVegfpSmxLayer',[^\n]*\n\s*'toggleVegfpSguLayer'/,
    'the SGU toggle is wrapped right after SMX');
assert.match(subscriptions, /'toggleVegfpSguLayer',[^\n]*\n\s*'toggleVegfpSgdLayer'/,
    'the SGD toggle is wrapped right after SGU');

// Vertical opacity mirror for SGU.
assert.match(voc, /vegfpSguOpacitySlider: 'SGU · Vegetation Fingerprint'/,
    'the vertical mirror knows the SGU slider title');
assert.match(voc, /vegfpSguOpacitySlider: 'vegfpSguToggle'/,
    'the vertical mirror links the SGU slider to its toggle');

// Red coverage rectangle + visibility highlight for SGU.
assert.match(mapApp, /vegfpSgu: \{[\s\S]*?layerVar: '_vegfpSguLayer',\s*\n\s*coverageMinZoom: 6/,
    'the coverage rectangle is registered for SGU with the z6 minimum');
assert.match(mapApp, /key: 'vegfp_sgu',[\s\S]*?group: 'vegfp'/,
    'the SGU row is registered for visibility highlighting');
assert.match(mapApp, /vegfp: \{ expandIconId: 'vegfpExpandIcon', sublayerKeys: \['vegfp_ppi', 'vegfp_smx', 'vegfp_sgu', 'vegfp_sgd'\] \}/,
    'the group arrow highlight covers both sublayers');

// ══════════════════════════════════════════════════════════════════
// SGD — al patrulea substrat (VPP RSLOPE SEASON1, „time” anual)
// ══════════════════════════════════════════════════════════════════

assert.match(mapApp, /var VEGFP_SGD_LAYER_NAME = 'CLMS_HRVPP_VPP_RSLOPE_SEASON1_10M';/,
    'SGD uses the VPP RSLOPE SEASON1 layer (wilting rate at season end)');

const sgdBuilder = mapApp.slice(mapApp.indexOf('function _vegfpBuildSgdUrl'),
    mapApp.indexOf('function _vegfpBuildSgdUrl') + 1200);
[
    /VEGFP_WMTS_BASE \+/, /'&LAYER=' \+ VEGFP_SGD_LAYER_NAME/, /&STYLE=/,
    /&FORMAT=image%2Fpng/, /&TILEMATRIXSET=EPSG%3A3857/,
    /&TILEMATRIX=EPSG%3A3857%3A\{z\}/, /&TILEROW=\{y\}/, /&TILECOL=\{x\}/,
    /'&TIME=' \+ time/
].forEach((re) => assert.ok(re.test(sgdBuilder), 'SGD builder matches ' + re));

assert.match(mapApp, /var VEGFP_SGD_DEFAULT_TIME = '2024-01-01';/,
    'the SGD default TIME is the latest complete year');
assert.match(mapApp, /return new VegFpTileLayer\(_vegfpBuildSgdUrl\(_vegfpSgdTime\), _vegfpTilePerfOptions\(\{/,
    'the SGD layer reuses the masked VegFpTileLayer class');
assert.match(mapApp, /className: 'vegfp-sgd-tiles',/,
    'the SGD tiles get their own CSS class');
assert.match(mapApp, /window\._vegfpSgdLayer = _vegfpSgdLayer;/,
    'the SGD instance is exposed for the coverage rectangle');
assert.match(mapApp, /_vegfpSgdLayer\.setUrl\(_vegfpBuildSgdUrl\(timeStr\)\)/,
    'switching the year rebuilds the URL and reloads visible tiles');
assert.match(mapApp, /window\.vegfpSgdStepYear = function \(dir\)/,
    'the ‹ › steppers walk the year list');
assert.match(mapApp, /!\/\^\\d\{4\}-01-01\$\/\.test\(timeStr\)/,
    'only YYYY-01-01 values are accepted for the SGD time');

assert.match(mapApp, /var sgdToggle = document\.getElementById\('vegfpSgdToggle'\);[\s\S]*?window\.toggleVegfpSgdLayer\(false\);/,
    'turning the master off also stops SGD');
assert.match(mapApp, /window\.toggleVegfpSgdLayer = function[\s\S]*?master\.checked = true;/,
    'starting SGD auto-starts the group master');

[
    ['id="vegfpSgdRow"', 'the SGD sublayer row exists'],
    ['id="vegfpSgdToggle" onchange="toggleVegfpSgdLayer(this.checked)"', 'the SGD switch is wired'],
    ['id="vegfpSgdYearSelect" onchange="setVegfpSgdYear(this.value)"', 'the year selector is wired'],
    ['id="vegfpSgdPrevBtn" onclick="vegfpSgdStepYear(-1)"', 'the ‹ year stepper is wired'],
    ['id="vegfpSgdNextBtn" onclick="vegfpSgdStepYear(1)"', 'the › year stepper is wired'],
    ['id="vegfpSgdOpacitySlider"', 'the SGD opacity slider exists'],
    ['oninput="setVegfpSgdOpacity(this.value)"', 'the SGD opacity slider is wired'],
    ['id="vegfpSgdPct">85%', 'the SGD opacity readout starts at the layer default'],
    ['showVegfpSgdInfo()', 'the SGD info button calls its info window'],
    ['data-key="layer_vegfp_sgd"', 'the SGD label is translated']
].forEach(([needle, why]) => assert.ok(html.indexOf(needle) !== -1, why));
const sgdRowHtml = html.slice(html.indexOf('id="vegfpSgdRow"'), html.indexOf('/vegfpSubLayers'));
assert.ok(sgdRowHtml.indexOf('layer_vegfp_sgd') < sgdRowHtml.indexOf('layer_vegfp_year_label'),
    'the SGD label comes first in the row (vertical mirror names the slider “SGD”)');
['vegfpSgdRow', 'vegfpSgdToggle', 'vegfpSgdYearSelect', 'vegfpSgdPrevBtn',
 'vegfpSgdNextBtn', 'vegfpSgdOpacitySlider', 'vegfpSgdPct'].forEach((id) => {
    assert.strictEqual((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
        'id ' + id + ' must be unique');
});

assert.match(voc, /vegfpSgdOpacitySlider: 'SGD · Vegetation Fingerprint'/,
    'the vertical mirror knows the SGD slider title');
assert.match(voc, /vegfpSgdOpacitySlider: 'vegfpSgdToggle'/,
    'the vertical mirror links the SGD slider to its toggle');

assert.match(mapApp, /vegfpSgd: \{[\s\S]*?layerVar: '_vegfpSgdLayer',\s*\n\s*coverageMinZoom: 6/,
    'the coverage rectangle is registered for SGD with the z6 minimum');
assert.match(mapApp, /key: 'vegfp_sgd',[\s\S]*?group: 'vegfp'/,
    'the SGD row is registered for visibility highlighting');

console.log('OK — Amprenta Vegetației / Vegetation Fingerprint (PPI + SMX + SGU + SGD) wired correctly:\n' +
    '          HTTPS WMTS · PPI 288 dekade + SMX/SGU/SGD anual (2017–2024) · tile-uri doar pentru România.');
