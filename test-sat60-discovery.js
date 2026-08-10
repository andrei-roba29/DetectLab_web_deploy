/*
 * test-sat60-discovery.js
 * ──────────────────────────────────────────────────────────────────────────
 * Node harness that verifies the Corona layer DISCOVERY inside the Sat60
 * IIFE of js/map-app.js can handle both layer-naming conventions the CAST
 * GeoServer has exposed over time:
 *
 *   1. Pass / mosaic layers — "corona:1105-2235Aft" style (preferred).
 *   2. Individual frame layers — "corona:1105-2235df064" style (used when
 *      no pass mosaics exist).
 *
 * A discovery result built from non-existent layer names was one of the
 * historical causes of the false "No images here" reports — this test pins
 * down that both formats resolve to a real, usable layer list.
 *
 * Run:  node test-sat60-discovery.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── Tiny XML → fake-DOM parser (just enough for discoverCoronaLayers) ───── */
function FakeDOMParser() {}
FakeDOMParser.prototype.parseFromString = function (xml) {
    const layerNodes = [];
    const re = /<Layer>([\s\S]*?)<\/Layer>/g;
    let m;
    while ((m = re.exec(String(xml))) !== null) {
        const body = m[1];
        const node = {
            getElementsByTagName: function (tag) {
                if (tag === 'Name') {
                    const nm = /<Name>([\s\S]*?)<\/Name>/.exec(body);
                    return nm ? [{ textContent: nm[1] }] : [];
                }
                if (tag === 'LatLonBoundingBox') {
                    const bb = /<LatLonBoundingBox\s+([^>]*)\/>/.exec(body);
                    if (!bb) return [];
                    const attrs = {};
                    /minx="([^"]*)"/.exec(bb[1]) && (attrs.minx = RegExp.$1);
                    /miny="([^"]*)"/.exec(bb[1]) && (attrs.miny = RegExp.$1);
                    /maxx="([^"]*)"/.exec(bb[1]) && (attrs.maxx = RegExp.$1);
                    /maxy="([^"]*)"/.exec(bb[1]) && (attrs.maxy = RegExp.$1);
                    return [{ getAttribute: function (k) { return attrs[k]; } }];
                }
                if (tag === 'BoundingBox') return [];
                return [];
            }
        };
        layerNodes.push(node);
    }
    return { getElementsByTagName: function (tag) { return tag === 'Layer' ? layerNodes : []; } };
};

/* ── Leaflet stub (same as the other sat60 harnesses) ────────────────────── */
function LatLngBounds(a, b) {
    let la = a, lb = b;
    if (Array.isArray(a) && Array.isArray(a[0])) { la = { lat: a[0][0], lng: a[0][1] }; lb = { lat: a[1][0], lng: a[1][1] }; }
    if (Array.isArray(la)) la = { lat: la[0], lng: la[1] };
    if (Array.isArray(lb)) lb = { lat: lb[0], lng: lb[1] };
    this.min = { lat: Math.min(la.lat, lb.lat), lng: Math.min(la.lng, lb.lng) };
    this.max = { lat: Math.max(la.lat, lb.lat), lng: Math.max(la.lng, lb.lng) };
}
LatLngBounds.prototype.isValid = function () { return isFinite(this.min.lat) && isFinite(this.max.lat); };
LatLngBounds.prototype.intersects = function (o) {
    return !(o.max.lat < this.min.lat || o.min.lat > this.max.lat ||
             o.max.lng < this.min.lng || o.min.lng > this.max.lng);
};

const L = {
    extend: function (target) {
        for (let i = 1; i < arguments.length; i++) {
            const src = arguments[i] || {};
            for (const k in src) target[k] = src[k];
        }
        return target;
    },
    latLngBounds: function (a, b) { return new LatLngBounds(a, b); },
    point: function (x, y) { return { x: x, y: y }; },
    CRS: { EPSG3857: { project: function (ll) { return { x: ll.lng, y: ll.lat }; } } },
    layerGroup: function (layers) {
        const group = { _layers: layers || [] };
        group.addTo = function () { return this; };
        group.addLayer = function (l) { this._layers.push(l); return this; };
        group.removeLayer = function (l) { this._layers = this._layers.filter(function (x) { return x !== l; }); return this; };
        group.hasLayer = function (l) { return this._layers.indexOf(l) !== -1; };
        return group;
    },
    DomUtil: { create: function (tag, cls) { return { className: cls || '', style: {} }; } },
    DomEvent: { on: function () {}, off: function () {}, stop: function () {}, stopPropagation: function () {} }
};

