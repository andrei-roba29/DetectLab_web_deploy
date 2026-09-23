// Regression: toggling „Zone cu potențial arheologic” on and back off must not
// make detectorist pins unclickable — including pins that sit inside the
// analysed zone.
//
// Root cause
// ----------
// pane_archeo is z-index 660, above Leaflet's marker pane (600) where the
// nearby-detectorist pins live (js/map-app.js, plain L.marker → markerPane).
// Bubbles and the purple search circle are drawn by an L.canvas renderer: ONE
// <canvas> the size of the viewport, not one element per circle.
//
// Leaflet's stylesheet neutralises pointer-events for `.leaflet-pane > svg path`
// but has no equivalent rule for `.leaflet-pane > canvas`. With the pane left
// at the default (auto), that canvas won the browser hit test over the whole
// map, so a tap never reached the pin underneath — no details popup, no
// „Adaugă prieten”.
//
// It survived switching the layer OFF. Path.onRemove only calls
// renderer._removePath; Leaflet does not remove the renderer itself. The empty
// canvas stayed in the pane, and it is marked `_leaflet_disable_events`, so the
// map never even saw the click. Other analysis layers already set
// pointer-events:none on their viewport canvases (LIDAR Scanner, patrimoniu);
// this one did not, which is why the breakage was specific to this layer.
//
// Run: node test-archeo-detector-clicks.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'js/archeo-potential.js'), 'utf8');
const leafletCss = fs.readFileSync(path.join(__dirname, 'css/leaflet.css'), 'utf8');

let passed = 0;
function check(name, cond) {
    if (!cond) {
        console.error('✗ ' + name);
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log('✓ ' + name);
}

const MARKER_PANE_Z = 600;

check(
    '0. Leaflet CSS still does not neutralise `.leaflet-pane > canvas`',
    /\.leaflet-pane\s*>\s*svg\s+path\s*,/.test(leafletCss) &&
    !/\.leaflet-pane\s*>\s*canvas\s*\{[^}]*pointer-events\s*:\s*none/.test(leafletCss)
);

// Pull the pane table out of the source. The third slot is the pointer-events
// value written onto the pane.
const paneDefs = src.slice(src.indexOf('var PANE_DEFS = ['), src.indexOf('];', src.indexOf('var PANE_DEFS = [')));
function panePointer(name) {
    const row = paneDefs.match(new RegExp("\\['" + name + "',[^\\]]+\\]"));
    if (!row) return null;
    const events = row[0].match(/,\s*'([^']*)'\s*\]\s*$/);
    return events ? events[1] : null;
}
function paneZ(name) {
    const key = {
        pane_archeo: 'PANE_Z_INDEX',
        pane_archeo_heat: 'PANE_Z_HEAT',
        pane_archeo_mask: 'PANE_Z_MASK',
        pane_archeo_pin: 'PANE_Z_PIN'
    }[name];
    const m = src.match(new RegExp(key + ':\\s*(\\d+)'));
    return m ? Number(m[1]) : NaN;
}

check('1. pane_archeo still sits above the detectorist marker pane', paneZ('pane_archeo') > MARKER_PANE_Z);
check('1. pane_archeo is click-through', panePointer('pane_archeo') === 'none');
check('1. the mask and heat panes stay click-through too',
    panePointer('pane_archeo_mask') === 'none' && panePointer('pane_archeo_heat') === 'none');

