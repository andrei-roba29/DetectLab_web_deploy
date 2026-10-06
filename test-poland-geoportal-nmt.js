/*
 * test-poland-geoportal-nmt.js
 * ──────────────────────────────────────────────────────────────────────────
 * Poland LiDAR layer — GUGiK / Geoportal.gov.pl ISOK-NMT terrain shading.
 *
 * The bug this pins: the layer fetched successfully (HTTP 200) and drew
 * nothing, because it requested the "Skorowidze" services — the INDEX SHEETS
 * of the LiDAR measurement data (survey metadata), not terrain imagery.
 *
 * It also pins the two hard constraints of this feature:
 *   • NO TOKEN may ever appear in the code or in a request URL. The viewer's
 *     internal /gprest/services/ISOK_Cien/MapServer/tile/…?token=… endpoint is
 *     off limits.
 *   • the site is HTTPS, so every endpoint must be HTTPS (no mixed content).
 *
 * Run:  node test-poland-geoportal-nmt.js
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
function near(name, actual, expected, tol) {
    check(name, Math.abs(actual - expected) <= tol,
        'expected ' + expected + ' ±' + tol + ', got ' + actual);
}

/* ── Leaflet 1.x stub (enough of L.TileLayer for a real tile URL) ───────── */
const R = 6378137;
const HALF = Math.PI * R;

function makeLeaflet() {
    function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }
    function Point(x, y) { this.x = x; this.y = y; }

    function LatLngBounds(a, b) {
        const lats = [a.lat !== undefined ? a.lat : a[0], b.lat !== undefined ? b.lat : b[0]];
        const lngs = [a.lng !== undefined ? a.lng : a[1], b.lng !== undefined ? b.lng : b[1]];
        this._south = Math.min.apply(null, lats);
        this._north = Math.max.apply(null, lats);
        this._west = Math.min.apply(null, lngs);
        this._east = Math.max.apply(null, lngs);
    }
    LatLngBounds.prototype.getSouthWest = function () { return new LatLng(this._south, this._west); };
    LatLngBounds.prototype.getNorthEast = function () { return new LatLng(this._north, this._east); };
    LatLngBounds.prototype.contains = function (ll) {
        return ll.lat >= this._south && ll.lat <= this._north &&
            ll.lng >= this._west && ll.lng <= this._east;
    };

    const CRS = {
        EPSG3857: {
            project: (ll) => new Point(R * ll.lng * Math.PI / 180,
                R * Math.log(Math.tan(Math.PI / 4 + ll.lat * Math.PI / 360))),
            unproject: (p) => new LatLng((2 * Math.atan(Math.exp(p.y / R)) - Math.PI / 2) * 180 / Math.PI,
                p.x / R * 180 / Math.PI),
            scale: (z) => 256 * Math.pow(2, z),
            pointToLatLng: function (point, z) {
                const scale = this.scale(z);
                return this.unproject(new Point((point.x / scale - 0.5) * 2 * HALF,
                    (0.5 - point.y / scale) * 2 * HALF));
            }
        }
    };

    function TileLayer() {}
    TileLayer.prototype.options = {};
    TileLayer.prototype.initialize = function (url, options) {
        this._url = url;
        this.options = Object.assign({}, this.options, options || {});
    };
    TileLayer.prototype.getTileSize = function () {
        const s = this.options.tileSize || 256;
        return new Point(s, s);
    };
    TileLayer.prototype._tileCoordsToBounds = function (coords) {
        const size = this.getTileSize().x;
        const nw = CRS.EPSG3857.pointToLatLng(new Point(coords.x * size, coords.y * size), coords.z);
        const se = CRS.EPSG3857.pointToLatLng(new Point((coords.x + 1) * size, (coords.y + 1) * size), coords.z);
        return new LatLngBounds(nw, se);
    };
    TileLayer.prototype.onAdd = function () { this._added = true; };
    TileLayer.prototype.onRemove = function () { this._added = false; };
    TileLayer.prototype.redraw = function () { this._redrawn = (this._redrawn || 0) + 1; return this; };
    TileLayer.prototype.on = function (ev, fn, ctx) {
        (this._events = this._events || {})[ev] = fn.bind(ctx || this);
        return this;
    };
    TileLayer.prototype.off = function (ev) {
        if (this._events) delete this._events[ev];
        return this;
    };
    TileLayer.prototype.fire = function (ev, data) {
        if (this._events && this._events[ev]) this._events[ev](data || {});
        return this;
    };
    TileLayer.extend = function (proto) {
        function Child(options) { if (this.initialize) this.initialize(options); }
        Child.prototype = Object.create(TileLayer.prototype);
        Object.assign(Child.prototype, proto);
        Child.prototype.options = Object.assign({}, TileLayer.prototype.options, proto.options || {});
        Child.prototype.constructor = Child;
        return Child;
    };

    return {
        LatLng: LatLng,
        Point: Point,
        CRS: CRS,
        TileLayer: TileLayer,
        latLngBounds: function (a, b) {
            if (Array.isArray(a) && !b) return new LatLngBounds(a[0], a[1]);
            if (a instanceof LatLngBounds) return a;
            return new LatLngBounds(a, b);
        },
        setOptions: function (obj, options) {
            obj.options = Object.assign({}, obj.options, options || {});
            return obj.options;
        }
    };
}