function WMSTileLayer() {}
WMSTileLayer.prototype.initialize = function (url, options) { this._url = url; this.options = options || {}; };
WMSTileLayer.prototype.getTileUrl = function (coords) { return this._url + '?LAYERS=' + encodeURIComponent(this.options.layers || 'corona:x') + '&Z=' + coords.z; };
WMSTileLayer.prototype._removeTile = function () {};
WMSTileLayer.prototype.createTile = function () { return { style: {} }; };
WMSTileLayer.prototype.getTileSize = function () { return { x: 256, y: 256 }; };
WMSTileLayer.prototype.setOpacity = function () {};
WMSTileLayer.prototype.redraw = function () {};
WMSTileLayer.extend = function (proto) {
    function SubClass() { if (this.initialize) this.initialize.apply(this, arguments); }
    SubClass.prototype = Object.create(WMSTileLayer.prototype);
    for (const k in proto) SubClass.prototype[k] = proto[k];
    return SubClass;
};
L.TileLayer = { WMS: WMSTileLayer };

const fakeMap = {
    _zoom: 12,
    getZoom: function () { return 12; },
    setZoom: function () {},
    addLayer: function (l) { if (l && l._layers) l._layers.forEach(function (x) { fakeMap._all.add(x); }); else fakeMap._all.add(l); return this; },
    removeLayer: function () { return this; },
    hasLayer: function () { return false; },
    _all: new Set(),
    createPane: function () {},
    getPane: function () { return { style: {} }; },
    getBounds: function () { return { getWest: function () { return 19.5; }, getEast: function () { return 30.5; }, getNorth: function () { return 48.5; }, getSouth: function () { return 43.5; } }; },
    on: function () { return this; },
    off: function () {},
    whenReady: function (cb) { cb(); },
    unproject: function () { return { lat: 46, lng: 25 }; },
    project: function () { return { x: 0, y: 0 }; },
    getCenter: function () { return { lat: 46, lng: 25 }; }
};

const fakeDb = {
    objectStoreNames: { contains: function () { return true; } },
    transaction: function () {
        return { objectStore: function () { return { get: function () { return { onsuccess: null, onerror: null, result: null }; } }; } };
    },
    createObjectStore: function () {}
};
const indexedDB = { open: function () { return { result: fakeDb, onupgradeneeded: null, onsuccess: function () {} }; } };

const fakeDocument = {
    createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {} }, setAttribute: function () {}, innerHTML: '' }; },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    head: { appendChild: function () {} },
    body: { appendChild: function () {} },
    addEventListener: function () {}
};

/* ── Run the Sat60 IIFE with a given GetCapabilities XML ─────────────────── */
function runIIFE(capsXml) {
    const sandbox = {
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
        AbortController: AbortController,
        Date: Date,
        Math: Math,
        JSON: JSON,
        Object: Object,
        Array: Array,
        navigator: { userAgent: 'node-test' },
        indexedDB: indexedDB,
        DOMParser: FakeDOMParser,
        fetch: function (url) {
            return Promise.resolve({
                ok: true, status: 200,
                headers: { get: function () { return 'text/xml'; } },
                text: function () { return Promise.resolve(capsXml); },
                blob: function () { return Promise.resolve({ fakePng: true }); }
            });
        },
        Image: function () { return { style: {} }; },
        document: fakeDocument,
        L: L,
        URL: { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} },
        isMobile: false
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.createCoronaWmsLayer = function (url, options) {
        const layer = new WMSTileLayer();
        layer._url = url;
        layer.options = options || {};
        layer._tiles = {};
        return layer;
    };
    sandbox.CoronaWmsQueue = { config: { minZoom: 11, concurrent: 8, cacheTtlMs: 30 * 86400000 } };
    sandbox.coronaProbeTiles = function () { return Promise.resolve({ total: 0, found: 0, empty: 0, failed: 0, foundTiles: [] }); };
    vm.createContext(sandbox);

    const mapAppCode = fs.readFileSync(path.join(__dirname, 'js', 'map-app.js'), 'utf8');
    const start = mapAppCode.indexOf('// ── SATELIT 60s');
    const end = mapAppCode.indexOf('// ── HARTI ISTORICE PREMIUM');
    const code = mapAppCode.substring(start, end);
    const prelude = `
        var map = arguments[0];
        var L = arguments[1];
        var document = arguments[2];
        var window = arguments[3];
        var setTimeout = arguments[4];
        var clearTimeout = arguments[5];
        var fetch = arguments[6];
        var translations = arguments[7];
        var ROMANIA_BOUNDS = L.latLngBounds([[43.5, 19.5], [48.5, 30.5]]);
        var SAT60_LOAD_MIN_ZOOM = 11;
        var SAT60_LOAD_NATIVE_MAX = 15;
        var SAT60_LOAD_MAX_JOBS = 2000;
        var SAT60_INITIAL_OPACITY = 0.85;
        var FALLBACK_ROMANIA_LAYERS = [
            "corona:1103-2139Aft", "corona:1103-2139Fore",
            "corona:1105-2235Fore", "corona:1106-1042Aft"
        ];
        var SAT60_GWC_URL = "https://geoserve.cast.uark.edu/geoserver/gwc/service/wms";
        var currentLang = 'ro';
    `;
    const translations = { ro: {}, en: {} };
    const finalCode = '(function () {\n' + prelude + '\n' + code + '\n})(' +
        'fakeMap, L, fakeDocument, window, setTimeout, clearTimeout, fakeFetch, translations);';
    sandbox.fakeMap = fakeMap;
    sandbox.fakeDocument = fakeDocument;
    sandbox.fakeFetch = sandbox.fetch;
    sandbox.translations = translations;
    vm.runInContext(finalCode, sandbox, { filename: 'map-app.js#sat60-iife' });
    return sandbox;
}

