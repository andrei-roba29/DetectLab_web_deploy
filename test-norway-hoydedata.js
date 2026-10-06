/*
 * test-norway-hoydedata.js
 * ──────────────────────────────────────────────────────────────────────────
 * Norway LiDAR layer — Kartverket hoydedata.no ArcGIS ImageServer.
 *
 * The bug this pins: the layer used to fetch successfully (HTTP 200) and draw
 * nothing. Two different causes produce exactly that symptom, and both are
 * tested here:
 *
 *   1. the old Geonorge WMS (wms.hoyde-hoydedata-metadata-prosjekt) publishes
 *      one layer PER SURVEY PROJECT, so everywhere outside the single selected
 *      project the server returns a 200 + fully transparent PNG;
 *   2. an ArcGIS ImageServer answers `…/ImageServer?f=image&…` with 200 and
 *      `text/html` — only `…/ImageServer/exportImage?…` returns an image.
 *      (Verified live on 2026-10-06: service root → text/html, exportImage →
 *      image/png, 21 136 bytes over Bodø.)
 *
 * Everything else here is the acceptance criteria of the feature: tile
 * alignment with the basemap, the DTM/DSM switch, opacity, zoom window,
 * attribution, graceful tile errors and the click-to-identify call.
 *
 * Run:  node test-norway-hoydedata.js
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

/* ── A faithful-enough Leaflet 1.x stub ─────────────────────────────────── */
const R = 6378137;
const HALF = Math.PI * R;           // 20037508.342789244

function makeLeaflet() {
    function LatLng(lat, lng) { this.lat = lat; this.lng = lng; }
    function Point(x, y) { this.x = x; this.y = y; }
    Point.prototype.multiplyBy = function (n) { return new Point(this.x * n, this.y * n); };
    Point.prototype.add = function (p) { return new Point(this.x + p[0], this.y + p[1]); };

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
            project: function (ll) {
                return new Point(R * ll.lng * Math.PI / 180,
                    R * Math.log(Math.tan(Math.PI / 4 + ll.lat * Math.PI / 360)));
            },
            unproject: function (p) {
                return new LatLng((2 * Math.atan(Math.exp(p.y / R)) - Math.PI / 2) * 180 / Math.PI,
                    p.x / R * 180 / Math.PI);
            },
            scale: function (z) { return 256 * Math.pow(2, z); },
            pointToLatLng: function (point, z) {
                const scale = this.scale(z);
                return this.unproject(new Point((point.x / scale - 0.5) * 2 * HALF,
                    (0.5 - point.y / scale) * 2 * HALF));
            }
        }
    };

    const L = {
        LatLng: LatLng,
        Point: Point,
        CRS: CRS,
        latLng: function (a, b) { return new LatLng(a, b); },
        latLngBounds: function (a, b) {
            if (Array.isArray(a) && !b) return new LatLngBounds(a[0], a[1]);
            if (a instanceof LatLngBounds) return a;
            return new LatLngBounds(a, b);
        },
        point: function (x, y) { return new Point(x, y); },
        setOptions: function (obj, options) {
            obj.options = Object.assign({}, obj.options, options || {});
            return obj.options;
        },
        DomUtil: {
            create: function (tag, className) {
                return { tagName: tag, className: className, style: {}, setAttribute: function () {} };
            }
        },
        Util: {
            getParamString: function (obj, existing) {
                const parts = [];
                for (const k in obj) parts.push(k + '=' + encodeURIComponent(obj[k]));
                return ((existing && existing.indexOf('?') !== -1) ? '&' : '?') + parts.join('&');
            }
        },
        popup: function () {
            const p = {
                setLatLng: function () { return p; },
                setContent: function (c) { p.content = c; return p; },
                openOn: function () { return p; }
            };
            return p;
        }
    };

    // Minimal GridLayer with the real _tileCoordsToBounds semantics.
    function GridLayer() {}
    GridLayer.prototype.options = {};
    GridLayer.prototype.getTileSize = function () {
        const s = this.options.tileSize || 256;
        return new Point(s, s);
    };
    GridLayer.prototype._tileCoordsToBounds = function (coords) {
        const size = this.getTileSize().x;
        const nw = CRS.EPSG3857.pointToLatLng(new Point(coords.x * size, coords.y * size), coords.z);
        const se = CRS.EPSG3857.pointToLatLng(new Point((coords.x + 1) * size, (coords.y + 1) * size), coords.z);
        return new LatLngBounds(nw, se);
    };
    GridLayer.prototype.onAdd = function () {};
    GridLayer.prototype.redraw = function () { this._redrawn = (this._redrawn || 0) + 1; return this; };
    GridLayer.extend = function (proto) {
        function Child(options) { if (this.initialize) this.initialize(options); }
        Child.prototype = Object.create(GridLayer.prototype);
        Object.assign(Child.prototype, proto);
        Child.prototype.options = Object.assign({}, GridLayer.prototype.options, proto.options || {});
        Child.prototype.constructor = Child;
        return Child;
    };
    L.GridLayer = GridLayer;
    return L;
}

