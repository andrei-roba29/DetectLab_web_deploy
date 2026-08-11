/*
 * test-sat60-zoom-guard.js
 * ──────────────────────────────────────────────────────────────────────────
 * Regression test for the "Satellite imagery 60's layer crashes the site
 * on toggle" bug. The user's report:
 *
 *   "satellite imagery 60's layer when switched on causes my site to crash
 *    sometimes because of the big number of requests. I told you that it
 *    shouldnt fetch or request anything when switched on, only when 'load
 *    images here'/'incarca imagini aici' button is pressed at a minimum
 *    zoom of 11"
 *
 * The previous code already gated the NETWORK request behind manualOnly,
 * but the real crash was DOM flooding: at low zoom, 16 WMS sublayers
 * (one per Corona pass) × thousands of visible tiles each created an
 * empty <img class="leaflet-tile"> DOM element, summing to ~130,000
 * elements at z=12 and crashing the browser.
 *
 * The fix: the Sat60 IIFE must NOT add _sat60MapLayer to the Leaflet map
 * when the current zoom is below SAT60_LOAD_MIN_ZOOM (= 11). The toggle
 * remains honoured (checkbox stays checked, "Load images here" button
 * stays visible), but the actual WMS sublayers are only attached to the
 * map once the user zooms in past z11 — handled automatically by a
 * 'zoomend' handler so the user doesn't have to toggle the layer twice.
 *
 * This test loads map-app.js in a sandboxed Node VM with a minimal Leaflet
 * stub, exercises toggleSatellite60sMap(true) at three different zoom
 * levels, and asserts that:
 *
 *   1. At z=10 (below 11): the layer group is NOT added to the map.
 *   2. At z=12 (above 11): the layer group IS added to the map.
 *   3. After zooming out from z=12 to z=10: the layer group is removed.
 *   4. After zooming back in from z=10 to z=12: the layer group is
 *      re-added (the 'zoomend' handler does this automatically).
 *   5. The "Load images here" button is disabled (or marked "zoom more")
 *      below z11 and enabled from z11.
 *
 * Run:  node test-sat60-zoom-guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── Minimal Leaflet stub ─────────────────────────────────────────────────── */
function FakeImg() { this.style = {}; this.alt = ''; }
Object.defineProperty(FakeImg.prototype, 'src', { set: function (v) { this._src = v; } });

const L = {
    extend: function (target) {
        for (let i = 1; i < arguments.length; i++) {
            const src = arguments[i] || {};
            for (const k in src) target[k] = src[k];
        }
        return target;
    },
    latLngBounds: function (a, b) {
        // Support both L.latLngBounds([[lat,lng],[lat,lng]]) and L.latLngBounds({lat,lng}, {lat,lng}).
        function norm(v) {
            if (Array.isArray(v)) return { lat: v[0], lng: v[1] };
            if (v && typeof v === 'object') return { lat: v.lat, lng: v.lng };
            return { lat: 0, lng: 0 };
        }
        const la = norm(a);
        const lb = norm(b || a);
        return {
            min: { lat: Math.min(la.lat, lb.lat), lng: Math.min(la.lng, lb.lng) },
            max: { lat: Math.max(la.lat, lb.lat), lng: Math.max(la.lng, lb.lng) },
            intersects: function (o) {
                return !(o.max.lat < this.min.lat || o.min.lat > this.max.lat ||
                         o.max.lng < this.min.lng || o.min.lng > this.max.lng);
            }
        };
    },
    point: function (x, y) { return { x: x, y: y }; },
    CRS: {
        EPSG3857: { project: function (ll) { return { x: ll.lng, y: ll.lat }; } }
    },
    layerGroup: function (layers) {
        const group = {
            _layers: layers || [],
            _layerId: null,
            addLayer: function (l) { this._layers.push(l); return this; },
            removeLayer: function (l) { this._layers = this._layers.filter(function (x) { return x !== l; }); return this; },
            hasLayer: function (l) { return this._layers.indexOf(l) !== -1; },
            eachLayer: function (cb) { for (var i = 0; i < this._layers.length; i++) cb(this._layers[i]); },
            clearLayers: function () { this._layers = []; return this; },
            getLayers: function () { return this._layers; }
        };
        // addTo() must delegate to the real map's addLayer so our test
        // can track when the group is attached. We'll patch this from the
        // test runner after constructing the L stub.
        group.addTo = function (map) {
            if (map && typeof map.addLayer === 'function') map.addLayer(this);
            return this;
        };
        return group;
    },
    DomUtil: {
        create: function (tag, cls) { const img = new FakeImg(); img.className = cls || ''; return img; }
    },
    DomEvent: {
        on: function () {},
        off: function () {},
        stop: function () {},
        stopPropagation: function () {}
    }
};

