/*
 * test-sweden-lantmateriet-hojdmodell.js
 * ──────────────────────────────────────────────────────────────────────────
 * Sweden LiDAR layer — terrängskuggning from Lantmäteriet's national height
 * model.
 *
 * What this pins:
 *   • NO credential (user / password / token) is present anywhere in the
 *     repository, and the browser gets its tiles from this site's own proxy
 *     path, not from maps.lantmateriet.se;
 *   • the licensed Geotorget service is the DEFAULT; the unauthenticated
 *     Min karta viewer backend is opt-in, warns loudly and is documented as
 *     evaluation-only;
 *   • the request is a WMS 1.1.1 GetMap with SRS= (not CRS=) in EPSG:3857 and
 *     a minx,miny,maxx,maxy bbox — the shape that lines up with the basemap;
 *   • the four layer names match the live GetCapabilities exactly;
 *   • the layer is clipped to Sweden and to a sane zoom window;
 *   • a ServiceException becomes a transparent tile, not a broken image, and
 *     produces one warning rather than console spam;
 *   • only the Sweden row of the app changed.
 *
 * Run:  node test-sweden-lantmateriet-hojdmodell.js
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

const MODULE = 'js/lantmateriet-hojdmodell-layer.js';

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
    vm.runInContext(fs.readFileSync(path.join(__dirname, MODULE), 'utf8'),
        sandbox, { filename: 'lantmateriet-hojdmodell-layer.js' });
    return { S: sandbox.LantmaterietHojdmodell, L: L, sandbox: sandbox };
}

const { S, L, sandbox } = loadModule();
const moduleSource = fs.readFileSync(path.join(__dirname, MODULE), 'utf8');
const configBlock = moduleSource.split('end of configuration')[0];

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Credential hygiene — nothing secret may live in the repository
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Credential hygiene');

const repoFiles = [MODULE, 'js/map-app.js', 'index.html', 'sw.js',
    'backend/src/routes/geoProxy.js', 'netlify/functions/se-hojdmodell.mjs',
    'SWEDEN_LIDAR_LANTMATERIET.md']
    .filter((f) => fs.existsSync(path.join(__dirname, f)));

repoFiles.forEach(function (file) {
    const body = fs.readFileSync(path.join(__dirname, file), 'utf8');
    check('no inline basic-auth URL in ' + file,
        !/https:\/\/[^\s"'`]*:[^\s"'`@/]+@[^\s"'`]*lantmateriet/i.test(body));
    check('no hard-coded Lantmäteriet password in ' + file,
        !/LANTMATERIET_WMS_(PASSWORD|TOKEN)\s*[:=]\s*['"][^'"\s]+['"]/.test(body));
});

check('the backend reads the credentials from the environment',
    /process\.env\.LANTMATERIET_WMS_USER/.test(
        fs.readFileSync(path.join(__dirname, 'backend/src/routes/geoProxy.js'), 'utf8')));
check('the Netlify function reads the credentials from the environment',
    /env\.LANTMATERIET_WMS_USER/.test(
        fs.readFileSync(path.join(__dirname, 'netlify/functions/se-hojdmodell.mjs'), 'utf8')));
check('backend/.env.example ships empty placeholders only',
    /^LANTMATERIET_WMS_PASSWORD=\s*$/m.test(
        fs.readFileSync(path.join(__dirname, 'backend/.env.example'), 'utf8')));
check('.env files are gitignored',
    /^\.env$/m.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')) &&
    /backend\/\.env/.test(fs.readFileSync(path.join(__dirname, '.gitignore'), 'utf8')));
check('no credential key is part of the CONFIG block',
    !('TOKEN' in S.CONFIG) && !('USER' in S.CONFIG) && !('PASSWORD' in S.CONFIG) &&
    !/\b(TOKEN|PASSWORD|USER)\s*:/.test(configBlock));

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Sanctioned service — the licensed endpoint is the default
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] Which service we talk to');

eq('the default source is the licensed Geotorget product', S.CONFIG.SOURCE, 'geotorget');
eq('…reached through this site\'s own proxy', S.CONFIG.PROXY_PATH, '/api/geo/se-hojdmodell');
eq('…which forwards to the published access point', S.CONFIG.GEOTORGET_URL,
    'https://maps.lantmateriet.se/hojdmodell/wms/v1.1');
eq('source() resolves to geotorget by default', S.source(), 'geotorget');
eq('endpoint() is the proxy, never the upstream', S.endpoint(), '/api/geo/se-hojdmodell');
check('isProxied() is true by default', S.isProxied() === true);
check('no tile URL built by default mentions lantmateriet.se',
    S.tileUrl('terrangskuggning', [0, 0, 1, 1], 256).indexOf('lantmateriet.se') === -1);
check('both service URLs are https',
    S.CONFIG.GEOTORGET_URL.indexOf('https://') === 0 &&
    S.CONFIG.MINKARTA_URL.indexOf('https://') === 0);

{
    // Opt-in evaluation mode must work, but must warn.
    const { S: Sm, sandbox: sm } = loadModule({ DETECTLAB_SE_WMS_SOURCE: 'minkarta' });
    eq('opting in switches to the Min karta backend', Sm.source(), 'minkarta');
    eq('…and talks to it directly', Sm.endpoint(),
        'https://minkarta.lantmateriet.se/map/hojdmodell');
    check('…after printing exactly one loud warning',
        sm.__warnings.filter((w) => /minkarta/i.test(w)).length === 1,
        JSON.stringify(sm.__warnings));
    check('…that says it is not licensed for third-party use',
        /NOT licensed for third-party use/i.test(sm.__warnings.join(' ')));
    check('isProxied() is false in evaluation mode', Sm.isProxied() === false);
}

check('the module documents that minkarta is the fee-based product',
    /Markh(ö|o)jdmodell Visning/.test(moduleSource) && /75 625/.test(moduleSource));
check('the module points at the written analysis',
    /SWEDEN_LIDAR_LANTMATERIET\.md/.test(moduleSource));

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Configuration — only what the live GetCapabilities publishes
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] Configuration block');

eq('WMS 1.1.1 (takes SRS, no axis-order surprises)', S.CONFIG.VERSION, '1.1.1');
eq('tiles are requested in Web Mercator so they match the basemap',
    S.CONFIG.CRS, 'EPSG:3857');
eq('PNG, so the hillshade can be made semi-transparent', S.CONFIG.FORMAT, 'image/png');
eq('TRANSPARENT is on', S.CONFIG.TRANSPARENT, 'true');
eq('TILED hint is on', S.CONFIG.TILED, 'true');
eq('256 px tiles (the service caps width/height at 4096)', S.CONFIG.TILE_SIZE, 256);
eq('the default product is the terrain shading',
    S.CONFIG.DEFAULT_MODE, 'terrangskuggning');
eq('the brief\'s default opacity', S.CONFIG.OPACITY, 0.7);

// The four layers published by the live GetCapabilities, and nothing invented.
const EXPECTED_LAYERS = ['terrangskuggning', 'terranglutning',
    'terranglutning_brunton', 'ursprung_kvalitet'];
eq('exactly the four published layers are offered',
    S.modeKeys().length, EXPECTED_LAYERS.length);
EXPECTED_LAYERS.forEach(function (name) {
    check('layer ' + name + ' is offered with its published name',
        S.MODES[name] && S.MODES[name].layer === name);
    check('layer ' + name + ' has a human label',
        !!(S.MODES[name] && S.MODES[name].label && S.MODES[name].label.length > 3));
});

eq('minZoom keeps us off huge areas', S.CONFIG.MIN_ZOOM, 8);
eq('maxNativeZoom matches a 1 m grid', S.CONFIG.MAX_NATIVE_ZOOM, 17);
check('Leaflet may upscale above the native level',
    S.CONFIG.MAX_ZOOM > S.CONFIG.MAX_NATIVE_ZOOM);
eq('we barely preload from a government server', S.CONFIG.KEEP_BUFFER, 1);
check('attribution names Lantmäteriet', /Lantm(ä|a)teriet/.test(S.CONFIG.ATTRIBUTION));

/* ══════════════════════════════════════════════════════════════════════════
 * 4. The GetMap request — the shape that lines up with the basemap
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] GetMap request shape');

const url = S.tileUrl('terrangskuggning', [2011211.0882, 8251530.0774, 2011822.5845, 8252141.5737], 256);
check('starts at the proxy path', url.indexOf('/api/geo/se-hojdmodell?') === 0);
check('SERVICE=WMS', /[?&]SERVICE=WMS(&|$)/.test(url));
check('REQUEST=GetMap', /[?&]REQUEST=GetMap(&|$)/.test(url));
check('VERSION=1.1.1', /[?&]VERSION=1\.1\.1(&|$)/.test(url));
check('uses SRS=, which is the 1.1.1 spelling', /[?&]SRS=EPSG%3A3857(&|$)/.test(url));
check('does NOT use CRS=, which would be 1.3.0', !/[?&]CRS=/.test(url));
check('LAYERS is the published layer name', /[?&]LAYERS=terrangskuggning(&|$)/.test(url));
check('STYLES is present and empty', /[?&]STYLES=(&|$)/.test(url));
check('FORMAT=image/png', /[?&]FORMAT=image%2Fpng(&|$)/.test(url));
check('TRANSPARENT=true', /[?&]TRANSPARENT=true(&|$)/.test(url));
check('TILED=true', /[?&]TILED=true(&|$)/.test(url));
check('WIDTH and HEIGHT are the tile size', /[?&]WIDTH=256(&|$)/.test(url) && /[?&]HEIGHT=256(&|$)/.test(url));

const bboxParam = /[?&]BBOX=([^&]+)/.exec(url)[1].split(',').map(Number);
check('BBOX is minx,miny,maxx,maxy (no axis swap)',
    bboxParam[0] < bboxParam[2] && bboxParam[1] < bboxParam[3]);
check('BBOX is in Web Mercator metres, not degrees',
    Math.abs(bboxParam[0]) > 1000 && Math.abs(bboxParam[1]) > 1000);

/* The decisive alignment test: ask the layer for a real Leaflet tile and
 * check the bbox equals the canonical Web-Mercator tile extent. An offset or
 * flipped hillshade is exactly this number being wrong. */