check(
    '2. every L.canvas used by this layer is silenced on add',
    /function armClickThrough\(/.test(src) &&
    /canvas\.style\.pointerEvents = 'none'/.test(src) &&
    /renderer\.on\('add', silence\)/.test(src) &&
    /clickThroughCanvas\(map, 'pane_archeo'/.test(src)
);

check(
    '2. switching the layer OFF detaches the canvas renderers and drops leftovers',
    /if \(!_resultsVisible\) releaseArcheoCanvases\(map\)/.test(src) &&
    /detachRenderer\(map, _bubbleRenderer\)/.test(src) &&
    /detachRenderer\(map, _pinRenderer\)/.test(src) &&
    /dropLeftoverCanvases\(map, 'pane_archeo'\)/.test(src)
);

// Bubble popups must still open — but only from the map click, which Leaflet
// does not fire when the tap already landed on an interactive marker. That is
// what keeps a detectorist pin inside a bubble clickable.
const onMapClick = src.slice(src.indexOf('function onMapClick'), src.indexOf('function setPinMode'));
check(
    '3. a bubble under the tap opens its popup and does not relocate the pin',
    /openArcheoBubble\(bubbleUnderClick\(e\)/.test(onMapClick) &&
    /if \(openArcheoBubble\(bubbleUnderClick\(e\), e && e\.latlng\)\) return;/.test(onMapClick)
);
check(
    '3. the hit test skips non-interactive shapes and keeps the last (top) match',
    /interactive === false/.test(src.slice(src.indexOf('function bubbleUnderClick'), src.indexOf('function openArcheoBubble'))) &&
    /hit = layer/.test(src)
);
check(
    '3. the hit test is skipped while the results are hidden',
    /!_resultsVisible/.test(src.slice(src.indexOf('function bubbleUnderClick'), src.indexOf('function openArcheoBubble')))
);

// ── Browser hit-test model ────────────────────────────────────────────────
// Walk paint order from the top and stop at the first surface that accepts
// pointer events. Before the fix the archeo canvas won, both while the layer
// was on and after it was switched off (the canvas was never removed).

function topmostHit(surfaces) {
    return surfaces
        .filter(function (s) { return s.acceptsPointerEvents && s.coversPoint; })
        .sort(function (a, b) { return b.z - a.z; })[0];
}

const archeoZ = paneZ('pane_archeo');
const detectorist = { name: 'detectorist pin', z: MARKER_PANE_Z, coversPoint: true, acceptsPointerEvents: true };

function scene(canvasAccepts) {
    return [
        detectorist,
        {
            name: 'archeo renderer canvas',
            z: archeoZ,
            coversPoint: true, // viewport-sized: covers the pin even outside a bubble
            acceptsPointerEvents: canvasAccepts
        }
    ];
}

check(
    '4. with the layer ON, a tap on a detectorist pin inside the zone reaches the pin',
    topmostHit(scene(false)).name === 'detectorist pin'
);
check(
    '4. after the layer is switched OFF, the same pin stays clickable',
    topmostHit(scene(false)).name === 'detectorist pin'
);
check(
    '4. sanity: the old pointer-events-enabled canvas did swallow the pin',
    topmostHit(scene(true)).name === 'archeo renderer canvas'
);

// ── Behavioural: the running module really writes the pane and really drops
//    a leftover canvas when the layer is turned off. ─────────────────────────

const panes = {};
const added = [];
const map = {
    getCenter: function () { return { lat: 46.8, lng: 23.6 }; },
    getZoom: function () { return 13; },
    on: function () { return this; },
    off: function () { return this; },
    getPane: function (name) { return panes[name] || null; },
    createPane: function (name) {
        panes[name] = {
            name: name,
            children: [],
            style: {},
            appendChild: function (c) {
                this.children.push(c);
                c.parentNode = this;
                c.parentElement = this;
                return c;
            },
            removeChild: function (c) {
                const i = this.children.indexOf(c);
                if (i >= 0) this.children.splice(i, 1);
                c.parentNode = null;
                c.parentElement = null;
                return c;
            }
        };
        return panes[name];
    },
    addLayer: function (l) { added.push(l); if (l && l.onAdd) l.onAdd(this); return this; },
    removeLayer: function (l) {
        const i = added.indexOf(l);
        if (i >= 0) added.splice(i, 1);
        if (l && l.onRemove) l.onRemove(this);
        return this;
    },
    hasLayer: function (l) { return added.indexOf(l) !== -1; }
};

const fakeEl = function () {
    return {
        textContent: '', innerHTML: '', style: { display: '' }, disabled: false,
        checked: false, value: '10', min: '1', max: '10', dataset: {},
        classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
        addEventListener: function () {}, setAttribute: function () {}, getAttribute: function () { return null; }
    };
};
const ids = {};
['archeoPotRunBtn', 'archeoPotStatus', 'archeoPotSummary', 'archeoPotDistance', 'archeoPotDistanceValue',
    'archeoPotModeBubbles', 'archeoPotModeHeat', 'archeoPotLegendBubbles', 'archeoPotLegendHeat',
    'archeoPotHeatbar', 'archeoPotToggle', 'archeoPotentialRow'].forEach(function (id) { ids[id] = fakeEl(); });

const sandbox = {
    console: console,
    performance: { now: function () { return Date.now(); } },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    Math: Math,
    JSON: JSON,
    isFinite: isFinite,
    isNaN: isNaN,
    document: {
        readyState: 'complete',
        addEventListener: function () {},
        getElementById: function (id) { return ids[id] || null; },
        querySelectorAll: function () { return []; },
        createElement: function () { return { style: {}, getContext: function () { return null; } }; }
    },
    window: {},
    L: {
        layerGroup: function () { return { addLayer: function () { return this; }, addTo: function () { return this; } }; },
        // Leaflet adds a path's renderer to the map from Path.onAdd (getRenderer).
        // The stub has to do the same, or the viewport canvas never appears.
        circle: function (ll, opts) {
            return {
                options: opts || {},
                addTo: function (m) {
                    var renderer = this.options && this.options.renderer;
                    if (renderer && m && m.addLayer && (!m.hasLayer || !m.hasLayer(renderer))) m.addLayer(renderer);
                    return this;
                },
                bindPopup: function () { return this; },
                setLatLng: function () { return this; },
                setRadius: function () { return this; },
                setStyle: function () { return this; }
            };
        },
        circleMarker: function () { return {}; },
        polyline: function () { return {}; },
        canvas: function (opts) {
            const renderer = {
                options: opts || {},
                _container: null,
                _events: {},
                on: function (type, fn) { (this._events[type] = this._events[type] || []).push(fn); return this; },
                fire: function (type) { (this._events[type] || []).forEach(function (fn) { fn(); }); },
                onAdd: function () {
                    this._container = { tagName: 'canvas', style: { pointerEvents: 'auto' }, parentNode: panes.pane_archeo || null };
                    if (panes.pane_archeo) panes.pane_archeo.appendChild(this._container);
                    this.fire('add');
                },
                onRemove: function () {
                    const parent = this._container && this._container.parentNode;
                    if (parent && parent.removeChild) parent.removeChild(this._container);
                    this._container = null;
                }
            };
            return renderer;
        },
        marker: function () { return { addTo: function () { return this; }, bindTooltip: function () { return this; } }; },
        divIcon: function () { return {}; },
        latLng: function (a, b) { return { lat: a, lng: b }; }
    }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.L = sandbox.L;
sandbox.window._currentLang = function () { return 'en'; };
sandbox.window._dlMap = map;
sandbox.window._localLayerData = {};

vm.runInNewContext(src, sandbox, { filename: 'archeo-potential.js' });

sandbox.window.setArcheoPotentialPinMode(true);
check(
    '5. arming the layer writes pointer-events:none on pane_archeo',
    panes.pane_archeo && panes.pane_archeo.style.pointerEvents === 'none'
);

// Place a pin — that is what adds the viewport canvas (the search circle).
sandbox.window._archeoPotSetPoint(46.8, 23.6);
const canvas = panes.pane_archeo && panes.pane_archeo.children.filter(function (n) { return n.tagName === 'canvas'; })[0];
check('5. placing the pin adds a canvas above the markers', !!canvas);
check('5. that canvas is itself click-through, not only the pane',
    canvas && canvas.style.pointerEvents === 'none');

sandbox.window.toggleArcheoPotentialLayer(false);
check(
    '5. switching the layer OFF removes the canvas, so detectorist pins receive taps again',
    !panes.pane_archeo.children.some(function (n) { return n.tagName === 'canvas'; })
);

// A canvas Leaflet failed to detach (the historical bug) must still be dropped.
const orphan = { tagName: 'canvas', style: { pointerEvents: 'auto' }, parentNode: null, parentElement: null };
panes.pane_archeo.appendChild(orphan);
sandbox.window._archeoPotentialDebug.releaseArcheoCanvases(map);
check(
    '5. an orphaned archeo canvas left after toggle-off is removed and silenced',
    orphan.parentNode == null && orphan.style.pointerEvents === 'none'
);

console.log('\n' + passed + ' checks passed.');
if (process.exitCode) console.error('SOME CHECKS FAILED');