/* ── Test runner ─────────────────────────────────────────────────────────── */
let failures = 0;
function check(name, cond) {
    if (cond) console.log('  PASS', name);
    else { failures++; console.error('  FAIL', name); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
    console.log('[test] Satellite imagery 60\'s — Corona layer discovery (pass + frame names)');

    // ── A) Server exposes pass mosaics AND frames → passes win ──────────────
    let sb = runIIFE(
        '<WMT_MS_Capabilities><Capability>' +
        '<Layer><Name>corona:1105-2235Aft</Name><LatLonBoundingBox minx="19.5" miny="43.5" maxx="30.5" maxy="48.5"/></Layer>' +
        '<Layer><Name>corona:1105-2235df064</Name><LatLonBoundingBox minx="19.5" miny="43.5" maxx="30.5" maxy="48.5"/></Layer>' +
        '</Capability></WMT_MS_Capabilities>'
    );
    await wait(400);
    check('A.1 pass mosaic preferred over frames',
        Array.isArray(sb._sat60LayerDefs) && sb._sat60LayerDefs.length === 1 &&
        sb._sat60LayerDefs[0].layerName === 'corona:1105-2235Aft');

    // ── B) Server exposes ONLY frame layers → frames are used ───────────────
    sb = runIIFE(
        '<WMT_MS_Capabilities><Capability>' +
        '<Layer><Name>corona:1105-2235df064</Name><LatLonBoundingBox minx="19.5" miny="43.5" maxx="30.5" maxy="48.5"/></Layer>' +
        '<Layer><Name>corona:1103-2167df101</Name><LatLonBoundingBox minx="19.5" miny="43.5" maxx="30.5" maxy="48.5"/></Layer>' +
        '</Capability></WMT_MS_Capabilities>'
    );
    await wait(400);
    check('B.1 frame layers discovered when no passes exist',
        Array.isArray(sb._sat60LayerDefs) && sb._sat60LayerDefs.length === 2);
    check('B.2 frame layer names kept intact',
        sb._sat60LayerDefs && sb._sat60LayerDefs.some(function (d) { return d.layerName === 'corona:1105-2235df064'; }) &&
        sb._sat60LayerDefs.some(function (d) { return d.layerName === 'corona:1103-2167df101'; }));

    // ── C) No corona layers at all → curated fallback list ──────────────────
    sb = runIIFE('<WMT_MS_Capabilities><Capability><Layer><Name>other:thing</Name></Layer></Capability></WMT_MS_Capabilities>');
    await wait(400);
    check('C.1 curated fallback used when nothing discovered',
        Array.isArray(sb._sat60LayerDefs) && sb._sat60LayerDefs.length === 16 &&
        sb._sat60LayerDefs[0].layerName === 'corona:1022-2104Aft');

    if (failures > 0) {
        console.error('\n[test] ' + failures + ' assertion(s) FAILED');
        process.exit(1);
    }
    console.log('\n[test] ALL OK — discovery handles pass mosaics, individual frames,');
    console.log('       and falls back to the curated list when the server is empty.');
    process.exit(0);
})().catch(function (e) {
    console.error('[test] crashed:', e);
    console.error(e && e.stack);
    process.exit(1);
});
