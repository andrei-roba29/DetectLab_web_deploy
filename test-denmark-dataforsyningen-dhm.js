/*
 * test-denmark-dataforsyningen-dhm.js
 * ──────────────────────────────────────────────────────────────────────────
 * Denmark LiDAR layer — Danmarks Højdemodel hillshade from Dataforsyningen.
 *
 * What this pins:
 *   • NO TOKEN is present anywhere in the repository, and the browser gets
 *     its tiles from this site's own proxy path, not from the Danish service;
 *   • the request is a WMS 1.3.0 GetMap in EPSG:3857 (the WMTS "View1" grid
 *     is EPSG:25832 and would not line up with the Web-Mercator basemap);
 *   • TRANSPARENT is spelled in upper case, which the service insists on;
 *   • the layer is clipped to the published Danish extent;
 *   • 401/403 produces one non-blocking notice, never console spam;
 *   • only the Denmark row of the app changed.
 *
 * Run:  node test-denmark-dataforsyningen-dhm.js
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

function loadModule(windowExtras) {
    const L = makeLeaflet();
    const sandbox = {
        L: L,
        console: {
            log: () => {},
            warn: (...a) => sandbox.__warnings.push(a.join(' ')),
            error: (...a) => sandbox.__warnings.push(a.join(' '))
        },
        __warnings: [],
        setTimeout: () => 0,
        fetch: undefined,
        document: undefined
    };
    Object.assign(sandbox, windowExtras || {});
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/dataforsyningen-dhm-layer.js'), 'utf8'),
        sandbox, { filename: 'dataforsyningen-dhm-layer.js' });
    return { D: sandbox.DataforsyningenDHM, L: L, sandbox: sandbox };
}

const { D, L, sandbox } = loadModule();
const moduleSource = fs.readFileSync(path.join(__dirname, 'js/dataforsyningen-dhm-layer.js'), 'utf8');
const executableSource = moduleSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Token hygiene — nothing secret may live in the repository
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Token hygiene');

const repoFiles = ['js/dataforsyningen-dhm-layer.js', 'js/map-app.js', 'index.html',
    'sw.js', 'backend/src/routes/geoProxy.js', 'DENMARK_LIDAR_DATAFORSYNINGEN.md']
    .filter((f) => fs.existsSync(path.join(__dirname, f)));
// A Dataforsyningen token is 32 hexadecimal characters.
const TOKEN_SHAPE = /\b[0-9a-f]{32}\b/;
repoFiles.forEach(function (file) {
    // The public Cloudflare R2 bucket host (pub-<32 hex>.r2.dev) is not a
    // secret and predates this work, so it is excluded from the scan.
    const body = fs.readFileSync(path.join(__dirname, file), 'utf8')
        .replace(/pub-[0-9a-f]{32}\.r2\.dev/g, 'pub-R2BUCKET.r2.dev');
    check('no 32-hex token literal in ' + file, !TOKEN_SHAPE.test(body),
        (body.match(TOKEN_SHAPE) || [''])[0]);
    check('no token=<value> literal in ' + file,
        !/[?&]token=(?!\{|'|"|\s|$|YOUR_TOKEN|&)[A-Za-z0-9]/.test(body));
});
check('the README only ever shows YOUR_TOKEN',
    !fs.existsSync(path.join(__dirname, 'DENMARK_LIDAR_DATAFORSYNINGEN.md')) ||
    !/token=[0-9a-f]{8}/i.test(
        fs.readFileSync(path.join(__dirname, 'DENMARK_LIDAR_DATAFORSYNINGEN.md'), 'utf8')));
check('the backend reads the token from the environment',
    /process\.env\.DATAFORSYNINGEN_TOKEN/.test(
        fs.readFileSync(path.join(__dirname, 'backend/src/routes/geoProxy.js'), 'utf8')));
check('.env files are gitignored',
    /^\.env$/m.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')) &&
    /backend\/\.env/.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')));
check('the token is not part of the CONFIG block',
    !('TOKEN' in D.CONFIG) && !/TOKEN\s*:/.test(executableSource.split('end of configuration')[0]));

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Configuration — only what the live GetCapabilities publishes
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] Configuration block');

eq('the default route is this site\'s own proxy', D.CONFIG.PROXY_PATH, '/api/geo/dk-dhm');
eq('the direct service is the public WMS', D.CONFIG.DIRECT_URL,
    'https://api.dataforsyningen.dk/dhm_DAF');
check('the direct service is https', D.CONFIG.DIRECT_URL.indexOf('https://') === 0);
eq('WMS 1.3.0', D.CONFIG.WMS_VERSION, '1.3.0');
eq('tiles are requested in Web Mercator so they match the basemap',
    D.CONFIG.CRS, 'EPSG:3857');
eq('PNG, so the hillshade can be made semi-transparent', D.CONFIG.FORMAT, 'image/png');
eq('TRANSPARENT is upper case (the service rejects "true")',
    D.CONFIG.TRANSPARENT, 'TRUE');
eq('256 px tiles', D.CONFIG.TILE_SIZE, 256);
eq('the default product is the bare-earth terrain hillshade',
    D.CONFIG.DEFAULT_MODE, 'terrain');
eq('…with the published layer name', D.MODES.terrain.layer, 'dhm_terraen_skyggekort');
eq('the surface hillshade is the published layer', D.MODES.surface.layer,
    'dhm_overflade_skyggekort');
eq('the 2.5 m contours are the published layer', D.MODES.contours.layer,
    'dhm_kurve_traditionel');
eq('the 0.5 m contours are the published layer', D.MODES.contoursFine.layer,
    'dhm_kurve_0_5_m');
check('each product carries the minimum zoom implied by its MaxScaleDenominator',
    D.MODES.terrain.minZoom === 6 && D.MODES.surface.minZoom === 6 &&
    D.MODES.contours.minZoom === 12 && D.MODES.contoursFine.minZoom === 15);
eq('default opacity is 0.6', D.CONFIG.OPACITY, 0.6);
check('keepBuffer stays small on a public agency server', D.CONFIG.KEEP_BUFFER <= 1);
check('the attribution names Klimadatastyrelsen and Danmarks Højdemodel',
    /Klimadatastyrelsen/.test(D.CONFIG.ATTRIBUTION) &&
    /Danmarks Højdemodel/.test(D.CONFIG.ATTRIBUTION), D.CONFIG.ATTRIBUTION);
check('…and the CC BY 4.0 licence', /CC BY 4\.0/.test(D.CONFIG.ATTRIBUTION));
eq('the 401/403 message is the one the brief asked for',
    D.CONFIG.AUTH_MESSAGE, 'Invalid or missing Dataforsyningen token');

// Coverage from the WMS capabilities: 7.99125 54.4265 → 15.5995 57.7781.
const b = D.CONFIG.BOUNDS;
near('the south bound matches the capabilities', b[0][0], 54.4265, 1e-6);
near('the west bound matches the capabilities', b[0][1], 7.99125, 1e-6);
near('the north bound matches the capabilities', b[1][0], 57.7781, 1e-6);
near('the east bound matches the capabilities', b[1][1], 15.5995, 1e-6);

check('the EPSG:25832 WMTS grid is documented as rejected, not used',
    /View1/.test(moduleSource) && !/View1/.test(executableSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The GetMap request
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] WMS GetMap request');

const BBOX = [1392000, 7484000, 1394000, 7486000];   // Copenhagen, EPSG:3857
const proxied = D.tileUrl('terrain', BBOX, 256, '');
check('by default the browser calls our own origin, not Denmark',
    proxied.indexOf('/api/geo/dk-dhm?') === 0, proxied);
check('…and no token travels with it', proxied.indexOf('token') === -1, proxied);
check('service=WMS & request=GetMap', /service=WMS/.test(proxied) && /request=GetMap/.test(proxied));
check('version=1.3.0', proxied.indexOf('version=1.3.0') !== -1);
check('crs=EPSG:3857 (1.3.0 spells it CRS, not SRS)',
    proxied.indexOf('crs=EPSG:3857') !== -1 && proxied.indexOf('srs=') === -1);
check('the bbox is minx,miny,maxx,maxy — no lat/lon swap in a metric CRS',
    proxied.indexOf('bbox=1392000,7484000,1394000,7486000') !== -1, proxied);
check('width and height are the tile size',
    proxied.indexOf('width=256&height=256') !== -1);
check('format is percent-encoded image/png',
    proxied.indexOf('format=image%2Fpng') !== -1);
check('transparent=TRUE in upper case', proxied.indexOf('transparent=TRUE') !== -1);
check('switching product only changes the layer name',
    D.tileUrl('surface', BBOX, 256, '') ===
    proxied.replace('layers=dhm_terraen_skyggekort', 'layers=dhm_overflade_skyggekort'));
check('an unknown product falls back to the default',
    D.tileUrl('nope', BBOX, 256, '') === proxied);

const direct = D.tileUrl('terrain', BBOX, 256, 'YOUR_TOKEN');
check('the insecure client-token mode calls the Danish service directly',
    direct.indexOf('https://api.dataforsyningen.dk/dhm_DAF?') === 0, direct);
check('…and appends the token as the service expects',
    direct.indexOf('&token=YOUR_TOKEN') !== -1);
check('the proxy is the default: no client token ⇒ isProxied()', D.isProxied() === true);
eq('endpoint() is the proxy path when no client token is set',
    D.endpoint(), '/api/geo/dk-dhm');

const insecure = loadModule({ DETECTLAB_DK_TOKEN: 'YOUR_TOKEN' });
check('a client-side token switches the module to direct mode',
    insecure.D.isProxied() === false &&
    insecure.D.endpoint() === 'https://api.dataforsyningen.dk/dhm_DAF');

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Tile geometry — the hillshade must line up with the basemap
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Tile geometry (EPSG:3857)');

const layer = D.createLayer({ mode: 'terrain' });
layer._map = { options: { crs: L.CRS.EPSG3857 } };
// The tile containing Copenhagen (55.6761 N, 12.5683 E) at z12.
function tileOf(lat, lng, z) {
    const n = Math.pow(2, z);
    const r = lat * Math.PI / 180;
    return {
        x: Math.floor((lng + 180) / 360 * n),
        y: Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n),
        z: z
    };
}
const coords = tileOf(55.6761, 12.5683, 12);
eq('Copenhagen sits in tile 2190/1282 at z12', coords.x + '/' + coords.y, '2190/1282');
const builtUrl = layer.getTileUrl(coords);
const bbox = decodeURIComponent(builtUrl.match(/bbox=([^&]+)/)[1]).split(',').map(Number);
const HALF_M = Math.PI * 6378137;
const span12 = (2 * HALF_M) / Math.pow(2, 12);
near('the tile west edge is on the standard Web-Mercator grid',
    bbox[0], -HALF_M + coords.x * span12, 0.5);
near('the tile north edge is on the standard Web-Mercator grid',
    bbox[3], HALF_M - coords.y * span12, 0.5);
// Copenhagen in EPSG:3857 is 1399096.8 E, 7494204.7 N.
check('the bbox really covers Copenhagen',
    bbox[0] <= 1399096.8 && bbox[2] >= 1399096.8 &&
    bbox[1] <= 7494204.7 && bbox[3] >= 7494204.7,
    bbox.join(','));
check('the tile bbox comes from Leaflet, not hand-rolled Mercator maths',
    /_tileCoordsToBounds/.test(moduleSource) && !/20037508/.test(executableSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Layer behaviour
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[5] Layer behaviour');

eq('minZoom comes from the product', layer.options.minZoom, 6);
eq('the attribution travels with the layer', layer.options.attribution, D.CONFIG.ATTRIBUTION);
eq('opacity default', layer.options.opacity, 0.6);
eq('keepBuffer is tiny (no far-viewport preloading)', layer.options.keepBuffer, 1);
check('the layer is bounded to Denmark',
    layer.options.bounds.contains(new L.LatLng(55.6761, 12.5683)) &&   // Copenhagen
    layer.options.bounds.contains(new L.LatLng(57.59, 9.96)) &&        // Skagen
    !layer.options.bounds.contains(new L.LatLng(59.33, 18.07)) &&      // Stockholm
    !layer.options.bounds.contains(new L.LatLng(53.55, 9.99)));        // Hamburg
eq('failed tiles fall back to a transparent pixel',
    layer.options.errorTileUrl, D.BLANK_TILE);
check('the fallback really is a transparent PNG data URI',
    D.BLANK_TILE.indexOf('data:image/png;base64,') === 0);
check('no tile churn during gestures', layer.options.updateWhenZooming === false &&
    layer.options.updateWhenIdle === true);
check('the layer does not wrap around the world', layer.options.noWrap === true);

layer.setMode('contours');
eq('setMode switches the product', layer.getMode(), 'contours');
eq('…and raises minZoom to the product\'s scale limit', layer.options.minZoom, 12);
check('the URL follows the switch',
    layer.getTileUrl(coords).indexOf('layers=dhm_kurve_traditionel') !== -1);
check('switching redraws instead of rebuilding', layer._redrawn >= 1);
check('an unknown mode is ignored', layer.setMode('nope').getMode() === 'contours');
layer.setMode('terrain');
eq('switching back restores the terrain hillshade', layer.options.minZoom, 6);

// Tile errors: one warning for the whole layer, never one per tile.
const errLayer = D.createLayer({ mode: 'terrain' });
errLayer._map = { options: { crs: L.CRS.EPSG3857 } };
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

// 401 → exactly one non-blocking notice, and it says what the brief asked.
let fetched = 0;
const authCtx = loadModule({
    fetch: function (url) {
        fetched++;
        return Promise.resolve({ status: 401, headers: { get: () => 'application/json' } });
    }
});
const authLayer = authCtx.D.createLayer({ mode: 'terrain' });
authLayer._map = { options: { crs: authCtx.L.CRS.EPSG3857 } };
authLayer.onAdd({});
authLayer.fire('tileerror', {});
authLayer.fire('tileerror', {});
authLayer.fire('tileerror', {});
eq('a 401 is probed exactly once, not once per tile', fetched, 1);
check('the module exposes the notice helper for the app to reuse',
    typeof authCtx.D.showAuthNotice === 'function');
check('the probe never carries a token in proxy mode',
    /tileUrl\(this\.options\.mode[\s\S]{0,200}clientToken\(\)\)/.test(moduleSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 6. The server-side proxy
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[6] Server-side token proxy');

const proxySrc = fs.readFileSync(path.join(__dirname, 'backend/src/routes/geoProxy.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(__dirname, 'backend/src/app.js'), 'utf8');
check('the route matches the path the client calls', /\/geo\/dk-dhm/.test(proxySrc));
check('it is mounted on the API', /geoProxyRouter/.test(appSrc) &&
    /app\.use\('\/api', geoProxyRouter\)/.test(appSrc));
check('the token is sent as a header, not a query parameter',
    /headers:\s*\{\s*token\s*\}/.test(proxySrc));
check('a client-supplied token is ignored',
    /key\.toLowerCase\(\) === 'token'/.test(proxySrc));
check('a missing token answers 401 so the client can show the notice',
    /dataforsyningen_token_missing/.test(proxySrc) && /status\(401\)/.test(proxySrc));
check('an upstream refusal is translated to 401',
    /dataforsyningen_token_invalid/.test(proxySrc));
check('it is not an open proxy: fixed upstream host',
    /const UPSTREAM = 'https:\/\/api\.dataforsyningen\.dk\/dhm_DAF'/.test(proxySrc));
check('…a layer whitelist', /ALLOWED_LAYERS/.test(proxySrc) &&
    /dhm_terraen_skyggekort/.test(proxySrc));
check('…a format whitelist', /ALLOWED_FORMATS/.test(proxySrc));
check('…and an image-size cap', /MAX_PIXELS/.test(proxySrc));
check('tiles are cached for 7 days', /7 \* 24 \* 60 \* 60 \* 1000/.test(proxySrc) &&
    /max-age=604800/.test(proxySrc));
check('the cache is bounded', /CACHE_MAX_ENTRIES/.test(proxySrc));
check('the token is never logged',
    !/logger\.[a-z]+\([^)]*token[^)]*\)/.test(proxySrc.replace(/token_missing|token_invalid/g, '')));

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Wiring in the app (Denmark row only)
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[7] Wiring in the app');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

const scriptSrcs = (indexHtml.match(/<script[^>]+src="[^"]+"/g) || [])
    .map((tag) => tag.match(/src="([^"?]+)/)[1]);
check('index.html loads dataforsyningen-dhm-layer.js before map-app.js',
    scriptSrcs.indexOf('js/dataforsyningen-dhm-layer.js') !== -1 &&
    scriptSrcs.indexOf('js/dataforsyningen-dhm-layer.js') < scriptSrcs.indexOf('js/map-app.js'));
check('the service worker pre-caches it', sw.indexOf('js/dataforsyningen-dhm-layer.js') !== -1);
check('the service worker cache name was bumped', /detectlab-v1[6-9]\d/.test(sw));
check('the Denmark layer is built by the module',
    /DataforsyningenDHM\.createLayer/.test(mapApp));
check('the old Datafordeler apikey path is gone',
    !/DETECTLAB_DK_API_KEY/.test(mapApp) && !/apikey=/.test(mapApp));
check('the product dropdown offers all four products',
    /value="terrain"/.test(indexHtml) && /value="surface"/.test(indexHtml) &&
    /value="contours"/.test(indexHtml) && /value="contoursFine"/.test(indexHtml));
check('the dropdown is also filled from the module at runtime',
    /_populateDenmarkModeSelect/.test(mapApp) && /DataforsyningenDHM\.modeKeys\(\)/.test(mapApp));
check('switching product uses setMode instead of rebuilding',
    /setDenmarkLidarMode/.test(mapApp) && /cfg\.leafletLayer\.setMode\(mode\)/.test(mapApp));
check('the on/off switch still drives the Denmark row',
    /toggleInternationalLidar\('dkLidar', this\.checked\)/.test(indexHtml));
check('the opacity slider defaults to 60%',
    /id="lidarDkLidarOpacitySlider"[^>]*value="60"/.test(indexHtml) &&
    /id="lidarDkLidarPct">60%/.test(indexHtml));
check('the info popup explains the licence and the proxy',
    /CC BY 4\.0/.test(indexHtml) && /token/.test(indexHtml));
check('the fly-to bounds match the published extent',
    /dkLidar: \[\[54\.4265, 7\.99125\], \[57\.7781, 15\.5995\]\]/.test(mapApp));

// Scope guard: only the Denmark row changed.
check('the Norway layer still uses its own module', /Hoydedata\.createLayer/.test(mapApp));
check('the Poland layer still uses its own module', /GeoportalNMT\.createLayer/.test(mapApp));
check('the Spain layer still uses its own module', /IgnMdt\.createLayer/.test(mapApp));
check('the Netherlands layer still uses its own module', /AhnLidar\.createLayer/.test(mapApp));
check('the Switzerland layer still uses its own module', /SwisstopoRelief\.createLayer/.test(mapApp));
check('the England layer still uses its own module', /EaLidarWmts\.createLayer/.test(mapApp));
check('other country service kept: FRANCE_LIDAR_WMS_URL',
    mapApp.indexOf('FRANCE_LIDAR_WMS_URL') !== -1);

console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All Denmark / Dataforsyningen DHM checks passed.');