function loadModule(fetchImpl) {
    const L = makeLeaflet();
    const sandbox = {
        console: { log: () => {}, warn: (...a) => sandbox.__warnings.push(a.join(' ')), error: (...a) => sandbox.__warnings.push(a.join(' ')) },
        L: L,
        fetch: fetchImpl || (() => Promise.reject(new Error('no network in tests'))),
        Promise: Promise,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        AbortController: typeof AbortController === 'function' ? AbortController : undefined,
        __warnings: []
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/hoydedata-layer.js'), 'utf8'),
        sandbox, { filename: 'hoydedata-layer.js' });
    return { H: sandbox.Hoydedata, L: L, sandbox: sandbox };
}

const { H, L, sandbox } = loadModule();

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Configuration — only services that were verified on the live server
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Configuration block');

check('the module is exposed as window.Hoydedata', !!H && typeof H.createLayer === 'function');
eq('the ArcGIS root is hoydedata.no', H.CONFIG.HOST,
    'https://hoydedata.no/arcgis/rest/services');
eq('the default product is bare terrain', H.CONFIG.DEFAULT_MODE, 'dtm');
eq('DTM points at the verified service', H.MODES.dtm.service, 'NHM_DTM_25833');
eq('DSM points at the surface model Kartverket actually publishes',
    H.MODES.dsm.service, 'NHM_DOM_25833');
eq('the hillshade raster function is the verified one',
    H.MODES.dtm.renderingRule, 'skyggerelieff');
eq('the DSM uses the same raster function', H.MODES.dsm.renderingRule, 'skyggerelieff');
eq('the local-relief product uses its own raster function',
    H.MODES.lrm.renderingRule, 'LokalHoyde');

// NHM_DSM_25833 answers 404 — a guessed name must never come back.
const moduleSource = fs.readFileSync(path.join(__dirname, 'js/hoydedata-layer.js'), 'utf8');
const executableSource = moduleSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
check('the non-existent NHM_DSM_25833 service is not requested anywhere',
    executableSource.indexOf('NHM_DSM_25833') === -1);
check('the dead per-project Geonorge WMS is gone from the module',
    executableSource.indexOf('hoyde-hoydedata-metadata-prosjekt') === -1);

eq('default opacity is 0.7', H.CONFIG.OPACITY, 0.7);
eq('minZoom keeps whole-country requests off the server', H.CONFIG.MIN_ZOOM, 8);
eq('maxNativeZoom is sensible', H.CONFIG.MAX_NATIVE_ZOOM, 17);
eq('tiles are 256 px', H.CONFIG.TILE_SIZE, 256);
check('the tile size is inside the service limit (maxImageWidth/Height 4096)',
    H.CONFIG.TILE_SIZE <= 4096);
check('keepBuffer stays small so we do not hammer a public server',
    H.CONFIG.KEEP_BUFFER <= 1, String(H.CONFIG.KEEP_BUFFER));
eq('the required attribution string is exact', H.CONFIG.ATTRIBUTION,
    'Hillshade © Kartverket (CC BY 4.0)');