console.log('\n[5] Tile geometry equals the canonical XYZ grid');

const layer = S.createLayer({});
const Z = 16, X = 36057, Y = 19273;              // z16 tile over Stockholm
const span = 2 * HALF / Math.pow(2, Z);
const expected = [
    -HALF + X * span,
    HALF - (Y + 1) * span,
    -HALF + (X + 1) * span,
    HALF - Y * span
];
const tileBbox = /[?&]BBOX=([^&]+)/
    .exec(layer.getTileUrl({ x: X, y: Y, z: Z }))[1].split(',').map(Number);
near('tile minx matches the XYZ grid', tileBbox[0], expected[0], 0.01);
near('tile miny matches the XYZ grid', tileBbox[1], expected[1], 0.01);
near('tile maxx matches the XYZ grid', tileBbox[2], expected[2], 0.01);
near('tile maxy matches the XYZ grid', tileBbox[3], expected[3], 0.01);
near('the tile is square in projected metres',
    (tileBbox[2] - tileBbox[0]) - (tileBbox[3] - tileBbox[1]), 0, 0.01);

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Coverage, zoom window and error handling
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[6] Coverage, zoom window, error handling');

const bounds = layer.options.bounds;
check('Stockholm is inside the layer bounds',
    bounds.contains(new L.LatLng(59.33, 18.07)));
