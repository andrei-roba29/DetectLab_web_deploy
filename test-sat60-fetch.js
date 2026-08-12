/*
 * test-sat60-fetch.js
 * ──────────────────────────────────────────────────────────────────────────
 * Verifies that the "Satellite imagery 60's" layer replicates the EXACT tile
 * fetching / request sending of the original Corona Atlas website
 * (https://corona.cast.uark.edu/atlas).
 *
 * Ground truth — actual tile requests captured from the original site's live
 * traffic (Internet Archive captures of geoserve.cast.uark.edu, 2020-04-29).
 * One captured request, verbatim (z15 tile x=19312 y=13536, frame layer):
 *
 *   https://geoserve.cast.uark.edu/geoserver/gwc/service/wms
 *   ?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng
 *   &TRANSPARENT=true&LAYERS=corona%3A1105-2235df021&tiled=true
 *   &WIDTH=256&HEIGHT=256&SRS=EPSG%3A900913&STYLES=
 *   &BBOX=3580921.899662502%2C3481859.511022657%2C3582144.892114846%2C3483082.503475001
 *
 * Other captured captures confirm the same pattern for pass mosaics
 * (LAYERS=corona:1101-2168Fore …) and Aft frames (LAYERS=corona:1104-2203da058):
 * one Corona layer per request, GeoWebCache WMS-C endpoint, EPSG:900913,
 * 256×256 tiles on the standard Web-Mercator grid.
 *
 * The tests assert:
 *   1. window.coronaWmsTileUrl() reproduces that exact request format —
 *      parameter names, order and encoding, single LAYERS= per request.
 *   2. The BBOX is the standard Web-Mercator 256×256 tile grid in
 *      EPSG:900913 metres — the same tile (z15, x=19312, y=13536) as the
 *      archived request, agreeing to sub-centimetre float noise.
 *   3. The tile layer is a plain map tile layer, exactly like the original:
 *      no manualOnly gating, no request queue, no IndexedDB cache —
 *      tiles are ordinary <img> GETs.
 *   4. map-app.js wires it as a normal toggleable overlay: one tile layer
 *      per Corona layer, pass mosaics from z8, frames from z12, and all the
 *      old on-demand machinery ("Load images here" button, probe queue,
 *      IndexedDB) is gone.
 *
 * Run:  node test-sat60-fetch.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = 'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms';
const LAYER_FRAME = 'corona:1105-2235df021';

/* ── Minimal Leaflet stub (only what corona-wms-layer.js touches) ────────── */
function classExtend(proto) {
    function SubClass() {
        if (this.initialize) this.initialize.apply(this, arguments);
    }
    SubClass.prototype = Object.create(this.prototype || {});
    for (const k in proto) SubClass.prototype[k] = proto[k];
    return SubClass;
}
function WMSBase(url, options) { this._url = url; this.options = options || {}; }
WMSBase.extend = classExtend;
WMSBase.prototype = {
    initialize: function (url, options) { this._url = url; this.options = options || {}; }
};

const L = {
    extend: function (target) {
        for (let i = 1; i < arguments.length; i++) {
            const src = arguments[i] || {};
            for (const k in src) target[k] = src[k];
        }
        return target;
    },
    TileLayer: { WMS: WMSBase }
};

const sandbox = { console: console, L: L, encodeURIComponent: encodeURIComponent };
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

const code = fs.readFileSync(path.join(__dirname, 'js/corona-wms-layer.js'), 'utf8');
vm.runInContext(code, sandbox, { filename: 'corona-wms-layer.js' });
const W = sandbox;

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

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Request URL format — byte-for-byte equal to the original's traffic
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Request URL format matches original corona.cast.uark.edu/atlas traffic');

const url = W.coronaWmsTileUrl(BASE, LAYER_FRAME, 15, 19312, 13536);
check('coronaWmsTileUrl is exposed', typeof W.coronaWmsTileUrl === 'function');
check('url is a string', typeof url === 'string');
check('url starts with the GWC WMS-C endpoint', url.indexOf(BASE + '?') === 0);

const ARCH_PREFIX = BASE + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image%2Fpng'
    + '&TRANSPARENT=true&LAYERS=corona%3A1105-2235df021&tiled=true'
    + '&WIDTH=256&HEIGHT=256&SRS=EPSG%3A900913&STYLES=&BBOX=';
