// Integration tests for js/lidar-geo.js and js/lidar-scanner.js
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
    addLayer(layer) { addedLayers.push(layer); return this; },
    removeLayer(layer) { removedLayers.push(layer); return this; },
    on(event, fn) { mapEventListeners[event] = fn; return this; },
    off(event) { delete mapEventListeners[event]; return this; },
    fitBounds() {},
    createPane() { return { style: {} }; },
    getPane() { return { style: {} }; }
};

const domElements = {
    lidarScannerToggle: { checked: false, listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } },
    lidarScannerDistance: { value: '10', listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } },
    lidarScannerDistanceValue: { textContent: '' },
    lidarScannerRun: { listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; } },
    lidarScannerStatus: { textContent: '' },
    lidarScannerRow: {
        classList: {
            toggle(cls, value) { this[cls] = value; }
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
    circle(latlng, options) {
        return {
            type: 'circle',
            latlng,
            options,
            bindTooltip(html, tooltipOptions) { this._tooltip = html; this._tooltipOpts = tooltipOptions; return this; },
            bindPopup(html) { this._popup = html; return this; },
            setRadius(radius) { this.options.radius = radius; },
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    marker(latlng, options) {
        return {
            type: 'marker',
            latlng,
            options,
            bindTooltip(html, tooltipOptions) { this._tooltip = html; this._tooltipOpts = tooltipOptions; return this; },
            bindPopup(html) { this._popup = html; return this; },
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    divIcon(options) {
        return { type: 'divIcon', options };
    },
    layerGroup() {
        const layers = [];
        return {
            type: 'layerGroup',
            layers,
            addLayer(layer) { layers.push(layer); },
            clearLayers() { layers.length = 0; },
            addTo(map) { map.addLayer(this); return this; }
        };
    },
    latLngBounds() {
        return { pad() { return this; } };
    }
};

// Load the real geographic helper first so the test exercises Romanian CSV
// parsing all the way through normalization and radius scanning.
const geoWindow = {};
const geoSandbox = {
    window: geoWindow,
    Math,
    Object,
    Array,
    String,
    parseFloat,
    isFinite
};
vm.createContext(geoSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/lidar-geo.js'), 'utf8'), geoSandbox);
const lidarGeo = geoWindow.LidarGeo;

const csvText = fs.readFileSync(path.join(__dirname, 'data/lidar_scanner_points.csv'), 'utf8');
const sandbox = {
    console,
    // Run the cosmetic five-second scan delay immediately in tests.
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
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
    LidarGeo: lidarGeo,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(csvText) })
};

sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.L = sandbox.L;
sandbox.window.LidarGeo = lidarGeo;

const scriptCode = fs.readFileSync(path.join(__dirname, 'js/lidar-scanner.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(scriptCode, sandbox);

async function main() {
    console.log('[Test] Running LIDAR Scanner CSV and search point tests...');

    // Geographic helper accepts direct Romanian and English aliases.
    const aliasPoint = lidarGeo.load_points([{ Latitudine: '45,5', Longitudine: '22,25' }])[0];
    assert.strictEqual(aliasPoint.lat, 45.5, 'Romanian latitude alias should be accepted');
    assert.strictEqual(aliasPoint.lon, 22.25, 'Romanian longitude alias should be accepted');
    assert.strictEqual(aliasPoint.lng, 22.25, 'Leaflet lng alias should be populated');
    const englishPoint = lidarGeo.load_points([{ latitude: 46, longitude: 23 }])[0];
    assert.strictEqual(englishPoint.lat, 46, 'English latitude/longitude should remain supported');
    const legacyEcefPoint = lidarGeo.load_points([{ X: 6378137, Y: 0, Z: 0 }])[0];
    assert(Math.abs(legacyEcefPoint.lat) < 1e-10, 'legacy ECEF X/Y/Z should still convert to latitude');
    assert(Math.abs(legacyEcefPoint.lon) < 1e-10, 'legacy ECEF X/Y/Z should still convert to longitude');
    assert.throws(
        () => lidarGeo.load_points([{ category: 'missing coordinates' }]),
        /latitude\/longitude/,
        'A CSV without a supported coordinate pair should have a useful error'
    );

    // 1. Activate scanner and wait for the real CSV fetch/parse pipeline.
    assert(typeof sandbox.window.toggleLidarScannerLayer === 'function', 'toggleLidarScannerLayer should be exposed');
    sandbox.window.toggleLidarScannerLayer(true);
    await new Promise(resolve => setImmediate(resolve));
    assert(mapEventListeners.click, 'map click listener should be registered when active');
    assert.match(domElements.lidarScannerStatus.textContent, /^5 points loaded/, 'all five Romanian CSV rows should load');

    // 2. Click directly on the first CSV point.
    addedLayers = [];
    mapEventListeners.click({ latlng: { lat: 44.680496658, lng: 22.532812357 } });

    assert(addedLayers.length >= 2, 'search marker and search circle should be added to map');
    const marker = addedLayers.find(layer => layer.type === 'marker');
    const circle = addedLayers.find(layer => layer.type === 'circle');

    assert(marker, 'marker should be placed at search point');
    assert(circle, 'selection circle should be placed around search point');
    assert(marker.options.icon, 'marker should use custom divIcon');
    assert(marker.options.icon.options.className.includes('lidar-search-marker-wrapper'), 'divIcon should use the scanner wrapper class');
    assert(marker.options.icon.options.html.includes('lidar-search-dot'), 'divIcon should include the neon green dot');
    assert(marker.options.icon.options.html.includes('lidar-search-pulse'), 'divIcon should include the neon green pulse');
    assert(marker._tooltip.includes('Search Point / Punct căutare'), 'marker should have a bilingual search point tooltip');
    assert.strictEqual(circle.options.color, '#8cff66', 'circle stroke should be neon green');
    assert.strictEqual(circle.options.fillColor, '#39ff14', 'circle fill should be neon green');

    // 3. A 10 km scan at the first coordinate returns that CSV site and its
    // Romanian category, proving no X/Y/Z conversion is attempted.
    domElements.lidarScannerRun.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    const resultGroup = addedLayers.find(layer => layer.type === 'layerGroup');
    assert(resultGroup, 'scan results layer should be added to the map');
    assert.strictEqual(resultGroup.layers.length, 1, '10 km scan should find the first CSV site');
    assert(resultGroup.layers[0]._tooltip.includes('fortificație'), 'Romanian category should be displayed');
    assert.deepStrictEqual(
        Array.from(resultGroup.layers[0].latlng),
        [44.680496658, 22.532812357],
        'result should use WGS 84 latitude/longitude directly'
    );

    // 4. Update distance slider.
    domElements.lidarScannerDistance.value = '25';
    domElements.lidarScannerDistance.listeners.input.call(domElements.lidarScannerDistance);
    assert.strictEqual(circle.options.radius, 25000, 'selection circle radius should update to 25 km');

    // 5. Deactivate scanner.
    sandbox.window.toggleLidarScannerLayer(false);
    assert(!mapEventListeners.click, 'map click listener should be removed when deactivated');
    assert(removedLayers.includes(marker), 'selected marker should be removed when layer is turned off');
    assert(removedLayers.includes(circle), 'selection circle should be removed when layer is turned off');

    console.log('✅ ALL LIDAR SCANNER TESTS PASSED');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