check('Kiruna is inside the layer bounds',
    bounds.contains(new L.LatLng(67.86, 20.23)));
check('Malmö is inside the layer bounds',
    bounds.contains(new L.LatLng(55.60, 13.00)));
check('Smygehuk, the southern tip, is inside the layer bounds',
    bounds.contains(new L.LatLng(55.34, 13.36)));
check('Treriksr\u00f6set, the northern tip, is inside the layer bounds',
    bounds.contains(new L.LatLng(69.06, 20.55)));
check('Oslo is OUTSIDE the layer bounds (no out-of-coverage requests)',
    !bounds.contains(new L.LatLng(59.91, 10.75)));
check('Helsinki is OUTSIDE the layer bounds',
    !bounds.contains(new L.LatLng(60.17, 24.94)));
check('Berlin is OUTSIDE the layer bounds',
    !bounds.contains(new L.LatLng(52.52, 13.40)));
// Deliberately NOT asserted: Copenhagen. It sits 25 km from Malm\u00f6 across
// the \u00d6resund, so no rectangle can hold one and exclude the other. Those
// few tiles come back as empty PNGs.

eq('the layer carries the zoom floor', layer.options.minZoom, 8);
eq('the layer carries the native zoom cap', layer.options.maxNativeZoom, 17);
eq('…and still renders above it', layer.options.maxZoom, 20);
eq('opacity defaults to 0.7', layer.options.opacity, 0.7);
check('the layer advertises its attribution to Leaflet',
    /Lantm(ä|a)teriet/.test(layer.options.attribution));

check('a failed tile falls back to a transparent PNG',
    layer.options.errorTileUrl === S.BLANK_TILE &&
    /^data:image\/png;base64,/.test(S.BLANK_TILE));
check('tiles are not re-queued on every zoom frame',
    layer.options.updateWhenZooming === false && layer.options.updateWhenIdle === true);
check('no CORS is requested — plain <img> tiles',
    layer.options.crossOrigin === false);
check('the world does not wrap', layer.options.noWrap === true);

// One warning per layer, not one per tile.
sandbox.__warnings.length = 0;
layer.onAdd({});
layer.fire('tileerror', {});
layer.fire('tileerror', {});
layer.fire('tileerror', {});
eq('three failed tiles produce exactly one console warning',
    sandbox.__warnings.length, 1);

