/*
 * test-spain-idee-relieve.js
 * ──────────────────────────────────────────────────────────────────────────
 * Spain LiDAR layer — IGN/IDEE WMTS relief of the PNOA-LiDAR MDT.
 *
 * What this pins:
 *   • the layer no longer asks the INSPIRE WMS for EL.ElevationGridCoverage
 *     with the made-up style "Elevaciones" (200 OK, empty tiles);
 *   • the WMTS KVP template matches what the live service answered on
 *     2026-10-06 (200, image/png, GoogleMapsCompatible, cache HIT) and the
 *     z/x/y → TileMatrix/TileCol/TileRow mapping matches the tile bounds the
 *     server itself reported in its geowebcache-tile-bounds header;
 *   • maxNativeZoom is the real maximum from GetCapabilities (level 20);
 *   • no API key and no token, HTTPS only;
 *   • only the Spain row of the app changed.
 *
 * Run:  node test-spain-idee-relieve.js
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

/* ── Leaflet 1.x stub (enough of L.TileLayer to build a real tile URL) ──── */
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

    function TileLayer() {}
    TileLayer.prototype.options = {};
    TileLayer.prototype.initialize = function (url, options) {
        this._url = url;
        this.options = Object.assign({}, this.options, options || {});
    };
    TileLayer.prototype.getTileUrl = function (coords) {
        return this._url
            .replace('{z}', coords.z)
            .replace('{y}', coords.y)
            .replace('{x}', coords.x);
    };
    TileLayer.prototype.setUrl = function (url) {
        this._url = url;
        this.redraw();
        return this;
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
        console: {
            log: () => {},
            warn: (...a) => sandbox.__warnings.push(a.join(' ')),
            error: (...a) => sandbox.__warnings.push(a.join(' '))
        },
        __warnings: []
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/ign-mdt-layer.js'), 'utf8'),
        sandbox, { filename: 'ign-mdt-layer.js' });
    return { S: sandbox.IgnMdt, L: L, sandbox: sandbox };
}