check('request line (everything up to BBOX) is byte-identical to the captured request',
    url.slice(0, ARCH_PREFIX.length) === ARCH_PREFIX,
    url.slice(0, ARCH_PREFIX.length));

check('BBOX is the last parameter', /&BBOX=[^&]+$/.test(url));

const kv = url.slice(url.indexOf('?') + 1).split('&');
const order = kv.map(function (p) { return p.split('=')[0]; }).join(',');
eq('parameter order matches the original', order,
    'SERVICE,VERSION,REQUEST,FORMAT,TRANSPARENT,LAYERS,tiled,WIDTH,HEIGHT,SRS,STYLES,BBOX');
check('SERVICE=WMS', /([?&])SERVICE=WMS(&|$)/.test(url));
check('VERSION=1.1.1', /([?&])VERSION=1\.1\.1(&|$)/.test(url));
check('REQUEST=GetMap', /([?&])REQUEST=GetMap(&|$)/.test(url));
check('FORMAT=image%2Fpng (URL-encoded)', /([?&])FORMAT=image%2Fpng(&|$)/.test(url));
check('TRANSPARENT=true', /([?&])TRANSPARENT=true(&|$)/.test(url));
check('tiled=true (lowercase, as captured)', /([?&])tiled=true(&|$)/.test(url));
check('WIDTH=256', /([?&])WIDTH=256(&|$)/.test(url));
check('HEIGHT=256', /([?&])HEIGHT=256(&|$)/.test(url));
check('SRS=EPSG%3A900913 (URL-encoded, not EPSG:3857)', /([?&])SRS=EPSG%3A900913(&|$)/.test(url));
check('STYLES= is empty, as captured', /([?&])STYLES=(&|$)/.test(url));

// ONE Corona layer per request — never a comma-separated LAYERS list.
const layerParam = kv.filter(function (p) { return p.indexOf('LAYERS=') === 0; });
eq('exactly one LAYERS= parameter', layerParam.length, 1);
eq('single layer name (no comma-separated list)', layerParam[0], 'LAYERS=corona%3A1105-2235df021');

// URL-encoding of the layer name is the captured corona%3A... form.
check('layer name encoded as corona%3A…', layerParam[0].indexOf('corona%3A1105-2235df021') !== -1);