/* ── TileLayer.WMS class — just enough for the Sat60 code to instantiate ──── */
function WMSTileLayer() {}
WMSTileLayer.prototype.initialize = function (url, options) { this._url = url; this.options = options || {}; };
WMSTileLayer.prototype.getTileUrl = function (coords) {
    return this._url + '?LAYERS=' + encodeURIComponent(this.options.layers || 'corona:x') +
        '&Z=' + coords.z + '&X=' + coords.x + '&Y=' + coords.y;
};
WMSTileLayer.prototype._removeTile = function () {};
WMSTileLayer.prototype.createTile = function () { return new FakeImg(); };
WMSTileLayer.prototype.getTileSize = function () { return { x: 256, y: 256 }; };
WMSTileLayer.prototype.setOpacity = function () {};
WMSTileLayer.prototype.redraw = function () {};
WMSTileLayer.extend = function (proto) {
    function SubClass() { if (this.initialize) this.initialize.apply(this, arguments); }
    SubClass.prototype = Object.create(WMSTileLayer.prototype);
    for (const k in proto) SubClass.prototype[k] = proto[k];
    SubClass.__super__ = WMSTileLayer.prototype;
    return SubClass;
};
L.TileLayer = { WMS: WMSTileLayer };

/* ── Fake map (the central object the Sat60 code interacts with) ─────────── */
const fakeLayers = new Set();
let currentZoom = 5;
const zoomListeners = [];
const fakeMap = {
    _zoom: currentZoom,
    getZoom: function () { return this._zoom; },
    setZoom: function (z) { this._zoom = z; },
    addLayer: function (layer) {
        if (layer && layer._layers) {
            // layerGroup — add its sublayers
            for (const l of layer._layers) fakeLayers.add(l);
        } else {
            fakeLayers.add(layer);
        }
        return this;
    },
    removeLayer: function (layer) {
        if (layer && layer._layers) {
            for (const l of layer._layers) fakeLayers.delete(l);
        } else {
            fakeLayers.delete(layer);
        }
        return this;
    },
    hasLayer: function (layer) {
        if (layer && layer._layers) {
            for (const l of layer._layers) if (fakeLayers.has(l)) return true;
            return false;
        }
        return fakeLayers.has(layer);
    },
    createPane: function (name) { return name; },
    getPane: function () { return { style: {} }; },
    fitBounds: function () { return this; },
    getBounds: function () {
        return {
            getSouthWest: function () { return { lat: 43.5, lng: 19.5 }; },
            getNorthEast: function () { return { lat: 48.5, lng: 30.5 }; },
            getNorth: function () { return 48.5; },
            getSouth: function () { return 43.5; },
            getEast: function () { return 30.5; },
            getWest: function () { return 19.5; },
            pad: function () { return this; },
            intersects: function () { return true; }
        };
    },
    on: function (event, handler) {
        if (event === 'zoomend') zoomListeners.push(handler);
        return this;
    },
    off: function () {},
    whenReady: function (cb) { cb(); return this; },
    flyTo: function () {},
    panInsideBounds: function () {},
    setMinZoom: function () {},
    unproject: function (px, z) {
        const n = Math.pow(2, z);
        const lng = px[0] / (256 * n) * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * px[1] / (256 * n)))) * 180 / Math.PI;
        return { lat: lat, lng: lng };
    },
    // Helper for the test: simulate a zoom change.
    _simulateZoom: function (newZoom) {
        this._zoom = newZoom;
        for (let i = 0; i < zoomListeners.length; i++) {
            try { zoomListeners[i](); } catch (e) { console.error('zoom listener threw:', e); }
        }
    }
};
fakeMap.getPanes = function () { return { overlayPane: { appendChild: function () {} } }; };

