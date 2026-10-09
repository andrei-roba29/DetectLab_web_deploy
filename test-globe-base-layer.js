// Regression suite for the permanent MapLibre 3D globe basemap.
// Run: node test-globe-base-layer.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const mapApp = fs.readFileSync(path.join(root, 'js/map-app.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'js/globe-base-layer.js'), 'utf8');

console.log('[Test] Permanent 3D globe basemap...');

// ── Page assets + load order ──────────────────────────────────────────────
assert(html.includes('css/maplibre-gl.css?v=5.24.0'), 'MapLibre CSS is loaded locally');
assert(html.includes('css/globe-base-layer.css?v=20261009-3d-globe'), 'globe base CSS is loaded');
assert(html.includes('js/maplibre-gl.js?v=5.24.0'), 'MapLibre GL JS is loaded locally');
assert(html.includes('js/leaflet-maplibre-gl.js?v=0.1.4'), 'Leaflet/MapLibre adapter is loaded');
assert(html.includes('js/globe-base-layer.js?v=20261009-lidar-globe-twin'), 'globe base module is loaded');
assert(html.indexOf('js/leaflet.js') < html.indexOf('js/maplibre-gl.js?v=5.24.0'), 'Leaflet loads before the GL runtime');
assert(html.indexOf('js/maplibre-gl.js?v=5.24.0') < html.indexOf('js/leaflet-maplibre-gl.js?v=0.1.4'), 'GL runtime loads before its adapter');
assert(html.indexOf('js/leaflet-maplibre-gl.js?v=0.1.4') < html.indexOf('js/globe-base-layer.js?v=20261009-lidar-globe-twin'), 'adapter loads before the base module');
assert(html.indexOf('js/globe-base-layer.js?v=20261009-lidar-globe-twin') < html.indexOf('js/map-app.js?v=20261009-lidar-globe-twin'), 'base module loads before map-app');

[
    'css/maplibre-gl.css?v=5.24.0',
    'css/globe-base-layer.css?v=20261009-3d-globe',
    'js/maplibre-gl.js?v=5.24.0',
    'js/leaflet-maplibre-gl.js?v=0.1.4',
    'js/globe-base-layer.js?v=20261009-lidar-globe-twin',
    'js/map-app.js?v=20261009-lidar-globe-twin',
    'js/offline-maps.js?v=20261009-3d-globe',
    'js/country-dock.js?v=20261009-3d-globe',
    'js/translations.js?v=20261009-3d-globe'
].forEach((asset) => assert(sw.includes("'" + asset + "'"), 'service worker precaches ' + asset));
assert(Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]) >= 174, 'service worker shell is v174+');

// ── Map integration invariants ────────────────────────────────────────────
assert(/DetectLabGlobeBase\.create\(map/.test(mapApp), 'map-app creates the 3D basemap');
assert(/window\._satLayer\s*=\s*satelliteLayer/.test(mapApp), 'existing satellite API points at the active base layer');
assert(/if \(!satelliteLayer\)[\s\S]*?L\.tileLayer\(SATELLITE_IMAGERY_URL/.test(mapApp), 'WebGL failure keeps a Leaflet raster fallback');
assert(/Globul 3D rămâne singura bază/.test(mapApp), 'history slider keeps the globe as permanent basemap');
assert(!/map\.removeLayer\(satelliteLayer\)/.test(mapApp), 'history slider never removes the globe base');

// ── Module behavior with tiny Leaflet/MapLibre stubs ───────────────────────
const events = Object.create(null);
const glMap = {
    _loaded: false,
    _layers: Object.create(null),
    paintCalls: [],
    isStyleLoaded() { return this._loaded; },
    getLayer(id) { return this._layers[id] || null; },
    setPaintProperty(layerId, property, value) { this.paintCalls.push({ layerId, property, value }); },
    once(type, callback) {
        if (this._loaded && type === 'load') callback();
        else (events[type] = events[type] || []).push(callback);
    },
    on(type, callback) { (events[type] = events[type] || []).push(callback); },
    emit(type) {
        if (type === 'load') this._loaded = true;
        const callbacks = (events[type] || []).splice(0);
        callbacks.forEach((callback) => callback());
    }
};

let capturedOptions = null;
const leafletLayer = {
    options: {},
    _glMap: glMap,
    onAdd() { this._addCount = (this._addCount || 0) + 1; },
    addTo(map) {
        map.addLayer(this);
        this.onAdd(map);
        return this;
    },
    getMaplibreMap() { return this._glMap; }
};
const fakeLeaflet = {
    maplibreGL(options) { capturedOptions = options; return leafletLayer; }
};
const fakeMap = {
    layers: [],
    addLayer(layer) { if (!this.hasLayer(layer)) this.layers.push(layer); return this; },
    removeLayer(layer) { this.layers = this.layers.filter((candidate) => candidate !== layer); return this; },
    hasLayer(layer) { return this.layers.includes(layer); }
};
const sandbox = {
    console,
    isFinite,
    window: {
        L: fakeLeaflet,
        maplibregl: { Map: function Map() {}, supported() { return true; } }
    }
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'globe-base-layer.js' });

const base = sandbox.window.DetectLabGlobeBase;
assert(base && typeof base.create === 'function', 'DetectLabGlobeBase.create is exported');
assert.equal(base.isSupported(), true, 'WebGL-supported runtimes are accepted');
const layer = base.create(fakeMap, { pane: 'pane_satellite', opacity: 0.9, maxNativeZoom: 18 });
assert.equal(layer, leafletLayer, 'the real Leaflet-compatible layer is returned');
assert(fakeMap.hasLayer(layer), 'the globe layer is added to the existing Leaflet map');
assert.equal(capturedOptions.pane, 'pane_satellite', 'globe uses the basemap pane');
assert.equal(capturedOptions.interactive, false, 'Leaflet remains the only interaction surface');
assert.equal(capturedOptions.style.projection.type, 'globe', 'style requests a native globe projection');
assert.equal(capturedOptions.style.sources.detectlab.type, 'raster', 'Esri imagery is a raster globe source');
assert.equal(capturedOptions.style.sources.detectlab.maxzoom, 18, 'Esri source is capped at its native zoom');
assert.match(capturedOptions.style.sources.detectlab.tiles[0], /World_Imagery\/MapServer\/tile/);
assert.equal(capturedOptions.style.layers.filter((entry) => entry.type === 'raster').length, 1,
    'the base style contains one imagery raster layer');

layer.setOpacity(0.35); // called before MapLibre's initial style load
assert.equal(layer.options.opacity, 0.35, 'opacity is stored on the Leaflet-compatible layer');
glMap._layers[base.constants.rasterLayerId] = { id: base.constants.rasterLayerId };
glMap.emit('load');
assert(glMap.paintCalls.some((call) => call.layerId === base.constants.rasterLayerId &&
    call.property === 'raster-opacity' && call.value === 0.35), 'pending opacity is applied when the style loads');
layer.setOpacity(2);
assert.equal(glMap.paintCalls.at(-1).value, 1, 'opacity is clamped to 1');
layer.setOpacity(-1);
assert.equal(glMap.paintCalls.at(-1).value, 0, 'opacity is clamped to 0');

sandbox.window.maplibregl.supported = function () { return false; };
assert.equal(base.isSupported(), false, 'unsupported WebGL is detected for fallback');
assert.equal(base.create({ addLayer() {} }, {}), null, 'unsupported WebGL does not create a broken map layer');

console.log('  ✓ local assets, globe style, Leaflet integration, opacity and fallback verified');
console.log('All 3D globe basemap tests passed.');