/* ══════════════════════════════════════════════════════════════════════════
 * 2. BBOX — standard Web-Mercator 256×256 tile grid in EPSG:900913 metres
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] BBOX is the standard Web-Mercator tile grid (EPSG:900913 metres)');

const bboxStr = url.slice(url.indexOf('BBOX=') + 5);
const bbox = bboxStr.split('%2C').map(Number);
check('BBOX has 4 comma-separated coordinates', bbox.length === 4, bboxStr);

const ORIGIN = 20037508.342789244;                 // half world extent, metres
const tileSize = (ORIGIN * 2) / Math.pow(2, 15);   // z15 tile width
const tol6 = 5e-7;                                  // ±0.5 µm — only 6-dp formatting noise
check('minX = -ORIGIN + x·tileSize (grid-aligned)', Math.abs(bbox[0] - (-ORIGIN + 19312 * tileSize)) < tol6);
const tolDelta = 2.5e-6; // derived deltas of two 6-dp-rounded values (±1e-6 each)
check('maxX = minX + tileSize', Math.abs(bbox[2] - (bbox[0] + tileSize)) < tolDelta);
check('maxY = ORIGIN - y·tileSize', Math.abs(bbox[3] - (ORIGIN - 13536 * tileSize)) < tol6);
check('minY = maxY - tileSize', Math.abs(bbox[1] - (bbox[3] - tileSize)) < tolDelta);
check('tile width = 40075016.685578488 / 2^15', Math.abs((bbox[2] - bbox[0]) - (ORIGIN * 2) / Math.pow(2, 15)) < tolDelta);

// Agreement with the captured request (sub-centimetre = same tile; the
// original client's bbox carries ~1 mm of float noise).
const ARCH_BBOX = [3580921.899662502, 3481859.511022657, 3582144.892114846, 3483082.503475001];
const tol = 0.01; // metres
ARCH_BBOX.forEach(function (v, i) {
    check('bbox[' + i + '] within ' + tol + ' m of captured value',
        Math.abs(bbox[i] - v) < tol, bbox[i] + ' vs ' + v);
});

// The same grid at other zooms: z0 tile 0,0 spans the full world.
const z0 = W.coronaWmsTileUrl(BASE, LAYER_FRAME, 0, 0, 0);
const z0bbox = z0.slice(z0.indexOf('BBOX=') + 5).split('%2C').map(Number);
check('z0 tile (0,0): minX = -ORIGIN', Math.abs(z0bbox[0] - (-ORIGIN)) < tol6);
check('z0 tile (0,0): maxY = ORIGIN', Math.abs(z0bbox[3] - ORIGIN) < tol6);
check('z0 tile (0,0): full world width', Math.abs((z0bbox[2] - z0bbox[0]) - ORIGIN * 2) < tol6);

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The layer is a plain tile layer — no manual gating / queue / database
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] Tile layer behaves like the original: plain <img> tiles, no on-demand machinery');

check('window.CoronaWmsLayer is exposed', typeof W.CoronaWmsLayer === 'function');
check('window.createCoronaWmsLayer is exposed', typeof W.createCoronaWmsLayer === 'function');

const layer = W.createCoronaWmsLayer(BASE, {
    layers: LAYER_FRAME,
    coronaLayer: LAYER_FRAME,
    minZoom: 12,
    maxNativeZoom: 15,
    maxZoom: 20,
    bounds: [[43.5, 19.5], [48.5, 30.5]]
});
eq('layer carries the single corona layer name', layer.getCoronaLayerName(), LAYER_FRAME);
eq('getTileUrl emits the exact captured-style URL', layer.getTileUrl({ z: 15, x: 19312, y: 13536 }), url);
eq('minZoom option is honoured (passed through)', layer.options.minZoom, 12);
eq('maxNativeZoom matches server pyramids', layer.options.maxNativeZoom, 15);
check('manualOnly is NOT set (no "load here" gating)', layer.options.manualOnly === undefined);
check('no client-side request queue is defined', typeof W.CoronaWmsQueue === 'undefined');
check('no probe API is defined', typeof W.coronaProbeTiles === 'undefined');
check('no IndexedDB cache API is defined', typeof W.coronaCache === 'undefined');
check('createTile is Leaflet\'s default (no request-gating override)',
    !Object.prototype.hasOwnProperty.call(W.CoronaWmsLayer.prototype, 'createTile'));

/* ══════════════════════════════════════════════════════════════════════════
 * 4. map-app.js integration — normal toggleable overlay, old machinery gone
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] map-app.js integration (static source checks)');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');

// Removed on-demand machinery:
['loadSatellite60sHere', 'coronaProbeTiles', 'CoronaWmsQueue', '_sat60EnsureUi',
 '_sat60RunLoad', '_sat60InjectTile', '_sat60BuildWmsUrl', 'SAT60_LOAD_MIN_ZOOM',
 'manualOnly', '_sat60LoadingHere'].forEach(function (needle) {
    check('map-app.js no longer contains "' + needle + '"', mapApp.indexOf(needle) === -1);
});
check('no "Load images here" UI strings remain', mapApp.indexOf('sat60_load_here') === -1);

// Faithful wiring:
check('uses createCoronaWmsLayer (faithful layer)', mapApp.indexOf('createCoronaWmsLayer') !== -1);
check('endpoint is the original GWC WMS-C URL',
    mapApp.indexOf('https://geoserve.cast.uark.edu/geoserver/gwc/service/wms') !== -1);
check('pass mosaics start at z8 (SAT60_PASS_MIN_ZOOM = 8)', /SAT60_PASS_MIN_ZOOM\s*=\s*8/.test(mapApp));
check('frames start at z12 (SAT60_FRAME_MIN_ZOOM = 12)', /SAT60_FRAME_MIN_ZOOM\s*=\s*12/.test(mapApp));
check('one tile layer per corona layer (layerGroup)',
    mapApp.indexOf('L.layerGroup(') !== -1 && mapApp.indexOf('_sat60MakeLayer') !== -1);
check('coverage rectangle hides at z8 (coverageMinZoom: 8)',
    mapApp.indexOf('coverageMinZoom: 8') !== -1);

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All satellite-60s fetch/request checks passed.');
