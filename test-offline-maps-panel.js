// Regression tests for the offline-maps panel (js/offline-maps.js +
// css/offline-maps.css). Browser-free, like the other tests in this repo.
//
// What was broken
// ---------------
// 1. Zoom wording: the download options showed two bare numbers with no label
//    at all (.offline-detail-label was never filled in). The dropdowns are now
//    named "Nivel zoom" / "Zoom level", with "de la … până la …" wording and
//    matching aria-labels.
// 2. Closing the ring: the polygon could only be finished with a double-click
//    or the Finish button, which is hard on a phone. A tap within 18 screen
//    pixels of the FIRST corner now closes the polygon, and that corner is
//    painted green and pulses so it is recognisable as the closing handle.
// 3. Over-sized polygon: finishDrawing() reported the 10 km² error and then
//    called updatePanel(), which overwrote the message with the generic
//    "layers from the active offline map" line — so the refusal looked like it
//    did nothing. The message is sticky now, and the size is checked while
//    drawing, not only on Finish.
// 4. Layout: .offline-map-panel was clamped to min(76vh, 620px), so with many
//    downloadable layers it grew taller than the map canvas and spilled out of
//    it; in the installed app the PWA bottom stacks covered the download
//    button and the phone status bar covered the "Hărți offline salvate"
//    library header (and with it its close button).
//
// Run: node test-offline-maps-panel.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const SOURCE = read('js/offline-maps.js');
const CSS = read('css/offline-maps.css');

/* ── 1. Stylesheet contracts ──────────────────────────────────────────────── */

function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css);
    assert(match, 'missing CSS rule for ' + selector);
    return match[1];
}

const panelRule = ruleBody(CSS, '.offline-map-panel');
assert(/max-height:\s*min\(620px,\s*calc\(100%\s*-\s*28px\)\)/.test(panelRule),
    'the offline panel must be clamped to the map canvas (100% of .map-frame), not to the viewport');
assert(!/76vh/.test(panelRule), 'the old viewport-based clamp would let the panel spill out of the map');

const downloadBtnRule = ruleBody(CSS, '.offline-download-btn');
assert(/position:\s*sticky/.test(downloadBtnRule),
    'the download button must stay reachable while the layer list scrolls');

const layerOptionsRule = ruleBody(CSS, '.offline-layer-options');
assert(/max-height:/.test(layerOptionsRule) && /overflow-y:\s*auto/.test(layerOptionsRule),
    'a long layer catalogue must scroll inside the panel instead of stretching it');

