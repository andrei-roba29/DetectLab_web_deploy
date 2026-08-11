// Test suite for js/lidar-scanner.js
// Usage: node test-lidar-scanner.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let addedLayers = [];
let removedLayers = [];
let mapEventListeners = {};

const mockMap = {
    addLayer(l) { addedLayers.push(l); return this; },
    removeLayer(l) { removedLayers.push(l); return this; },
    on(evt, fn) { mapEventListeners[evt] = fn; return this; },
    off(evt, fn) { delete mapEventListeners[evt]; return this; },
    fitBounds() {},
    createPane() { return { style: {} }; },
    getPane() { return { style: {} }; }
};

const domElements = {
    lidarScannerToggle: { checked: false, listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    lidarScannerDistance: { value: '10', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    lidarScannerDistanceValue: { textContent: '' },
    lidarScannerRun: { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
    lidarScannerStatus: { textContent: '' },
    lidarScannerRow: {
        classList: {
            toggle(cls, val) { this[cls] = val; }
        }
    },
    lidarScannerLoading: {
        classList: {
            add() {},
            remove() {}
        }
    }
};

const mockL = {
    circle(latlng, opts) {
        return {
            type: 'circle',
            latlng,
            options: opts,
            bindTooltip() { return this; },
            bindPopup() { return this; },
            setRadius(r) { this.options.radius = r; },
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    circleMarker(latlng, opts) {
        return {
            type: 'circleMarker',
            latlng,
            options: opts,
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    marker(latlng, opts) {
        return {
            type: 'marker',
            latlng,
            options: opts,
            bindTooltip(html, topts) { this._tooltip = html; this._tooltipOpts = topts; return this; },
            bindPopup(html) { this._popup = html; return this; },
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    divIcon(opts) {
        return {
            type: 'divIcon',
            options: opts
        };
    },
    layerGroup() {
        const layers = [];
        return {
            addLayer(l) { layers.push(l); },
            clearLayers() { layers.length = 0; },
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    latLngBounds(arr) {
        return {
            pad() { return this; }
        };
    }
};

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    JSON,
    isFinite,
    parseFloat,
    parseInt,
    document: {
        readyState: 'complete',
        addEventListener() {},
        getElementById(id) { return domElements[id] || null; }
    },
    window: {
        _dlMap: mockMap,
        _localLayerData: {}
    },
    L: mockL,
    LidarGeo: {
        load_points: () => [],
        scan: () => []
    },
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve('id,X,Y,Z,category,name\n1,3900000,1800000,4700000,Fort,Test') })
};

sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.L = sandbox.L;

const scriptCode = fs.readFileSync(path.join(__dirname, 'js/lidar-scanner.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(scriptCode, sandbox);

console.log('[Test] Running LIDAR Scanner search point selection tests...');

// 1. Activate scanner
assert(typeof sandbox.window.toggleLidarScannerLayer === 'function', 'toggleLidarScannerLayer should be exposed');
sandbox.window.toggleLidarScannerLayer(true);
assert(mapEventListeners['click'], 'map click listener should be registered when active');

// 2. Click map to choose a search point
addedLayers = [];
mapEventListeners['click']({ latlng: { lat: 45.75, lng: 21.22 } });

assert(addedLayers.length >= 2, 'Search marker and search circle should be added to map');
const marker = addedLayers.find(l => l.type === 'marker');
const circle = addedLayers.find(l => l.type === 'circle');

assert(marker, 'Marker should be placed at search point');
assert(circle, 'Selection circle should be placed around search point');

// Check neon green marker styling
assert(marker.options.icon, 'Marker should use custom divIcon');
assert(marker.options.icon.options.className.includes('lidar-search-marker-wrapper'), 'divIcon class should be lidar-search-marker-wrapper');
assert(marker.options.icon.options.html.includes('lidar-search-dot'), 'divIcon HTML should include neon green lidar-search-dot');
assert(marker.options.icon.options.html.includes('lidar-search-pulse'), 'divIcon HTML should include neon green lidar-search-pulse');
assert(marker._tooltip.includes('Search Point / Punct căutare') || marker._tooltip.includes('Punct'), 'Marker should have search point tooltip');

// Check neon green circle styling
assert(circle.options.color === '#8cff66', 'Circle stroke should be neon green #8cff66');
assert(circle.options.fillColor === '#39ff14', 'Circle fill should be neon green #39ff14');

// 3. Update distance slider
domElements.lidarScannerDistance.value = '25';
domElements.lidarScannerDistance.listeners['input'].call(domElements.lidarScannerDistance);
assert.strictEqual(circle.options.radius, 25000, 'Selection circle radius should update to 25km');

// 4. Deactivate scanner
sandbox.window.toggleLidarScannerLayer(false);
assert(!mapEventListeners['click'], 'Map click listener should be removed when deactivated');
assert(removedLayers.includes(marker), 'Selected marker should be removed when layer turned off');
assert(removedLayers.includes(circle), 'Selection circle should be removed when layer turned off');

console.log('✅ ALL LIDAR SCANNER TESTS PASSED');