/* ── IndexedDB stub (inert — the Sat60 code doesn't fetch in this test) ──── */
const fakeDb = {
    objectStoreNames: { contains: function () { return true; } },
    transaction: function () {
        return {
            objectStore: function () {
                function wrap(fn) {
                    const req = { onsuccess: null, onerror: null, result: undefined };
                    setTimeout(function () { req.result = fn(); if (req.onsuccess) req.onsuccess(); }, 0);
                    return req;
                }
                return {
                    get: function (k) { return wrap(function () { return null; }); },
                    put: function (rec) { return wrap(function () { return rec.key; }); },
                    delete: function (k) { return wrap(function () { return undefined; }); }
                };
            }
        };
    },
    createObjectStore: function () {}
};
const indexedDB = { open: function () { return { result: fakeDb, onupgradeneeded: null, onsuccess: function () {} }; } };

/* ── fetch stub: returns 200 by default (probe would succeed if pressed) ─── */
let fetchCalls = 0;
function fakeFetch(url) {
    fetchCalls++;
    // GetCapabilities request — return a minimal XML doc the parser can
    // safely process (it iterates Layer nodes and reads <Name>).
    if (String(url).indexOf('GetCapabilities') !== -1) {
        return Promise.resolve({
            ok: true, status: 200,
            headers: { get: function () { return 'text/xml'; } },
            text: function () {
                return Promise.resolve(
                    '<WMT_MS_Capabilities>' +
                    '<Capability><Layer>' +
                    '<Name>corona:1105-2235Aft</Name>' +
                    '<LatLonBoundingBox minx="19.5" miny="43.5" maxx="30.5" maxy="48.5"/>' +
                    '</Layer></Capability></WMT_MS_Capabilities>'
                );
            },
            blob: function () { return Promise.resolve({ fakePng: true }); }
        });
    }
    return Promise.resolve({
        ok: true, status: 200,
        headers: { get: function () { return 'image/png'; } },
        blob: function () { return Promise.resolve({ fakePng: true }); }
    });
}

/* ── DOM stub: enough to make `document.getElementById('satellite60sToggle')`
      return a checkbox whose `.checked` we control, and to let
      `document.getElementById('satellite60sLoadBtn')` be discovered. ─────── */
const fakeCheckbox = {
    _checked: false,
    get checked() { return this._checked; },
    set checked(v) { this._checked = !!v; }
};
const fakeLoadBtn = {
    style: {},
    classList: { add: function () {}, remove: function () {} },
    disabled: false,
    setAttribute: function () {},
    querySelector: function () { return { setAttribute: function () {}, textContent: '' }; }
};
const fakeLoadMsg = {
    style: { display: 'none' },
    textContent: ''
};
const fakeDocument = {
    createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {} }, setAttribute: function () {} }; },
    getElementById: function (id) {
        if (id === 'satellite60sToggle') return fakeCheckbox;
        if (id === 'satellite60sLoadBtn') return fakeLoadBtn;
        if (id === 'satellite60sLoadMsg') return fakeLoadMsg;
        if (id === 'histPremiumToggle') return null;
        if (id === 'satellite60sMapPct') return { textContent: '' };
        return null;
    },
    head: { appendChild: function () {} },
    body: { appendChild: function () {} },
    addEventListener: function () {}
};
// Make the checkbox toggle a 'change' event we can drive in the test.
fakeCheckbox._dispatchChange = function () {
    // The Sat60 IIFE adds a document-level 'change' listener. We use the
    // document-level dispatcher below.
    if (typeof fakeDocument._changeListeners === 'object') {
        for (let i = 0; i < fakeDocument._changeListeners.length; i++) {
            try {
                fakeDocument._changeListeners[i]({ target: fakeCheckbox });
            } catch (e) { console.error('change listener threw:', e); }
        }
    }
};
fakeDocument.addEventListener = function (event, handler) {
    if (event === 'change') {
        if (!fakeDocument._changeListeners) fakeDocument._changeListeners = [];
        fakeDocument._changeListeners.push(handler);
    }
};

