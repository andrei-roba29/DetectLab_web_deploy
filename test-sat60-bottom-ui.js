/*
 * test-sat60-bottom-ui.js
 * ──────────────────────────────────────────────────────────────────────────
 * Node harness that extracts the Satellite-60s IIFE from js/map-app.js and
 * verifies the user-facing placement + wiring of the "Load images here"
 * button and its result message:
 *
 *   1. The button and the "No images here" pill live at the BOTTOM CENTER of
 *      the map (a `.sat60-bottom-ui` overlay appended to `.map-wrapper`) —
 *      NOT inside the sidebar layer row.
 *   2. The button is visible only while the layer toggle is ON, is disabled
 *      with a "Zoom in more" label below z11, and becomes enabled with the
 *      "Load images here" label at z11+.
 *   3. Pressing it runs the probe and reports the result in the bottom-center
 *      pill ("S-au încărcat 1 tile-uri…" in the stub below).
 *   4. Toggling the layer OFF hides the button and clears the pill.
 *
 * Run:  node test-sat60-bottom-ui.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── Minimal functional DOM stub (real appendChild / querySelector) ──────── */
function makeEl(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        style: {},
        children: [],
        _listeners: {},
        className: '',
        id: '',
        textContent: '',
        title: '',
        type: '',
        disabled: false,
        parentNode: null,
        // innerHTML: minimal parsing — creates <span ...>…</span> children so
        // querySelector('.t') works like a real browser for the button label.
        _innerHTML: '',
        appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
        addEventListener: function (ev, fn) {
            (this._listeners[ev] = this._listeners[ev] || []).push(fn);
        },
        _dispatch: function (ev) {
            (this._listeners[ev] || []).forEach(function (fn) { fn({ target: this, stopPropagation: function () {} }); }, this);
        },
        setAttribute: function (k, v) { this['_attr_' + k] = v; },
        getAttribute: function (k) { return this['_attr_' + k]; },
        classList: {
            _set: {},
            add: function (c) { this._set[c] = true; },
            remove: function (c) { delete this._set[c]; },
            contains: function (c) { return !!this._set[c]; }
        },
        querySelector: function (sel) {
            function matches(node, selector) {
                if (selector.charAt(0) === '#') return node.id === selector.slice(1);
                if (selector.charAt(0) === '.') return (node.className || '').split(/\s+/).indexOf(selector.slice(1)) !== -1;
                return node.tagName.toLowerCase() === selector.toLowerCase();
            }
            function walk(node) {
                for (let i = 0; i < node.children.length; i++) {
                    const c = node.children[i];
                    if (matches(c, sel)) return c;
                    const hit = walk(c);
                    if (hit) return hit;
                }
                return null;
            }
            return walk(this);
        }
    };
    Object.defineProperty(el, 'innerHTML', {
        get: function () { return this._innerHTML; },
        set: function (html) {
            this._innerHTML = String(html);
            const re = /<span([^>]*)>([\s\S]*?)<\/span>/g;
            let m;
            while ((m = re.exec(this._innerHTML)) !== null) {
                const span = makeEl('span');
                const attrs = m[1] || '';
                let cm = /class="([^"]*)"/.exec(attrs);
                if (cm) span.className = cm[1];
                cm = /data-key="([^"]*)"/.exec(attrs);
                if (cm) span.setAttribute('data-key', cm[1]);
                span.textContent = m[2].replace(/<[^>]+>/g, '');
                this.appendChild(span);
            }
        }
    });
    return el;
}

const ids = {};
const wrapper = makeEl('div');
wrapper.className = 'map-wrapper';
function findById(node, id) {
    if (node.id === id) return node;
    for (let i = 0; i < node.children.length; i++) {
        const hit = findById(node.children[i], id);
        if (hit) return hit;
    }
    return null;
}
const fakeDocument = {
    createElement: makeEl,
    getElementById: function (id) {
        if (ids[id]) return ids[id];
        return findById(wrapper, id) || findById(fakeDocument.body, id) || null;
    },
    querySelector: function (sel) { return sel === '.map-wrapper' ? wrapper : null; },
    head: { appendChild: function () {} },
    body: makeEl('body'),
    addEventListener: function () {}
};

/* ── Leaflet stub (mirrors test-sat60-zoom-guard.js) ─────────────────────── */
function LatLngBounds(a, b) {
    // Support both L.latLngBounds([[lat,lng],[lat,lng]]) and L.latLngBounds({lat,lng}, {lat,lng}).
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
        const group = {
            _layers: layers || [],
            addLayer: function (l) { this._layers.push(l); return this; },
            removeLayer: function (l) { this._layers = this._layers.filter(function (x) { return x !== l; }); return this; },
            hasLayer: function (l) { return this._layers.indexOf(l) !== -1; },
            clearLayers: function () { this._layers = []; return this; },
            addTo: function (map) {
                if (map && typeof map.addLayer === 'function') map.addLayer(this);
                return this;
            }
        };
        return group;
    },
    DomUtil: { create: function (tag, cls) { const e = makeEl(tag); if (cls) e.className = cls; return e; } },
    DomEvent: { on: function () {}, off: function () {}, stop: function () {}, stopPropagation: function () {} }
};