check('a caching-proxy hook exists', 'PROXY_BASE' in H.CONFIG);
check('no API key, token or secret is embedded',
    !/api[_-]?key|token=|secret/i.test(executableSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The exportImage URL
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] exportImage request format');

const bbox = [1593216.7278, 10226510.001, 1612784.607, 10246077.8803]; // z11 tile over Bodø
const url = H.exportImageUrl('dtm', bbox, 256);

check('the /exportImage OPERATION is used, not the service root',
    url.indexOf('/NHM_DTM_25833/ImageServer/exportImage?') !== -1, url);
check('requesting the service root with f=image is impossible',
    !/ImageServer\?f=image/.test(url));
check('f=image', url.indexOf('f=image') !== -1);
check('format is a PNG variant', /format=png(32)?(&|$)/.test(url), url);
check('bbox is xmin,ymin,xmax,ymax', url.indexOf('bbox=1593216.7278,10226510.001,1612784.607,10246077.8803') !== -1, url);
check('bboxSR=3857', url.indexOf('bboxSR=3857') !== -1);
check('imageSR=3857', url.indexOf('imageSR=3857') !== -1);
check('size matches the tile size', url.indexOf('size=256,256') !== -1);
check('transparent=true so the basemap shows through', url.indexOf('transparent=true') !== -1);
check('the renderingRule JSON is URL-encoded',
    url.indexOf('renderingRule=' + encodeURIComponent('{"rasterFunction":"skyggerelieff"}')) !== -1, url);
check('the DSM switch only changes the service name',
    H.exportImageUrl('dsm', bbox, 256) === url.replace('NHM_DTM_25833', 'NHM_DOM_25833'));
check('an unknown mode falls back to the default instead of building junk',
    H.exportImageUrl('nope', bbox, 256).indexOf('NHM_DTM_25833') !== -1);

// Optional caching proxy in front of the public server.
H.CONFIG.PROXY_BASE = 'https://cache.example.com/arcgis/rest/services';
check('tiles honour the caching proxy when one is configured',
    H.exportImageUrl('dtm', bbox, 256).indexOf('https://cache.example.com/') === 0);
check('identify still goes to the origin service',
    H.identifyUrl('dtm', 1, 2).indexOf('https://hoydedata.no/') === 0);
H.CONFIG.PROXY_BASE = '';

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Tile alignment — the hillshade must sit exactly on the basemap
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] Tile geometry (EPSG:3857 XYZ grid)');

const layer = H.createLayer({ mode: 'dtm' });
layer._map = { options: { crs: L.CRS.EPSG3857 } };

// Bodø, 67.28 N 14.40 E → z11 tile x=1105, y=500 of the standard grid.
const z = 11, tx = 1105, ty = 500;
const span = (2 * HALF) / Math.pow(2, z);
const expected = {
    xmin: -HALF + tx * span,
    ymax: HALF - ty * span
};
expected.xmax = expected.xmin + span;
expected.ymin = expected.ymax - span;

const tileUrl = layer.tileUrl({ x: tx, y: ty, z: z });
const got = decodeURIComponent(tileUrl.match(/bbox=([^&]+)/)[1]).split(',').map(Number);
near('tile xmin matches the standard XYZ grid', got[0], expected.xmin, 0.001);
near('tile ymin matches the standard XYZ grid', got[1], expected.ymin, 0.001);
near('tile xmax matches the standard XYZ grid', got[2], expected.xmax, 0.001);
near('tile ymax matches the standard XYZ grid', got[3], expected.ymax, 0.001);
check('the tile is square (no aspect-ratio distortion)',
    Math.abs((got[2] - got[0]) - (got[3] - got[1])) < 0.001);
check('the tile covers Bodø (sanity: the layer is over Norway)',
    got[0] < 1603000 && got[2] > 1603000 && got[1] < 10236293 && got[3] > 10236293,
    got.join(','));