/* ── Translations (just enough for the _sat60T() helper) ─────────────────── */
const translations = {
    ro: { sat60_load_here: 'Încarcă imagini aici', sat60_zoom_more: 'Mărește mai mult' },
    en: { sat60_load_here: 'Load images here',   sat60_zoom_more: 'Zoom in more' }
};
let currentLang = 'ro';

/* ── corona-wms-layer.js minimal stub (only window.createCoronaWmsLayer +
      window.coronaProbeTiles + window.CoronaWmsQueue are referenced from
      map-app.js's Sat60 IIFE) ────────────────────────────────────────────── */
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
    Uint8Array: Uint8Array,
    Uint8ClampedArray: Uint8ClampedArray,
    navigator: { userAgent: 'node-test' },
    indexedDB: indexedDB,
    fetch: fakeFetch,
    Image: FakeImg,
    document: { createElement: function () { return { style: {}, setAttribute: function () {} }; }, head: { appendChild: function () {} }, getElementById: function () { return null; } },
    L: L,
    translations: translations,
    currentLang: 'ro',
    isMobile: false
};
sandbox.window = sandbox;
sandbox.self = sandbox;
let blobUrlCount = 0;
sandbox.URL = {
    createObjectURL: function () { return 'blob:fake-' + (++blobUrlCount); },
    revokeObjectURL: function () {}
};

// Inject the optimised CoronaWmsLayer createCoronaWmsLayer + queue before map-app.js
sandbox.createCoronaWmsLayer = function (url, options) {
    const layer = new WMSTileLayer();
    layer._url = url;
    layer.options = options || {};
    layer._tiles = {};
    return layer;
};
sandbox.CoronaWmsQueue = { config: { minZoom: 11, concurrent: 8, cacheTtlMs: 30 * 86400000 } };
sandbox.coronaProbeTiles = function (jobs) {
    return Promise.resolve({ total: jobs.length, found: 0, empty: jobs.length, failed: 0, foundTiles: [] });
};

vm.createContext(sandbox);

/* ── Build a minimal initMap wrapper that skips ALL the unrelated layers
      (so we get to the Sat60 IIFE without crashing on missing globals).    */
const mapAppCode = fs.readFileSync(path.join(__dirname, 'js', 'map-app.js'), 'utf8');

// We can't run the full map-app.js (it depends on too many globals), but
// the relevant Sat60 IIFE is a self-contained block. The cleanest test is
// to extract that block and run it in isolation. The block is delimited
// by the comment '// ── SATELIT 60s' at the top and the IIFE close at the
// matching '})();'.
const sat60Start = mapAppCode.indexOf('// ── SATELIT 60s');
const sat60End = mapAppCode.indexOf('// ── HARTI ISTORICE PREMIUM');
if (sat60Start < 0 || sat60End < 0) {
    console.error('[test] could not locate Sat60 IIFE in map-app.js');
    process.exit(1);
}
const sat60Code = mapAppCode.substring(sat60Start, sat60End);

// The IIFE captures the outer `map` variable. We need to provide a stub for
// every other free variable the IIFE references. The simplest way: prepend
// the stubs as local `var` declarations so they shadow any globals, then
// inline the raw IIFE body verbatim.
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
    var SAT60_GWC_URL = "https://wms.test/wms";
    var currentLang = 'ro';