/* Mode switching must not rebuild the layer. */
const before = layer._redrawn || 0;
layer._map = {};
layer.setMode('terranglutning');
eq('setMode switches the WMS layer name', layer.getMode(), 'terranglutning');
check('…by redrawing in place', (layer._redrawn || 0) > before);
check('…and the next request asks for the new layer',
    /[?&]LAYERS=terranglutning(&|$)/.test(layer.getTileUrl({ x: X, y: Y, z: Z })));
layer.setMode('terrangskuggning');

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Wiring — the Sweden row exists and only the Sweden row changed
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[7] App wiring');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

check('index.html loads the module', /lantmateriet-hojdmodell-layer\.js/.test(html));
check('…before map-app.js',
    html.indexOf('lantmateriet-hojdmodell-layer.js') < html.indexOf('js/map-app.js?v='));
check('the Sweden row exists', /id="lidarSeLidarRow"/.test(html));
check('…with an on/off toggle', /id="lidarSeLidarToggle"/.test(html) &&
    /toggleInternationalLidar\('seLidar'/.test(html));
check('…with a layer dropdown', /id="swedenLidarModeSelect"/.test(html) &&
    /setSwedenLidarMode\(this\.value\)/.test(html));
check('…with an opacity slider defaulting to 70%',
    /id="lidarSeLidarOpacitySlider"[^>]*value="70"/.test(html));
check('…and a visible percentage readout', /id="lidarSeLidarPct"/.test(html));
check('the info panel states the service is not open data',
    /NOT open data/.test(html));

check('map-app registers the seLidar sub-layer', /seLidar:\s*\{/.test(app));
check('…with the sweden factory', /factory:\s*'sweden'/.test(app));
check('…a toggle id', /seLidar:\s*'lidarSeLidarToggle'/.test(app));
check('…an opacity slider id', /seLidar:\s*'lidarSeLidarOpacitySlider'/.test(app));
check('…bounds clipped to Sweden', /seLidar:\s*\[\[55\.20, 10\.80\]/.test(app));
check('…and window.setSwedenLidarMode', /window\.setSwedenLidarMode\s*=/.test(app));
check('the zoom handler keeps the Sweden opacity in sync',
    /'frLidar',\s*'dkLidar',\s*\n\s*'seLidar'\]/.test(app));

check('the service worker precaches the module',
    /lantmateriet-hojdmodell-layer\.js/.test(sw));
// Pin that the cache was versioned past the one that shipped this layer,
// not the exact string — every later feature bumps it again.
check('…and its cache name was bumped past v162 (when this layer shipped)',
    (function () {
        const m = /CACHE_NAME = 'detectlab-v(\d+)-/.exec(sw);
        return m !== null && Number(m[1]) >= 162;
    }()));

// Nothing else moved: the other countries keep their factories.
['netherlands', 'poland', 'spain', 'switzerland', 'uk', 'france', 'denmark']
    .forEach(function (factory) {
        check('the ' + factory + ' factory is untouched',
            app.indexOf("cfg.factory === '" + factory + "'") !== -1);
    });

/* ══════════════════════════════════════════════════════════════════════════
 * 8. The proxies refuse to be an open relay
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[8] Proxy hardening');

[['backend/src/routes/geoProxy.js', 'Express route'],
 ['netlify/functions/se-hojdmodell.mjs', 'Netlify function']].forEach(function (pair) {
    const body = fs.readFileSync(path.join(__dirname, pair[0]), 'utf8');
    const name = pair[1];
    check(name + ' pins a single upstream host',
        /maps\.lantmateriet\.se\/hojdmodell\/wms\/v1\.1/.test(body));
    check(name + ' allowlists the four layers',
        EXPECTED_LAYERS.every((l) => body.indexOf("'" + l + "'") !== -1));
    check(name + ' caps the image size', /MAX_PIXELS/.test(body));
    check(name + ' caches successful tiles for 7 days',
        /max-age=604800/.test(body));
    check(name + ' strips a client-supplied credential',
        /'token'/.test(body) && /'password'/.test(body));
    check(name + ' reports missing credentials as 401',
        /lantmateriet_credentials_missing/.test(body));
    check(name + ' never echoes the credential back',
        !/res\.send\(.*authorization/i.test(body));
});

check('netlify.toml routes the proxy path',
    /\/api\/geo\/se-hojdmodell/.test(
        fs.readFileSync(path.join(__dirname, 'netlify.toml'), 'utf8')));

/* ── summary ───────────────────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(72));
console.log(failures === 0
    ? `All ${checks} checks passed.`
    : `${failures} of ${checks} checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