check('the bounds come from Leaflet, not hand-rolled Mercator maths',
    /_tileCoordsToBounds/.test(moduleSource) && /CRS\.EPSG3857|options\.crs/.test(moduleSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Layer behaviour: zoom window, opacity, DTM/DSM switch, tile errors
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Layer behaviour');

eq('the layer starts at zoom 8', layer.options.minZoom, 8);
eq('maxNativeZoom caps real requests at z17', layer.options.maxNativeZoom, 17);
check('above maxNativeZoom Leaflet overzooms instead of 404-ing',
    layer.options.maxZoom > layer.options.maxNativeZoom);
eq('the attribution is carried by the layer', layer.options.attribution,
    'Hillshade © Kartverket (CC BY 4.0)');
check('the layer is bounded to the Norwegian service extent',
    !!layer.options.bounds && layer.options.bounds.contains(new L.LatLng(67.28, 14.40)) &&
    !layer.options.bounds.contains(new L.LatLng(45.0, 25.0)));
check('no tile churn during gestures (updateWhenZooming false)',
    layer.options.updateWhenZooming === false);
check('pan updates happen on idle (updateWhenIdle true)',
    layer.options.updateWhenIdle === true);

layer.setOpacity(0.42);
eq('setOpacity records the value', layer.options.opacity, 0.42);

layer.setMode('dsm');
eq('setMode switches the product', layer.getMode(), 'dsm');
check('the URL follows the switch',
    layer.tileUrl({ x: tx, y: ty, z: z }).indexOf('NHM_DOM_25833') !== -1);
check('switching redraws instead of rebuilding the layer', layer._redrawn >= 1);
layer.setMode('lrm');
check('the local-relief product widens the bounds to Svalbard',
    layer.options.bounds.contains(new L.LatLng(78.2, 15.6)));
layer.setMode('dtm');

// Tile error handling: transparent fallback, no console spam, no broken icon.
const errLayer = H.createLayer({ mode: 'dtm' });
errLayer._map = { options: { crs: L.CRS.EPSG3857 } };
let reported = [];
const t1 = errLayer.createTile({ x: tx, y: ty, z: z }, (err) => reported.push(err));
const warningsBefore = sandbox.__warnings.length;
t1.onerror(new Error('boom'));
const t2 = errLayer.createTile({ x: tx + 1, y: ty, z: z }, (err) => reported.push(err));
t2.onerror(new Error('boom'));
eq('a failed tile reports no error to Leaflet (no retry storm)',
    reported.filter(Boolean).length, 0);
check('a failed tile falls back to a transparent pixel',
    t1.src === H.BLANK_TILE && t2.src === H.BLANK_TILE);
eq('failures are logged once per layer, not once per tile',
    sandbox.__warnings.length - warningsBefore, 1);
check('a successful tile resolves normally', (function () {
    let done = false;
    const t = errLayer.createTile({ x: tx, y: ty + 1, z: z }, () => { done = true; });
    t.onload();
    return done && t.src.indexOf('exportImage') !== -1;
})());

/* ══════════════════════════════════════════════════════════════════════════
 * 5. identify — elevation under the cursor
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[5] Click → elevation (identify)');

const idUrl = H.identifyUrl('dtm', 1603000.67, 10236293.94);
check('identify uses the /identify operation',
    idUrl.indexOf('/NHM_DTM_25833/ImageServer/identify?') !== -1, idUrl);
check('f=json', idUrl.indexOf('f=json') !== -1);
check('the point geometry is URL-encoded JSON with wkid 3857',
    idUrl.indexOf('geometry=' + encodeURIComponent(
        '{"x":1603000.67,"y":10236293.94,"spatialReference":{"wkid":3857}}')) !== -1, idUrl);
check('geometryType=esriGeometryPoint', idUrl.indexOf('geometryType=esriGeometryPoint') !== -1);
check('returnGeometry=false', idUrl.indexOf('returnGeometry=false') !== -1);

// The recorded live response for 67.28 N 14.40 E.
const LIVE_RESPONSE = { objectId: 0, name: 'Pixel', value: '17.5408' };
(async function () {
    let requested = null;
    const mod = loadModule(function (u) {
        requested = u;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(LIVE_RESPONSE) });
    });
    const res = await mod.H.identify(new mod.L.LatLng(67.28, 14.40), 'dtm');
    check('identify is a plain same-URL fetch (CORS verified: the server reflects Origin)',
        typeof requested === 'string' && requested.indexOf('https://hoydedata.no/') === 0);
    near('the live pixel value is parsed', res.elevation, 17.5408, 1e-6);
    eq('it is formatted for a popup', mod.H.formatIdentify(res), 'Elevation: 17.5 m');

    const noData = loadModule(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ value: 'NoData' }) }));
    const outside = await noData.H.identify(new noData.L.LatLng(60, 10), 'dtm');
    eq('NoData becomes null, not NaN', outside.elevation, null);
    eq('and reads as a human sentence', noData.H.formatIdentify(outside), 'No elevation data here');

    const broken = loadModule(() => Promise.resolve({ ok: false, status: 500 }));
    let threw = false;
    await broken.H.identify(new broken.L.LatLng(60, 10), 'dtm').catch(() => { threw = true; });
    check('a failing identify rejects so the caller can show a fallback', threw);

    /* ══════════════════════════════════════════════════════════════════════
     * 6. Wiring in the app (Norway row only)
     * ═════════════════════════════════════════════════════════════════════ */
    console.log('\n[6] Wiring in the app');

    const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

    const scriptSrcs = (indexHtml.match(/<script[^>]+src="[^"]+"/g) || [])
        .map((tag) => tag.match(/src="([^"?]+)/)[1]);
    check('index.html loads hoydedata-layer.js before map-app.js',
        scriptSrcs.indexOf('js/hoydedata-layer.js') !== -1 &&
        scriptSrcs.indexOf('js/hoydedata-layer.js') < scriptSrcs.indexOf('js/map-app.js'));
    check('the service worker pre-caches it', sw.indexOf('js/hoydedata-layer.js') !== -1);

    check('the Norway layer is built by the module', /Hoydedata\.createLayer/.test(mapApp));
    const mapAppCode = mapApp
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    check('the dead per-project Geonorge WMS is gone from map-app.js',
        mapAppCode.indexOf('hoyde-hoydedata-metadata-prosjekt') === -1);
    check('its GetCapabilities catalogue fetch is gone too',
        mapApp.indexOf('NORWAY_LIDAR_CATALOG_URL') === -1 &&
        mapApp.indexOf('_loadNorwayLidarCatalog') === -1);
    check('the product dropdown is populated from the module',
        /_populateNorwayModeSelect/.test(mapApp) && /Hoydedata\.modeKeys\(\)/.test(mapApp));
    check('the dropdown change handler switches product',
        /setNorwayLidarMode\(this\.value\)/.test(mapApp));
    check('the old setNorwayLidarRegion entry point still exists (no dead onchange)',
        /setNorwayLidarRegion\s*=\s*window\.setNorwayLidarMode/.test(mapApp));
    check('the on/off switch is unchanged (toggleInternationalLidar)',
        /toggleInternationalLidar\('noLidar', this\.checked\)/.test(indexHtml));
    check('the opacity slider defaults to 70%',
        /id="lidarNoLidarOpacitySlider"[^>]*value="70"/.test(indexHtml) &&
        /id="lidarNoLidarPct">70%/.test(indexHtml));
    check('the product dropdown is still in the Norway row',
        /id="norwayLidarRegionSelect"/.test(indexHtml));
    check('identify is only live while the Norway layer is on the map',
        /_setNorwayIdentifyEnabled/.test(mapApp) &&
        /key === 'noLidar' && window\._setNorwayIdentifyEnabled/.test(mapApp));
    check('the identify click ignores the click that ends a pan',
        /_norwayIdentifyClick[\s\S]{0,900}_draggableMoved/.test(mapApp));
    check('the attribution reaches the layer config',
        /Hillshade © Kartverket \(CC BY 4\.0\)/.test(mapApp));

    // Scope guard: this change must not touch the other LiDAR countries.
    check('the Netherlands AHN6 builder is untouched',
        /imageServerUrl \+ L\.Util\.getParamString\(params, imageServerUrl\)/.test(mapApp));
    ['POLAND_LIDAR_KRON86_WMS_URL', 'SPAIN_LIDAR_WMS_URL', 'SWITZERLAND_LIDAR_WMS_URL',
        'UK_LIDAR_WMS_URL', 'FRANCE_LIDAR_WMS_URL', 'DENMARK_LIDAR_WMS_URL'].forEach(function (name) {
        check('other country service kept: ' + name, mapApp.indexOf(name) !== -1);
    });

    console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
    if (failures > 0) {
        console.error(failures + ' FAILED');
        process.exit(1);
    }
    console.log('All Norway hoydedata.no LiDAR checks passed.');
})();