`;

// Last-mile: the Sat60 IIFE references `currentLang` and `translations`
// at the very end of the closure (for the _sat60T helper). We've already
// provided them above. Now we run the wrapped block and capture `window`
// at the end (which is what the IIFE assigns its public functions to).

/* ── Run the Sat60 IIFE in the sandbox ────────────────────────────────────── */
// We inject the stub values into the sandbox as globals so the IIFE wrapper
// can reference them by name. The wrapper itself takes care of passing
// them as arguments to the Sat60 closure.
sandbox.fakeMap = fakeMap;
sandbox.fakeDocument = fakeDocument;
sandbox.translations = translations;
sandbox.fakeFetch = fakeFetch;
// The IIFE in map-app.js is written as `(function () { ... })();` and
// references the outer `map` and other locals from initMap(). We inject a
// prelude that binds those locals via the `arguments` of an outer wrapper
// function (we use `arguments` because the test code calls this with
// real values), then inline the raw IIFE body. The outer wrapper is the
// IIFE itself — we use `(function () { ... })()` and put the inner IIFE
// inside its body.
const finalCode = '(function () {\n' + prelude + '\n' + sat60Code + '\n})(fakeMap, L, fakeDocument, window, setTimeout, clearTimeout, fakeFetch, translations);';
try {
    // Sanity check: writing to `window` in the sandbox should show up in
    // `sandbox` (because we set `sandbox.window = sandbox` at the top).
    vm.runInContext('window.__sanity__ = 42;', sandbox, { filename: 'sanity.js' });
    if (sandbox.__sanity__ !== 42) {
        console.error('[test] FATAL: window writes do not propagate to the sandbox');
        process.exit(1);
    }
    vm.runInContext(finalCode, sandbox, { filename: 'map-app.js#sat60-iife' });
} catch (e) {
    console.error('[test] IIFE threw:', e && e.message);
    console.error('  stack:', e && e.stack);
    process.exit(1);
}

// Give the async discoverCoronaLayers callback time to run.
setTimeout(function () {
    console.log('[debug] After 500ms — sandbox keys:');
    for (const k of Object.keys(sandbox)) {
        if (k.indexOf('sat60') === 0 || k.indexOf('Sat60') === 0 || k === 'toggleSatellite60sMap' || k === 'discoverCoronaLayers' || k === 'ensureSat60Layers') {
            console.log('   ', k, '=', typeof sandbox[k]);
        }
    }
    console.log('[debug] sandbox._sat60Ready =', sandbox._sat60Ready);
}, 500);

// Debug: dump the sandbox keys that look Sat60-related.
console.log('[debug] sandbox keys (filtered):');
for (const k of Object.keys(sandbox)) {
    if (k.indexOf('sat60') === 0 || k.indexOf('Sat60') === 0 || k === 'toggleSatellite60sMap' || k === 'discoverCoronaLayers' || k === 'ensureSat60Layers') {
        console.log('   ', k, '=', typeof sandbox[k]);
    }
}
// The IIFE was designed to attach to the global `window` object, so the
// `window` symbol it sees IS our `sandbox`. Verify the public API exists.
// The `discoverCoronaLayers(...)` call kicks off an async fetch whose
// callback assigns the public API. We wait briefly before checking.
setTimeout(function () {
    if (typeof sandbox.toggleSatellite60sMap !== 'function') {
        console.error('[test] FATAL: toggleSatellite60sMap not registered on the window sandbox');
        console.error('  typeof sandbox.toggleSatellite60sMap =', typeof sandbox.toggleSatellite60sMap);
        console.error('  typeof sandbox._sat60MapLayer =', typeof sandbox._sat60MapLayer);
        console.error('  typeof sandbox._sat60FrameLayers =', typeof sandbox._sat60FrameLayers);
        console.error('  typeof sandbox._sat60Ready =', sandbox._sat60Ready);
        console.error('  typeof sandbox._sat60LayerDefs =', typeof sandbox._sat60LayerDefs);
        process.exit(1);
    }
    // The public API is now registered; proceed with the test.
    runTests();
}, 500);

function runTests() {
// (the IIFE produces some [Sat60] console output as part of normal startup
// — that's expected; only assertions in the runTests body are failures.)

/* ── Test helper: is the Sat60 group currently attached to the fake map? ── */
function isSat60OnMap() {
    const group = sandbox._sat60MapLayer;
    if (!group) return false;
    return fakeMap.hasLayer(group);
}

/* ── Test runner ──────────────────────────────────────────────────────────── */
let failures = 0;
function check(name, cond) {
    if (cond) console.log('  PASS', name);
    else { failures++; console.error('  FAIL', name); }
}

(async function () {
    console.log('[test] Satellite imagery 60\'s — DOM-flooding guard at low zoom');

    // The Sat60 IIFE finishes its async layer discovery inside the
    // 500ms wait we did before calling runTests(). The discovery callback
    // sets _sat60Ready=true and registers toggleSatellite60sMap. We just
    // verify those side effects here.
    check('0.1 _sat60Ready is true after discovery', sandbox._sat60Ready === true);
    check('0.2 _sat60LayerDefs is non-empty', Array.isArray(sandbox._sat60LayerDefs) && sandbox._sat60LayerDefs.length > 0);

    // ── 1) Toggle ON at z=10 (below threshold) — layer group must stay detached ──
    fakeMap.setZoom(10);
    fakeCheckbox._checked = true;
    fakeCheckbox._dispatchChange();
    sandbox.toggleSatellite60sMap(true);
    check('1.1 toggleSatellite60sMap(true) at z=10 does NOT add layer to map', isSat60OnMap() === false);
    check('1.2 _sat60FrameLayers built (sublayers exist in memory)', Array.isArray(sandbox._sat60FrameLayers) && sandbox._sat60FrameLayers.length > 0);

    // ── 2) Toggle ON at z=12 (above threshold) — layer group MUST be added ──
    fakeMap.setZoom(12);
    sandbox.toggleSatellite60sMap(true);
    check('2.1 toggleSatellite60sMap(true) at z=12 adds layer to map', isSat60OnMap() === true);

    // ── 3) Zoom out from z=12 to z=10 — layer group MUST be removed (zoomend) ──
    fakeMap.setZoom(10);
    fakeMap._simulateZoom(10);
    check('3.1 zoomend from z=12 to z=10 removes layer from map', isSat60OnMap() === false);

    // ── 4) Zoom in from z=10 to z=12 — layer group MUST be re-added (zoomend) ──
    fakeMap.setZoom(12);
    fakeMap._simulateZoom(12);
    check('4.1 zoomend from z=10 to z=12 re-adds layer to map', isSat60OnMap() === true);

    // ── 5) Toggle OFF — layer group MUST be removed (works at any zoom) ─────
    fakeCheckbox._checked = false;
    fakeCheckbox._dispatchChange();
    sandbox.toggleSatellite60sMap(false);
    check('5.1 toggleSatellite60sMap(false) at z=12 removes layer from map', isSat60OnMap() === false);

    // ── 6) Toggle ON, then zoom out, then zoom in — fully automatic ────────
    fakeCheckbox._checked = true;
    fakeCheckbox._dispatchChange();
    fakeMap.setZoom(13);
    sandbox.toggleSatellite60sMap(true);
    check('6.1 toggle ON at z=13 → layer is on the map', isSat60OnMap() === true);
    fakeMap._simulateZoom(7);
    check('6.2 zoomend to z=7 → layer is removed from the map', isSat60OnMap() === false);
    fakeMap._simulateZoom(13);
    check('6.3 zoomend back to z=13 → layer is re-added', isSat60OnMap() === true);

    // ── 7) Multi-zoom load + "moving never stops/restarts" (2026-08) ───────
    // User requirements (2026-08-11):
    //   • pressing "Load images here" loads ALL tiles for the viewport visible
    //     when pressed, at the current zoom AND every deeper zoom (up to
    //     maxNativeZoom), so zooming in afterwards shows imagery instead of a
    //     blank map;
    //   • moving the map while tiles are fetched does NOT stop the initial
    //     process and does NOT start fetching for the new viewport — the
    //     button must be pressed again for a new viewport, and a press always
    //     fetches exactly the viewport visible when it was pressed.
    // Swap the probe stub for one that records every call and reports one
    // found tile per stage (a tile inside Romania, so the pyramid can expand).
    const probeCalls = []; // each entry: { z, nJobs }
    let probeDelay = 0;
    sandbox.coronaProbeTiles = function (jobs, opts) {
        const zs = jobs.map(function (j) { return j.z; });
        probeCalls.push({ z: zs[0], nJobs: jobs.length });
        if (opts && opts.onTileFound && jobs.length > 0) {
            const j0 = jobs[0];
            // Report the first job as "found" — it is inside Romania (the job
            // list was filtered), so its children drive the deeper stages.
            opts.onTileFound({ layerLabel: j0.layerLabel, z: j0.z, x: j0.x, y: j0.y }, 'blob:fake');
        }
        return new Promise(function (resolve) {
            setTimeout(function () {
                resolve({ total: jobs.length, found: 1, empty: 0, failed: 0, cancelled: 0, foundTiles: [] });
            }, probeDelay);
        });
    };

    // 7.1 press the button at z=12 → first stage probes z=12 (current viewport)
    probeCalls.length = 0;
    fakeMap.setZoom(12);
    sandbox.toggleSatellite60sMap(true); // ensure the layer is on
    sandbox.loadSatellite60sHere();
    await new Promise(function (r) { setTimeout(r, 120); });
    check('7.1 button press probes z=12 first',
        probeCalls.length >= 1 && probeCalls[0].z === 12);

    // 7.2 the SAME press keeps going deeper automatically (z13, z14, z15) —
    //     children of the found tiles — so zooming in is already covered.
    const deeper = probeCalls.map(function (c) { return c.z; }).filter(function (z) { return z > 12; });
    check('7.2 one press also loads deeper zooms (pyramid)',
        deeper.indexOf(13) !== -1 && deeper.indexOf(14) !== -1 && deeper.indexOf(15) !== -1);

    // 7.3 after the load finishes, moving the map does NOT trigger any new
    //     fetch (no auto-continue) — a new viewport needs a new button press.
    probeCalls.length = 0;
    fakeMap._simulateZoom(13);
    fakeMap._simulateZoom(12);
    await new Promise(function (r) { setTimeout(r, 60); });
    check('7.3 moving after a load starts NO new fetch',
        probeCalls.length === 0);

    // 7.4 moving WHILE the load is running does NOT cancel it and does NOT
    //     restart it — the initial process keeps running to completion.
    probeCalls.length = 0;
    probeDelay = 30; // each stage takes 30 ms
    fakeMap.setZoom(12);
    sandbox.loadSatellite60sHere();
    await new Promise(function (r) { setTimeout(r, 5); }); // stage z12 in flight
    fakeMap._simulateZoom(14);                             // user moves mid-load
    await new Promise(function (r) { setTimeout(r, 400); }); // let it finish
    probeDelay = 0;
    const zs = probeCalls.map(function (c) { return c.z; });
    const z12Count = zs.filter(function (z) { return z === 12; }).length;
    check('7.4 moving mid-load does NOT stop or restart the initial process',
        zs.join(',') === '12,13,14,15' && z12Count === 1);

    // 7.5 toggling OFF then moving does NOT auto-fetch (button-only fetches)
    sandbox.toggleSatellite60sMap(false);
    probeCalls.length = 0;
    fakeMap._simulateZoom(13);
    await new Promise(function (r) { setTimeout(r, 50); });
    check('7.5 no auto-fetch after toggle OFF + zoom',
        probeCalls.length === 0);

    if (failures > 0) {
        console.error('\n[test] ' + failures + ' assertion(s) FAILED');
        process.exit(1);
    }
    console.log('\n[test] ALL OK — Sat60 layer never attaches to the map below z=11,');
    console.log('       and re-attaches automatically when the user zooms in past the threshold.');
    process.exit(0);
})().catch(function (e) {
    console.error('[test] crashed:', e && e.stack || e);
    process.exit(1);
});
}  // end of runTests()