function loadModule() {
    const L = makeLeaflet();
    const sandbox = {
        L: L,
        console: { log: () => {}, warn: (...a) => sandbox.__warnings.push(a.join(' ')), error: (...a) => sandbox.__warnings.push(a.join(' ')) },
        __warnings: []
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/geoportal-nmt-layer.js'), 'utf8'),
        sandbox, { filename: 'geoportal-nmt-layer.js' });
    return { G: sandbox.GeoportalNMT, L: L, sandbox: sandbox };
}

const { G, L, sandbox } = loadModule();
const moduleSource = fs.readFileSync(path.join(__dirname, 'js/geoportal-nmt-layer.js'), 'utf8');
const executableSource = moduleSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/* ══════════════════════════════════════════════════════════════════════════
 * 1. No tokens, no mixed content — the two hard constraints
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Security / transport constraints');

check('the module never references a token parameter',
    !/token/i.test(executableSource), 'token found in executable code');
check('the viewer-only gprest tile endpoint is not used',
    executableSource.indexOf('gprest') === -1 && executableSource.indexOf('ISOK_Cien') === -1);
check('no API key or secret is embedded',
    !/api[_-]?key|secret|password/i.test(executableSource));
check('every service URL is https',
    (executableSource.match(/http:\/\/[^\s'"]+/g) || []).length === 0,
    (executableSource.match(/http:\/\/[^\s'"]+/g) || []).join(' '));
const builtUrl = G.tileUrl('cieniowanie', [2211170.3542, 6447616.2099, 2220954.2939, 6457400.1495], 256);
check('a built tile URL carries no token', !/token/i.test(builtUrl), builtUrl);
check('a built tile URL is https', builtUrl.indexOf('https://') === 0);

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Configuration — only what the live GetCapabilities actually publishes
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] Configuration block');

eq('the WMS base is the public PZGIK/NMT service', G.CONFIG.WMS_BASE,
    'https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WMS/');
eq('the default product is the hillshade', G.CONFIG.DEFAULT_MODE, 'cieniowanie');
eq('Cieniowanie → ShadedRelief service', G.MODES.cieniowanie.service, 'ShadedRelief');
eq('Hipsometria → Hypsometry service', G.MODES.hipsometria.service, 'Hypsometry');
eq('both services expose their layer as "Raster" (from GetCapabilities)',
    G.MODES.cieniowanie.layer + '/' + G.MODES.hipsometria.layer, 'Raster/Raster');
check('the dead Skorowidze index-sheet layers are gone',
    executableSource.indexOf('Skorowidz') === -1);
eq('WMS 1.3.0', G.CONFIG.VERSION, '1.3.0');
eq('PNG so the basemap shows through', G.CONFIG.FORMAT, 'image/png');
check('transparency is requested', G.CONFIG.TRANSPARENT === true);
eq('tiles are requested in Web Mercator', G.CONFIG.CRS, 'EPSG:3857');
eq('with EPSG:4326 as the automatic fallback', G.CONFIG.FALLBACK_CRS, 'EPSG:4326');
eq('default opacity is 0.7', G.CONFIG.OPACITY, 0.7);
eq('minZoom avoids whole-country requests', G.CONFIG.MIN_ZOOM, 10);
eq('maxNativeZoom comes from the 1 m grid', G.CONFIG.MAX_NATIVE_ZOOM, 18);
check('above it the library upscales', G.CONFIG.MAX_ZOOM > G.CONFIG.MAX_NATIVE_ZOOM);
check('the tile size is inside the service limit (MaxWidth/MaxHeight 4096)',
    G.CONFIG.TILE_SIZE <= 4096);
check('keepBuffer stays small on a government server', G.CONFIG.KEEP_BUFFER <= 1);
check('a caching-proxy hook exists', 'PROXY_BASE' in G.CONFIG);
check('the attribution names GUGiK, Geoportal and ISOK/NMT',
    /GUGiK/.test(G.CONFIG.ATTRIBUTION) && /Geoportal\.gov\.pl/.test(G.CONFIG.ATTRIBUTION) &&
    /ISOK\/NMT/.test(G.CONFIG.ATTRIBUTION), G.CONFIG.ATTRIBUTION);
check('the attribution links to the Geoportal (Regulamin acceptance)',
    /href="https:\/\/www\.geoportal\.gov\.pl/.test(G.CONFIG.ATTRIBUTION));

// Poland-only bounds, from EX_GeographicBoundingBox 13.753705 48.880529 → 24.774761 54.950005
const b = G.CONFIG.BOUNDS;
check('the bounds cover Poland', b[0][0] <= 48.89 && b[0][1] <= 13.76 &&
    b[1][0] >= 54.94 && b[1][1] >= 24.77, JSON.stringify(b));
check('and nothing much beyond it', b[0][0] > 47 && b[1][1] < 26, JSON.stringify(b));

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The GetMap request
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] WMS GetMap request format');

check('the endpoint is the ShadedRelief service',
    builtUrl.indexOf('/PZGIK/NMT/GRID1/WMS/ShadedRelief?') !== -1, builtUrl);
check('SERVICE=WMS', builtUrl.indexOf('SERVICE=WMS') !== -1);
check('VERSION=1.3.0', builtUrl.indexOf('VERSION=1.3.0') !== -1);
check('REQUEST=GetMap', builtUrl.indexOf('REQUEST=GetMap') !== -1);
check('LAYERS=Raster', builtUrl.indexOf('LAYERS=Raster') !== -1);
check('STYLES is present but empty (required by the spec)',
    /[?&]STYLES=(&|$)/.test(builtUrl), builtUrl);
check('CRS=EPSG:3857 (1.3.0 uses CRS, not SRS)',
    builtUrl.indexOf('CRS=' + encodeURIComponent('EPSG:3857')) !== -1 &&
    builtUrl.indexOf('SRS=') === -1, builtUrl);
check('BBOX is minx,miny,maxx,maxy in metres',
    builtUrl.indexOf('BBOX=2211170.3542,6447616.2099,2220954.2939,6457400.1495') !== -1, builtUrl);
check('WIDTH/HEIGHT match the tile size',
    builtUrl.indexOf('WIDTH=256') !== -1 && builtUrl.indexOf('HEIGHT=256') !== -1);
check('FORMAT=image/png', builtUrl.indexOf('FORMAT=' + encodeURIComponent('image/png')) !== -1);
check('TRANSPARENT=TRUE', builtUrl.indexOf('TRANSPARENT=TRUE') !== -1);
check('switching product only changes the service name',
    G.tileUrl('hipsometria', [1, 2, 3, 4], 256) ===
    G.tileUrl('cieniowanie', [1, 2, 3, 4], 256).replace('ShadedRelief', 'Hypsometry'));
check('an unknown product falls back to the default',
    G.tileUrl('nope', [1, 2, 3, 4], 256).indexOf('ShadedRelief') !== -1);

// EPSG:4326 fallback: WMS 1.3.0 flips the axis order to lat,lon.
const url4326 = G.tileUrl('cieniowanie', [50.0077390, 19.8632812, 50.0641917, 19.9511719], 256, 'EPSG:4326');
check('the fallback requests CRS=EPSG:4326',
    url4326.indexOf('CRS=' + encodeURIComponent('EPSG:4326')) !== -1);
check('with the 1.3.0 lat,lon axis order',
    url4326.indexOf('BBOX=50.007739,19.8632812,50.0641917,19.9511719') !== -1, url4326);

// Optional caching proxy.
G.CONFIG.PROXY_BASE = 'https://nmt-cache.example.com/wms';
check('tiles honour the caching proxy when configured',
    G.tileUrl('cieniowanie', [1, 2, 3, 4], 256).indexOf('https://nmt-cache.example.com/wms/ShadedRelief?') === 0);
G.CONFIG.PROXY_BASE = '';

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Tile geometry — the shading must line up with the basemap
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Tile geometry (EPSG:3857 XYZ grid)');

const layer = G.createLayer({ mode: 'cieniowanie' });
layer._map = { options: { crs: L.CRS.EPSG3857 } };

// Kraków, 50.06 N 19.94 E → z12 tile x=2274, y=1388.
const z = 12, tx = 2274, ty = 1388;
const span = (2 * HALF) / Math.pow(2, z);
const exp = { xmin: -HALF + tx * span, ymax: HALF - ty * span };
exp.xmax = exp.xmin + span;
exp.ymin = exp.ymax - span;

const got = decodeURIComponent(layer.getTileUrl({ x: tx, y: ty, z: z }).match(/BBOX=([^&]+)/)[1])
    .split(',').map(Number);
near('tile minx matches the standard XYZ grid', got[0], exp.xmin, 0.001);
near('tile miny matches the standard XYZ grid', got[1], exp.ymin, 0.001);
near('tile maxx matches the standard XYZ grid', got[2], exp.xmax, 0.001);
near('tile maxy matches the standard XYZ grid', got[3], exp.ymax, 0.001);
check('the tile is square (no aspect-ratio distortion)',
    Math.abs((got[2] - got[0]) - (got[3] - got[1])) < 0.001);
check('the tile covers Kraków', got[0] < 2219000 && got[2] > 2219000 &&
    got[1] < 6457000 && got[3] > 6457000, got.join(','));
check('the extent comes from Leaflet, not hand-rolled Mercator maths',
    /_tileCoordsToBounds/.test(moduleSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Layer behaviour
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[5] Layer behaviour');

eq('the layer starts at zoom 10', layer.options.minZoom, 10);
eq('maxNativeZoom caps real requests', layer.options.maxNativeZoom, 18);
eq('the attribution travels with the layer', layer.options.attribution, G.CONFIG.ATTRIBUTION);
check('the layer is bounded to Poland',
    layer.options.bounds.contains(new L.LatLng(50.06, 19.94)) &&
    !layer.options.bounds.contains(new L.LatLng(46.0, 25.0)));
eq('failed tiles fall back to a transparent pixel', layer.options.errorTileUrl, G.BLANK_TILE);
check('no tile churn during gestures', layer.options.updateWhenZooming === false &&
    layer.options.updateWhenIdle === true);
eq('opacity default', layer.options.opacity, 0.7);

layer.setMode('hipsometria');
eq('setMode switches the product', layer.getMode(), 'hipsometria');
check('the URL follows the switch',
    layer.getTileUrl({ x: tx, y: ty, z: z }).indexOf('/Hypsometry?') !== -1);
check('switching redraws instead of rebuilding', layer._redrawn >= 1);
layer.setMode('cieniowanie');

// Tile errors: one warning, then an automatic CRS fallback rather than an
// empty layer.
const errLayer = G.createLayer({ mode: 'cieniowanie' });
errLayer._map = { options: { crs: L.CRS.EPSG3857 } };
errLayer.onAdd(errLayer._map);
const before = sandbox.__warnings.length;
errLayer.fire('tileerror', {});
errLayer.fire('tileerror', {});
eq('tile errors are logged once, not once per tile', sandbox.__warnings.length - before, 1);
eq('the layer stays on EPSG:3857 for a couple of failures', errLayer.options.crs, 'EPSG:3857');
for (let i = 0; i < G.CONFIG.FALLBACK_AFTER_ERRORS; i++) errLayer.fire('tileerror', {});
eq('after repeated failures it falls back to EPSG:4326', errLayer.options.crs, 'EPSG:4326');
check('the fallback URL is a valid 4326 GetMap',
    errLayer.getTileUrl({ x: tx, y: ty, z: z })
        .indexOf('CRS=' + encodeURIComponent('EPSG:4326')) !== -1);
errLayer.onRemove(errLayer._map);
check('removing the layer detaches the error handler',
    !errLayer._events || !errLayer._events.tileerror);

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Wiring in the app (Poland row only)
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[6] Wiring in the app');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const mapAppCode = mapApp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const scriptSrcs = (indexHtml.match(/<script[^>]+src="[^"]+"/g) || [])
    .map((tag) => tag.match(/src="([^"?]+)/)[1]);
check('index.html loads geoportal-nmt-layer.js before map-app.js',
    scriptSrcs.indexOf('js/geoportal-nmt-layer.js') !== -1 &&
    scriptSrcs.indexOf('js/geoportal-nmt-layer.js') < scriptSrcs.indexOf('js/map-app.js'));
check('the service worker pre-caches it', sw.indexOf('js/geoportal-nmt-layer.js') !== -1);
check('the Poland layer is built by the module', /GeoportalNMT\.createLayer/.test(mapApp));
check('no Skorowidze index sheet is used as a display layer',
    mapAppCode.indexOf('SkorowidzDanychPomiarowychLIDAR') === -1);
check('no token reaches map-app.js either',
    !/gprest|ISOK_Cien|token=/.test(mapAppCode));
check('the product dropdown offers Cieniowanie and Hipsometria',
    /value="cieniowanie"/.test(indexHtml) && /value="hipsometria"/.test(indexHtml));
check('the dropdown is also filled from the module at runtime',
    /_populatePolandModeSelect/.test(mapApp) && /GeoportalNMT\.modeKeys\(\)/.test(mapApp));
check('switching product uses setMode instead of rebuilding',
    /cfg\.leafletLayer\.setMode\(mode\)/.test(mapApp));
check('the on/off switch is unchanged',
    /toggleInternationalLidar\('plLidar', this\.checked\)/.test(indexHtml));
check('the opacity slider defaults to 70%',
    /id="lidarPlLidarOpacitySlider"[^>]*value="70"/.test(indexHtml) &&
    /id="lidarPlLidarPct">70%/.test(indexHtml));
check('the attribution reaches the layer config',
    /Cieniowanie: © GUGiK/.test(mapApp));

// Scope guard: only the Poland row changed.
check('the Norway layer still uses its own module', /Hoydedata\.createLayer/.test(mapApp));
// (The Netherlands row was later moved to js/ahn-layer.js — see
// NETHERLANDS_LIDAR_AHN.md. This guard checks that the change under
// test did not rewrite it.)
check('the Netherlands layer still uses its own module',
    /AhnLidar\.createLayer/.test(mapApp));
['SPAIN_LIDAR_WMS_URL', 'SWITZERLAND_LIDAR_WMS_URL', 'UK_LIDAR_WMS_URL',
    'FRANCE_LIDAR_WMS_URL', 'DENMARK_LIDAR_WMS_URL'].forEach(function (name) {
    check('other country service kept: ' + name, mapApp.indexOf(name) !== -1);
});

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All Poland GUGiK/Geoportal NMT shading checks passed.');