function WMSTileLayer() {}
WMSTileLayer.prototype.initialize = function (url, options) { this._url = url; this.options = options || {}; };
WMSTileLayer.prototype.getTileUrl = function (coords) {
    return this._url + '?SERVICE=WMS&LAYERS=' + encodeURIComponent(this.options.layers || 'corona:x') +
        '&BBOX=' + coords.x + '%2C' + coords.y + '%2C' + coords.z;
};
WMSTileLayer.prototype._removeTile = function () {};
WMSTileLayer.prototype.createTile = function () { return makeEl('img'); };
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

/* ── Fake map ────────────────────────────────────────────────────────────── */
const fakeLayers = new Set();
let currentZoom = 5;
const zoomListeners = [];
const fakeMap = {
    _zoom: currentZoom,
    getZoom: function () { return this._zoom; },
    setZoom: function (z) { this._zoom = z; },
    addLayer: function (layer) {
        if (layer && layer._layers) { for (const l of layer._layers) fakeLayers.add(l); }
        else fakeLayers.add(layer);
        return this;
    },
    removeLayer: function (layer) {
        if (layer && layer._layers) { for (const l of layer._layers) fakeLayers.delete(l); }
        else fakeLayers.delete(layer);
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
        String(event).split(/\s+/).forEach(function (ev) {
            if (ev === 'zoomend' || ev === 'moveend') zoomListeners.push(handler);
        });
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
    project: function () { return { x: 12345, y: 6789 }; },
    getCenter: function () { return { lat: 46, lng: 25 }; },
    _simulateZoom: function (newZoom) {
        this._zoom = newZoom;
        for (let i = 0; i < zoomListeners.length; i++) {
            try { zoomListeners[i](); } catch (e) { console.error('zoom listener threw:', e); }
        }
    }
};
fakeMap.getPanes = function () { return { overlayPane: { appendChild: function () {} } }; };

/* ── IDB stub (inert) ────────────────────────────────────────────────────── */
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
                    get: function () { return wrap(function () { return null; }); },
                    put: function () { return wrap(function () { return 'k'; }); },
                    delete: function () { return wrap(function () { return undefined; }); }
                };
            }
        };
    },
    createObjectStore: function () {}
};
const indexedDB = { open: function () { return { result: fakeDb, onupgradeneeded: null, onsuccess: function () {} }; } };

/* ── fetch stub: discovery returns a tiny Capabilities doc (fallback path) ─ */
function fakeFetch(url) {
    if (String(url).indexOf('GetCapabilities') !== -1) {
        return Promise.resolve({
            ok: true, status: 200,
            headers: { get: function () { return 'text/xml'; } },
            text: function () { return Promise.resolve('<WMT_MS_Capabilities><Capability><Layer></Layer></Capability></WMT_MS_Capabilities>'); }
        });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return 'image/png'; } },
        blob: function () { return Promise.resolve({ fakePng: true }); } });
}

/* ── Sandbox ─────────────────────────────────────────────────────────────── */
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
    fetch: fakeFetch,
    Image: function () { const i = makeEl('img'); return i; },
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
sandbox.coronaProbeTiles = function (jobs) {
    return Promise.resolve({
        total: jobs.length,
        found: jobs.length > 0 ? 1 : 0,
        empty: 0,
        failed: 0,
        foundTiles: jobs.length > 0 ? [jobs[0].z + '/' + jobs[0].x + '/' + jobs[0].y] : []
    });
};

vm.createContext(sandbox);

/* ── Extract + run the Sat60 IIFE (same technique as zoom-guard test) ───── */
const mapAppCode = fs.readFileSync(path.join(__dirname, 'js', 'map-app.js'), 'utf8');
const sat60Start = mapAppCode.indexOf('// ── SATELIT 60s');
const sat60End = mapAppCode.indexOf('// ── HARTI ISTORICE PREMIUM');
if (sat60Start < 0 || sat60End < 0) { console.error('[test] could not locate Sat60 IIFE'); process.exit(1); }
const sat60Code = mapAppCode.substring(sat60Start, sat60End);

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