const pwaPanelRule = ruleBody(CSS, 'body.is-pwa .offline-map-panel');
assert(/bottom:\s*calc\(8px \+ var\(--pwa-bottom-controls-clearance/.test(pwaPanelRule),
    'in the installed app the panel must sit above the fixed PWA bottom bar');
assert(/max-height:[^;]*--pwa-bottom-controls-clearance/.test(pwaPanelRule),
    'the PWA panel height must subtract the bottom-bar clearance');

const pwaLibraryRule = ruleBody(CSS, 'body.is-pwa .offline-library');
assert(/top:\s*calc\(14px \+ env\(safe-area-inset-top/.test(pwaLibraryRule),
    'the saved-maps library needs top padding for the phone status bar in standalone mode');

/* ── 2. Runtime behaviour of the panel ───────────────────────────────────── */

class ClassList {
    constructor(classes) { this._set = new Set(classes || []); }
    add(name) { this._set.add(name); }
    remove(name) { this._set.delete(name); }
    contains(name) { return this._set.has(name); }
    toggle(name, on) {
        if (on === undefined) on = !this.contains(name);
        if (on) this.add(name); else this.remove(name);
        return on;
    }
}

class StubElement {
    constructor(tag, id) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.id = id || '';
        this.classList = new ClassList();
        this.style = {};
        this.children = [];
        this.attributes = {};
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.value = '';
        this.title = '';
        this._children = new Map();
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    // Only the panel's own lookups matter here, so a stable stub per selector
    // is enough: the production code addresses every control by selector.
    querySelector(selector) {
        if (!this._children.has(selector)) this._children.set(selector, new StubElement('div'));
        return this._children.get(selector);
    }
}

function makeLatLng(lat, lng) {
    return {
        lat: lat,
        lng: lng,
        distanceTo: function (other) {
            const dLat = (other.lat - this.lat) * 111320;
            const dLng = (other.lng - this.lng) * 111320 * Math.cos(this.lat * Math.PI / 180);
            return Math.sqrt(dLat * dLat + dLng * dLng);
        }
    };
}

const byId = new Map();
const bySelector = new Map();
const documentListeners = new Map();
const documentMock = {
    readyState: 'complete',
    body: new StubElement('body'),
    createElement: function (tag) { return new StubElement(tag); },
    getElementById: function (id) {
        if (!byId.has(id)) byId.set(id, new StubElement('div', id));
        return byId.get(id);
    },
    querySelector: function (selector) {
        if (!bySelector.has(selector)) bySelector.set(selector, new StubElement('div'));
        return bySelector.get(selector);
    },
    addEventListener: function (type, handler) {
        if (!documentListeners.has(type)) documentListeners.set(type, []);
        documentListeners.get(type).push(handler);
    },
    dispatchEvent: function (event) {
        (documentListeners.get(event.type) || []).forEach(function (handler) { handler(event); });
        return true;
    }
};

const windowListeners = new Map();
const storage = new Map();
const container = new StubElement('div');
const mapHandlers = new Map();
const mapMock = {
    _panes: {},
    _layers: new Set(),
    doubleClickZoom: { enable: function () {}, disable: function () {} },
    createPane: function (name) { this._panes[name] = { style: {} }; },
    getPane: function (name) { return this._panes[name] || null; },
    getContainer: function () { return container; },
    on: function (types, handler) {
        String(types).split(' ').forEach(function (type) { mapHandlers.set(type, handler); });
        return this;
    },
    off: function (types, handler) {
        String(types).split(' ').forEach(function (type) {
            const current = mapHandlers.get(type);
            if (!handler || current === handler) mapHandlers.delete(type);
        });
        return this;
    },
    // 10 000 px per degree ≈ zoom 14 in Web Mercator.
    latLngToContainerPoint: function (latlng) { return { x: latlng.lng * 10000, y: -latlng.lat * 10000 }; },
    hasLayer: function (layer) { return this._layers.has(layer); },
    removeLayer: function (layer) { this._layers.delete(layer); return this; },
    addLayer: function (layer) { this._layers.add(layer); return this; },
    fitBounds: function () { return this; }
};

function makeLayer(options) {
    return {
        options: options || {},
        addTo: function (map) { map._layers.add(this); return this; },
        setStyle: function () { return this; },
        setLatLngs: function () { return this; },
        setLatLng: function () { return this; },
        on: function () { return this; }
    };
}

// Every layer the module asks Leaflet to draw is recorded, so a test can prove
// the drawing flow stays a POLYGON (no dots, no circles around a pin).
const drawn = [];
function record(kind, value) {
    drawn.push({ kind: kind, value: value });
    return value;
}

const L = {
    polyline: function (points, options) { return record('polyline', makeLayer(options)); },
    polygon: function (points, options) { return record('polygon', makeLayer(options)); },
    circleMarker: function (latlng, options) { return record('circleMarker', makeLayer(options)); },
    marker: function (latlng, options) { return record('marker', makeLayer(options)); },
    divIcon: function (options) { return options || {}; },
    tileLayer: function (url, options) { return makeLayer(options); },
    latLng: function (lat, lng) { return makeLatLng(lat, lng); },
    DomEvent: { stopPropagation: function () {} }
};

let lang = 'ro';
const windowMock = {
    _dlMap: mapMock,
    L: L,
    _currentLang: function () { return lang; },
    setTimeout: function () { return 0; },
    setInterval: function () { return 0; },
    clearTimeout: function () {},
    clearInterval: function () {},
    localStorage: {
        getItem: function (key) { return storage.has(key) ? storage.get(key) : null; },
        setItem: function (key, value) { storage.set(key, String(value)); },
        removeItem: function (key) { storage.delete(key); }
    },
    addEventListener: function (type, handler) {
        if (!windowListeners.has(type)) windowListeners.set(type, []);
        windowListeners.get(type).push(handler);
    },
    removeEventListener: function () {},
    requestAnimationFrame: function (handler) { return handler && handler(); }
};
windowMock.window = windowMock;

const sandbox = {
    window: windowMock,
    document: documentMock,
    L: L,
    console: console,
    localeStorage: windowMock.localStorage,
    localStorage: windowMock.localStorage,
    Promise: Promise,
    Number: Number,
    String: String,
    Math: Math,
    Date: Date,
    JSON: JSON,
    Array: Array,
    Object: Object,
    isFinite: isFinite,
    encodeURIComponent: encodeURIComponent,
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; }
};

vm.createContext(sandbox);
vm.runInContext(SOURCE, sandbox, { filename: 'offline-maps.js' });

const state = sandbox.window._offlineMapsState;
assert(state && state.map, 'offline maps should boot against the stub map');
const panel = bySelector.get('.map-frame').children[0];
assert(panel && panel.id === 'offlineMapPanel', 'the panel should be mounted inside the map frame');
const messageNode = panel.querySelector('.offline-panel-message');

function resetDrawing() {
    panel.querySelector('.offline-clear').onclick();   // clears points + status
    panel.querySelector('.offline-redraw').onclick();  // starts a fresh ring
    assert.equal(state.drawState, 'drawing');
}

function tapMap(lat, lng) {
    const handler = mapHandlers.get('click');
    assert(handler, 'the drawing click handler should be bound while drawing');
    handler({ latlng: makeLatLng(lat, lng) });
}

function tapFirstCorner() {
    const first = state.points[0];
    tapMap(first.lat, first.lng);
}

/* 2a. Naming of the zoom-level pickers. */
windowMock.toggleOfflineMaps();
assert.equal(panel.querySelector('.offline-zoom-name').textContent, 'Nivel zoom',
    'the zoom dropdowns must be labelled "Nivel zoom"');
assert.equal(panel.querySelector('.offline-zoom-from').textContent, 'de la');
assert.equal(panel.querySelector('.offline-zoom-to').textContent, 'până la');
assert(/Nivel zoom de la/.test(panel.querySelector('#offlineZoomMin').getAttribute('aria-label') || ''),
    'the minimum-zoom dropdown needs a spoken "Nivel zoom" label');
assert(/Nivel zoom până la/.test(panel.querySelector('#offlineZoomMax').getAttribute('aria-label') || ''),
    'the maximum-zoom dropdown needs a spoken "Nivel zoom" label');

/* 2b. Tapping the first corner closes the ring. */
resetDrawing();
tapMap(44.0, 20.0);
tapMap(44.002, 20.0);
tapMap(44.002, 20.002);
assert.equal(state.points.length, 3);
assert.equal(state.drawState, 'drawing');
tapFirstCorner();
assert.equal(state.drawState, 'finished', 'tapping the first corner must finish the polygon');
assert.equal(state.points.length, 3, 'the closing tap must not add a fourth corner');

/* A tap far away still adds a corner (the tolerance is pixels, not the whole map). */
resetDrawing();
tapMap(44.0, 20.0);
tapMap(44.01, 20.0);
assert.equal(state.points.length, 2, 'a tap far from the first corner adds a corner');
assert.equal(state.drawState, 'drawing');

/* 2c. An over-sized polygon reports why it is refused, and keeps reporting it. */
resetDrawing();
tapMap(44.0, 20.0);
tapMap(44.0, 24.0);
tapMap(48.0, 22.0);
assert.equal(state.status && state.status.key, 'tooLarge',
    'the size limit must be reported while drawing');
assert.equal(state.status.isError, true);
assert(/10 km²/.test(messageNode.textContent), 'the panel should show the 10 km² error, got: ' + messageNode.textContent);

const errorText = messageNode.textContent;
panel.querySelector('.offline-finish').onclick();
assert.equal(state.drawState, 'drawing', 'an over-sized polygon cannot be finished');
assert.equal(messageNode.textContent, errorText,
    'the error must survive the panel re-render (regression: it was overwritten by the status line)');
assert.equal(messageNode.classList.contains('is-error'), true, 'the message must stay styled as an error');

/* A smaller ring clears the error again. */
resetDrawing();
assert.equal(state.status, null, 'starting a new polygon clears the previous error');
tapMap(44.0, 20.0);
tapMap(44.002, 20.0);
tapMap(44.002, 20.002);
assert.equal(state.status, null, 'a polygon inside the limit raises no error');
panel.querySelector('.offline-finish').onclick();
assert.equal(state.drawState, 'finished');
assert(/Hărți offline|active|Straturile/i.test(messageNode.textContent) || messageNode.textContent.length > 0);

/* 2d. English wording after a language switch. */
lang = 'en';
documentMock.dispatchEvent({ type: 'detectlab:langchange' });
assert.equal(panel.querySelector('.offline-zoom-name').textContent, 'Zoom level',
    'the English label must read "Zoom level"');
assert.equal(panel.querySelector('.offline-zoom-from').textContent, 'from');
assert.equal(panel.querySelector('.offline-zoom-to').textContent, 'to');
assert(/Zoom level from/.test(panel.querySelector('#offlineZoomMin').getAttribute('aria-label') || ''));
lang = 'ro';

/* ── 3. Only the polygon is drawn: no pins, no radius circles ───────────── */
function freshRing() {
    if (!state.mode) windowMock.toggleOfflineMaps();      // offline mode on
    panel.querySelector('.offline-redraw').onclick();     // a clean polygon
    assert.equal(state.drawState, 'drawing');
}

drawn.length = 0;
freshRing();
tapMap(44.0, 20.0);
tapMap(44.002, 20.0);
tapMap(44.002, 20.002);
assert(!drawn.some(d => d.kind === 'circleMarker'),
    'drawing an offline area must not paint circleMarkers (the "pin with a radius" look)');
assert(!drawn.some(d => d.kind === 'marker'),
    'drawing an offline area must not paint markers either');
assert(drawn.some(d => d.kind === 'polygon'),
    'from the third corner on, the preview itself must be the polygon');
drawn.length = 0;
panel.querySelector('.offline-finish').onclick();
assert(!drawn.some(d => d.kind === 'circleMarker' || d.kind === 'marker'),
    'finishing the polygon must not add handles on top of it');

/* A half-drawn ring owns the map taps: the analysis layers must not drop their
   pin + radius circle on the same gesture (js/offline-maps.js publishes the
   flag, lidar-scanner / archeo-potential / archeo-report all read it). */
assert(sandbox.window._dlOfflineDrawActive === false,
    'the tap-ownership flag is released once the ring is finished');
freshRing();
assert(sandbox.window._dlOfflineDrawActive === true,
    'the flag is set while a polygon is being drawn');
for (const file of ['js/lidar-scanner.js', 'js/archeo-potential.js', 'js/archeo-report.js']) {
    assert(/_dlOfflineDrawActive/.test(read(file)),
        file + ' must skip its pin-with-radius tap while an offline polygon is drawn');
}
windowMock.toggleOfflineMaps();                            // mode off
assert(sandbox.window._dlOfflineDrawActive === false, 'turning the mode off releases the flag');

/* ── 4. The ✕ that leaves an active offline map ─────────────────────────── */
const exitBtn = bySelector.get('.map-frame').children[1];
assert(exitBtn && exitBtn.id === 'offlineMapExit',
    'the map frame hosts the offline exit button next to the panel');
assert(!exitBtn.classList.contains('is-visible'),
    'with no active offline map the ✕ stays hidden');
documentMock.dispatchEvent({ type: 'detectlab:langchange' });   // re-localise (2d left the DOM in EN)
assert(/Ieși din harta offline/.test(exitBtn.querySelector('.offline-active-exit-label').textContent),
    'the ✕ is labelled and titled, not a bare glyph');
assert(/Ieși din harta offline/.test(exitBtn.getAttribute('title') || ''),
    'the ✕ carries a spoken name');

state.activeId = 'offline_test';
state.refreshExitButton();
assert(exitBtn.classList.contains('is-visible'),
    'an ACTIVE offline map shows the ✕, centred at the bottom of the screen');

// And it is the way out: local layers off, offline mode off.
state.mode = true;
exitBtn.onclick({ stopPropagation() {} });
assert.equal(state.activeId, null, 'the ✕ deactivates the offline map');
assert.equal(state.mode, false, 'the ✕ also leaves the offline drawing mode');
assert(!exitBtn.classList.contains('is-visible'), 'the ✕ hides itself again');

const exitCss = read('css/offline-maps.css');
assert(!/\.offline-vertex-icon|\.offline-first-vertex|offlineFirstVertexPulse/.test(exitCss),
    'the pin-with-radius styling (vertex dots, pulsing first corner) must be gone with the logic');
const exitRule = /\.offline-active-exit\s*\{([^}]*)\}/.exec(exitCss);
assert(exitRule, 'the ✕ is styled in css/offline-maps.css');
assert(/left:\s*50%/.test(exitRule[1]) && /translateX\(-50%\)/.test(exitRule[1]),
    'the ✕ is centred horizontally');
assert(/bottom:[^;]*var\(--layer-dock-clearance/.test(exitRule[1]),
    'the ✕ lifts above the bottom-centred action dock instead of overlapping it');
assert(/\.offline-active-exit\.is-visible/.test(exitCss), 'the ✕ has an explicit visible state');

console.log('✓ offline maps: zoom-level wording, ring closing, size error and panel layout');
console.log('All offline-maps panel checks passed.');