const { S, L, sandbox } = loadModule();
const moduleSource = fs.readFileSync(path.join(__dirname, 'js/ign-mdt-layer.js'), 'utf8');
const executableSource = moduleSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/* ══════════════════════════════════════════════════════════════════════════
 * 1. No keys, no tokens, no mixed content
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Security / transport constraints');

const url = S.tileUrl('relieve', 12, 2002, 1544);
check('the module never references a token', !/token/i.test(executableSource));
check('no API key or secret is embedded',
    !/api[_-]?key|secret|password/i.test(executableSource));
check('every service URL is https',
    (executableSource.match(/http:\/\/[^\s'"]+/g) || []).length === 0,
    (executableSource.match(/http:\/\/[^\s'"]+/g) || []).join(' '));
check('a built tile URL is https', url.indexOf('https://') === 0, url);
check('a built tile URL carries no token or key', !/token|key=/i.test(url), url);

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Configuration — only what the live GetCapabilities publishes
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] Configuration block');

eq('the endpoint is the public IGN/IDEE MDT WMTS', S.CONFIG.WMTS_URL,
    'https://servicios.idee.es/wmts/mdt');
eq('the default product is the relief shading', S.CONFIG.DEFAULT_MODE, 'relieve');
eq('Relieve → layer identifier "Relieve"', S.MODES.relieve.layer, 'Relieve');
eq('the second product is the INSPIRE elevation coverage',
    S.MODES.elevacion.layer, 'EL.ElevationGridCoverage');
eq('exactly two products are offered (the service has no slope layer)',
    S.modeKeys().join(','), 'relieve,elevacion');
check('the invented "Elevaciones" style is gone',
    executableSource.indexOf('Elevaciones') === -1);
check('the old INSPIRE WMS endpoint is not used by this module',
    executableSource.indexOf('wms-inspire') === -1);
eq('the tile matrix set is GoogleMapsCompatible (= standard XYZ, EPSG:3857)',
    S.CONFIG.TILE_MATRIX_SET, 'GoogleMapsCompatible');
eq('PNG so the basemap shows through', S.CONFIG.FORMAT, 'image/png');
eq('WMTS 1.0.0', S.CONFIG.VERSION, '1.0.0');
eq('256 px tiles, as published in the matrix set', S.CONFIG.TILE_SIZE, 256);
eq('default opacity is 0.7', S.CONFIG.OPACITY, 0.7);
eq('maxNativeZoom is the real capabilities maximum (TileMatrix 0…20)',
    S.CONFIG.MAX_NATIVE_ZOOM, 20);
check('no zoom beyond the published pyramid is requested',
    S.CONFIG.MAX_ZOOM <= S.CONFIG.MAX_NATIVE_ZOOM);
check('a sensible minZoom exists', S.CONFIG.MIN_ZOOM >= 1 && S.CONFIG.MIN_ZOOM <= 8);
check('keepBuffer stays small on a government server', S.CONFIG.KEEP_BUFFER <= 1);
check('a caching-proxy hook exists', 'PROXY_URL' in S.CONFIG);
check('the attribution is the required CC BY 4.0 credit',
    /Relieve ©/.test(S.CONFIG.ATTRIBUTION) &&
    /Instituto Geográfico Nacional de España/.test(S.CONFIG.ATTRIBUTION) &&
    /CC BY 4\.0/.test(S.CONFIG.ATTRIBUTION), S.CONFIG.ATTRIBUTION);

// Coverage from the capabilities: -18.211 27.634 → 4.779 43.944.
const b = S.CONFIG.BOUNDS;
check('the bounds cover the peninsula, the Balearics and the Canaries',
    b[0][0] <= 27.64 && b[0][1] <= -18.21 && b[1][0] >= 43.94 && b[1][1] >= 4.77,
    JSON.stringify(b));
check('and nothing much beyond Spain', b[0][0] > 26 && b[1][0] < 45 &&
    b[0][1] > -19.5 && b[1][1] < 6, JSON.stringify(b));

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The GetTile request (compared with the verified live request)
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] WMTS GetTile request format');

const VERIFIED =
    'https://servicios.idee.es/wmts/mdt?service=WMTS&request=GetTile&version=1.0.0' +
    '&layer=Relieve&style=default&tilematrixset=GoogleMapsCompatible' +
    '&format=image%2Fpng&TileMatrix=12&TileRow=1544&TileCol=2002';
eq('the built URL is byte-for-byte the request that returned 200 image/png',
    url, VERIFIED);
check('the template keeps Leaflet placeholders',
    /\{z\}/.test(S.tileTemplate('relieve')) && /\{x\}/.test(S.tileTemplate('relieve')) &&
    /\{y\}/.test(S.tileTemplate('relieve')));
check('TileMatrix is the zoom level', /TileMatrix=\{z\}/.test(S.tileTemplate('relieve')));
check('TileCol is x and TileRow is y',
    /TileCol=\{x\}/.test(S.tileTemplate('relieve')) &&
    /TileRow=\{y\}/.test(S.tileTemplate('relieve')));
check('switching product only changes the layer name',
    S.tileUrl('elevacion', 12, 2002, 1544) ===
    VERIFIED.replace('layer=Relieve', 'layer=EL.ElevationGridCoverage'));
check('an unknown product falls back to the default',
    S.tileUrl('nope', 12, 2002, 1544).indexOf('layer=Relieve') !== -1);

S.CONFIG.PROXY_URL = 'https://mdt-cache.example.com/wmts/mdt';
check('tiles honour the caching proxy when configured',
    S.tileUrl('relieve', 12, 2002, 1544).indexOf('https://mdt-cache.example.com/wmts/mdt?') === 0);
S.CONFIG.PROXY_URL = '';

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Tile geometry — the relief must line up with the basemap
 *    Reference: geowebcache-tile-bounds returned by the live service for
 *    TileMatrix=12 TileCol=2002 TileRow=1544 (near Madrid/Toledo):
 *      -450061.222480502, 4921321.628427692, -440277.2828613594, 4931105.568046834
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Tile geometry (EPSG:3857 XYZ grid)');

const z = 12, tx = 2002, ty = 1544;
const span = (2 * HALF) / Math.pow(2, z);
const xmin = -HALF + tx * span;
const ymax = HALF - ty * span;
near('XYZ x=2002 at z12 matches the server tile minx', xmin, -450061.222480502, 0.5);
near('XYZ y=1544 at z12 matches the server tile maxy', ymax, 4931105.568046834, 0.5);
near('tile width matches the server tile bounds',
    span, 4931105.568046834 - 4921321.628427692, 0.5);

// Madrid 40.4168 N, 3.7038 W must fall in the tile the template asks for.
function lonToX(lon, zoom) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); }
function latToY(lat, zoom) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, zoom));
}
const mx = lonToX(-3.7038, 12), my = latToY(40.4168, 12);
check('Madrid at z12 maps to a tile inside the verified neighbourhood',
    Math.abs(mx - tx) <= 8 && Math.abs(my - ty) <= 8, mx + '/' + my);
const madridUrl = S.tileUrl('relieve', 12, mx, my);
check('…and its URL substitutes the right numbers',
    madridUrl.indexOf('TileMatrix=12&TileRow=' + my + '&TileCol=' + mx) !== -1, madridUrl);
check('no hand-rolled Mercator maths in the module (Leaflet does the grid)',
    !/6378137|20037508/.test(executableSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Layer behaviour
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[5] Layer behaviour');

const layer = S.createLayer({ mode: 'relieve' });
eq('maxNativeZoom caps real requests at the published maximum',
    layer.options.maxNativeZoom, 20);
eq('minZoom comes from the config', layer.options.minZoom, S.CONFIG.MIN_ZOOM);
eq('the attribution travels with the layer', layer.options.attribution, S.CONFIG.ATTRIBUTION);
eq('opacity default', layer.options.opacity, 0.7);
eq('keepBuffer is tiny (no far-viewport preloading)', layer.options.keepBuffer, 1);
check('the layer is bounded to Spain',
    layer.options.bounds.contains(new L.LatLng(40.4168, -3.7038)) &&
    layer.options.bounds.contains(new L.LatLng(28.29, -16.62)) &&   // Tenerife
    !layer.options.bounds.contains(new L.LatLng(48.85, 2.35)));     // Paris
eq('failed tiles fall back to a transparent pixel',
    layer.options.errorTileUrl, S.BLANK_TILE);
check('the fallback really is a transparent PNG data URI',
    S.BLANK_TILE.indexOf('data:image/png;base64,') === 0);
check('no tile churn during gestures', layer.options.updateWhenZooming === false &&
    layer.options.updateWhenIdle === true);
check('the layer does not wrap around the world', layer.options.noWrap === true);
check('the initial URL is the Relieve template',
    layer._url === S.tileTemplate('relieve'));

layer.setMode('elevacion');
eq('setMode switches the product', layer.getMode(), 'elevacion');
check('the URL follows the switch',
    layer.getTileUrl({ x: tx, y: ty, z: z }).indexOf('layer=EL.ElevationGridCoverage') !== -1);
check('switching redraws instead of rebuilding', layer._redrawn >= 1);
check('an unknown mode is ignored', layer.setMode('nope').getMode() === 'elevacion');
layer.setMode('relieve');

// Tile errors: one warning for the whole layer, never one per tile.
const errLayer = S.createLayer({ mode: 'relieve' });
errLayer.onAdd({});
const before = sandbox.__warnings.length;
errLayer.fire('tileerror', {});
errLayer.fire('tileerror', {});
errLayer.fire('tileerror', {});
eq('tile errors are logged once, not once per tile',
    sandbox.__warnings.length - before, 1);
errLayer.onRemove({});
check('removing the layer detaches the error handler',
    !errLayer._events || !errLayer._events.tileerror);

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Wiring in the app (Spain row only)
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[6] Wiring in the app');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
const mapAppCode = mapApp.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const scriptSrcs = (indexHtml.match(/<script[^>]+src="[^"]+"/g) || [])
    .map((tag) => tag.match(/src="([^"?]+)/)[1]);
check('index.html loads ign-mdt-layer.js before map-app.js',
    scriptSrcs.indexOf('js/ign-mdt-layer.js') !== -1 &&
    scriptSrcs.indexOf('js/ign-mdt-layer.js') < scriptSrcs.indexOf('js/map-app.js'));
check('the service worker pre-caches it', sw.indexOf('js/ign-mdt-layer.js') !== -1);
check('the service worker cache name was bumped', /detectlab-v15[7-9]|detectlab-v1[6-9]/.test(sw));
check('the Spain layer is built by the module', /IgnMdt\.createLayer/.test(mapApp));
check('the Spain row no longer requests the dead WMS style',
    !/wmsLayers:\s*'EL\.ElevationGridCoverage'/.test(mapAppCode) &&
    !/styles:\s*'Elevaciones'/.test(mapAppCode));
check('the product dropdown offers Relieve and Elevación',
    /value="relieve"/.test(indexHtml) && /value="elevacion"/.test(indexHtml));
check('the dropdown is also filled from the module at runtime',
    /_populateSpainModeSelect/.test(mapApp) && /IgnMdt\.modeKeys\(\)/.test(mapApp));
check('switching product uses setMode instead of rebuilding',
    /setSpainLidarMode/.test(mapApp) && /cfg\.leafletLayer\.setMode\(mode\)/.test(mapApp));
check('the on/off switch still drives the Spain row',
    /toggleInternationalLidar\('esLidar', this\.checked\)/.test(indexHtml));
check('the opacity slider defaults to 70%',
    /id="lidarEsLidarOpacitySlider"[^>]*value="70"/.test(indexHtml) &&
    /id="lidarEsLidarPct">70%/.test(indexHtml));
check('the attribution is visible in the UI config',
    /Relieve © Instituto Geográfico Nacional de España \(CC BY 4\.0\)/.test(mapApp) ||
    /Relieve ©/.test(indexHtml));
check('the fly-to bounds match the capabilities extent',
    /esLidar: \[\[27\.63, -18\.22\], \[43\.95, 4\.78\]\]/.test(mapApp));

// Scope guard: only the Spain row changed.
check('the Norway layer still uses its own module', /Hoydedata\.createLayer/.test(mapApp));
check('the Poland layer still uses its own module', /GeoportalNMT\.createLayer/.test(mapApp));
check('the Netherlands AHN6 builder is untouched',
    /imageServerUrl \+ L\.Util\.getParamString\(params, imageServerUrl\)/.test(mapApp));
['SWITZERLAND_LIDAR_WMS_URL', 'UK_LIDAR_WMS_URL', 'FRANCE_LIDAR_WMS_URL',
    'DENMARK_LIDAR_WMS_URL'].forEach(function (name) {
    check('other country service kept: ' + name, mapApp.indexOf(name) !== -1);
});

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All Spain IGN/IDEE relief (PNOA-LiDAR MDT) checks passed.');