const translations = {
    ro: {
        sat60_load_here: 'Încarcă imagini aici',
        sat60_zoom_more: 'Mărește mai mult',
        sat60_loading: 'Se încarcă imaginile satelitare din zona vizibilă…',
        sat60_found: 'S-au încărcat {n} tile-uri — există imagini satelitare în această zonă',
        sat60_no_images: 'Nu există imagini aici'
    },
    en: {
        sat60_load_here: 'Load images here',
        sat60_zoom_more: 'Zoom in more',
        sat60_loading: 'Loading 1960s imagery for the visible area…',
        sat60_found: 'Loaded {n} tile(s) — 1960s imagery is available here',
        sat60_no_images: 'No images here'
    }
};

// Register the sidebar toggle (checked state is driven by the test).
const toggleEl = makeEl('input');
toggleEl.id = 'satellite60sToggle';
toggleEl.checked = false;
ids['satellite60sToggle'] = toggleEl;

const finalCode = '(function () {\n' + prelude + '\n' + sat60Code + '\n})(' +
    'fakeMap, L, fakeDocument, window, setTimeout, clearTimeout, fakeFetch, translations);';
sandbox.fakeMap = fakeMap;
sandbox.fakeDocument = fakeDocument;
sandbox.translations = translations;
sandbox.fakeFetch = fakeFetch;

try {
    vm.runInContext(finalCode, sandbox, { filename: 'map-app.js#sat60-iife' });
} catch (e) {
    console.error('[test] IIFE threw:', e && e.message);
    console.error(e && e.stack);
    process.exit(1);
}

/* ── Test runner ─────────────────────────────────────────────────────────── */
let failures = 0;
function check(name, cond) {
    if (cond) console.log('  PASS', name);
    else { failures++; console.error('  FAIL', name); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
    console.log('[test] Satellite imagery 60\'s — bottom-center UI placement & wiring');

    // Wait for async layer discovery (falls back to the curated list).
    await wait(500);
    check('0.1 _sat60Ready after discovery', sandbox._sat60Ready === true);

    // The bottom-center bar must exist, anchored inside the map wrapper.
    const ui = wrapper.querySelector('.sat60-bottom-ui');
    check('0.2 .sat60-bottom-ui appended to .map-wrapper', ui !== null);
    if (!ui) {
        console.error('[test] FATAL: bottom-center UI not found — aborting');
        process.exit(1);
    }
    const uiBtn = ui.querySelector('#satellite60sLoadBtn');
    const uiMsg = ui.querySelector('#satellite60sLoadMsg');
    check('0.3 button inside the bottom-center bar', uiBtn !== null && uiBtn.id === 'satellite60sLoadBtn');
    check('0.4 message pill inside the bottom-center bar', uiMsg !== null && uiMsg.id === 'satellite60sLoadMsg');

    // ── 1) Toggle ON below z11 → button visible but disabled ("Zoom in more") ──
    fakeMap.setZoom(10);
    toggleEl.checked = true;
    sandbox.toggleSatellite60sMap(true);
    check('1.1 button visible while layer is ON', uiBtn.style.display === 'flex' || uiBtn.style.display === '');
    check('1.2 button disabled below z11', uiBtn.disabled === true);
    const lbl1 = uiBtn.querySelector('.t');
    check('1.3 label reads "Mărește mai mult" below z11', lbl1 && lbl1.textContent === 'Mărește mai mult');

    // ── 2) Zoom to z12 → button enabled, label "Încarcă imagini aici" ─────────
    fakeMap._simulateZoom(12);
    check('2.1 button enabled at z12', uiBtn.disabled === false);
    const lbl2 = uiBtn.querySelector('.t');
    check('2.2 label reads "Încarcă imagini aici" at z12', lbl2 && lbl2.textContent === 'Încarcă imagini aici');

    // ── 3) Press the button → probe runs → result shown in the bottom pill ────
    uiBtn._dispatch('click');
    await wait(120);
    const msgText = uiMsg.textContent || '';
    check('3.1 result reported in the bottom-center pill', msgText.length > 0);
    check('3.2 pill says imagery was loaded (found message)', msgText.indexOf('S-au încărcat') !== -1);
    check('3.3 pill is visible after the probe', uiMsg.style.display === 'block');

    // ── 4) Toggle OFF → button + pill hidden again ───────────────────────────
    toggleEl.checked = false;
    sandbox.toggleSatellite60sMap(false);
    check('4.1 button hidden when layer OFF', uiBtn.style.display === 'none');
    check('4.2 message pill cleared when layer OFF', uiMsg.style.display === 'none');

    if (failures > 0) {
        console.error('\n[test] ' + failures + ' assertion(s) FAILED');
        process.exit(1);
    }
    console.log('\n[test] ALL OK — "Load images here" + "No images here" live at the');
    console.log('       bottom center of the map, wired to the layer toggle and zoom.');
    process.exit(0);
})().catch(function (e) {
    console.error('[test] crashed:', e);
    console.error(e && e.stack);
    process.exit(1);
});
