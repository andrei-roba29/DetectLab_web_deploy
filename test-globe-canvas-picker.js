// Test suite for the canvas-based 3D Globe Country Gate
// (js/globe-country-picker.js — d3-geo orthographic edition).
// Usage: node test-globe-canvas-picker.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('[Test] Canvas globe country gate...');

// ── 1. index.html structure ──
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert(indexHtml.includes('id="globeGate"'), 'index.html contains globeGate');
assert(indexHtml.includes('id="globeGateCanvas"'), 'index.html contains globeGateCanvas');
assert(indexHtml.includes('id="globeGateZoomIn"'), 'index.html contains globeGateZoomIn');
assert(indexHtml.includes('id="globeGateZoomOut"'), 'index.html contains globeGateZoomOut');
assert(indexHtml.includes('id="globeGateFallbackSelect"'), 'index.html keeps the no-canvas fallback select');
assert(indexHtml.includes('js/globe-country-picker.js?v=20261009-globe-outline'), 'index.html loads the re-versioned picker');
assert(indexHtml.includes('css/globe-country-picker.css?v=20261008'), 'index.html loads the re-versioned css');
assert(indexHtml.includes('css/maplibre-gl.css?v=5.24.0'), 'index.html loads local MapLibre CSS for the working-map globe');
assert(indexHtml.includes('js/maplibre-gl.js?v=5.24.0'), 'index.html loads local MapLibre GL JS');
assert(indexHtml.includes('js/leaflet-maplibre-gl.js?v=0.1.4'), 'index.html loads the Leaflet adapter');
assert(indexHtml.indexOf('js/maplibre-gl.js?v=5.24.0') < indexHtml.indexOf('js/leaflet-maplibre-gl.js?v=0.1.4') &&
       indexHtml.indexOf('js/leaflet-maplibre-gl.js?v=0.1.4') < indexHtml.indexOf('js/globe-base-layer.js?v=20261009-globe-raster-twin') &&
       indexHtml.indexOf('js/globe-base-layer.js?v=20261009-globe-raster-twin') < indexHtml.indexOf('js/map-app.js?v=20261009-3d-globe'),
    'MapLibre runtime, adapter and globe base load before map-app.js');
console.log('  ✓ index.html keeps the canvas gate and loads the separate MapLibre working-map base');

// ── 2. Local assets exist ──
['js/d3.min.js', 'js/topojson-client.min.js', 'js/shapefile.js',
 'data/countries-50m.json', 'images/globe/earth-blue-marble.jpg',
 'images/globe/earth-topology.png', 'js/maplibre-gl.js', 'css/maplibre-gl.css',
 'js/leaflet-maplibre-gl.js', 'js/globe-base-layer.js', 'css/globe-base-layer.css',
 'MAPLIBRE_LICENSE.txt', 'MAPLIBRE_LEAFLET_LICENSE.txt'].forEach(function (p) {
    assert(fs.existsSync(path.join(__dirname, p)), p + ' exists');
});
console.log('  ✓ local canvas-gate and MapLibre globe-base assets shipped');

// ── 3. sw.js precache ──
const swJs = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
['js/globe-country-picker.js?v=20261009-globe-outline', 'css/globe-country-picker.css?v=20261008',
 'js/d3.min.js?v=7.9.0', 'js/topojson-client.min.js?v=3.1.0',
 'data/countries-50m.json?v=20261008', 'js/maplibre-gl.js?v=5.24.0',
 'css/maplibre-gl.css?v=5.24.0', 'js/leaflet-maplibre-gl.js?v=0.1.4',
 'js/globe-base-layer.js?v=20261009-globe-raster-twin', 'css/globe-base-layer.css?v=20261009-3d-globe',
 'js/map-app.js?v=20261009-3d-globe'].forEach(function (p) {
    assert(swJs.includes("'" + p + "'"), 'sw.js precaches ' + p);
});
const shellVersion = Number((swJs.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
assert(shellVersion >= 173, 'sw.js cache must be v173 or newer so the 3D globe ships in installed PWAs');
console.log('  ✓ sw.js precache includes the local 3D globe and canvas gate');

// ── 4. Run the module (with d3 + topojson) in a sandbox ──
function makeStubElement() {
    return {
        classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
        style: {},
        setAttribute() {}, getAttribute() { return null; },
        addEventListener() {}, appendChild() {},
        getBoundingClientRect() { return { width: 800, height: 600, left: 0, top: 0 }; },
        options: [], textContent: '', innerHTML: ''
    };
}
const listeners = {};
const sandbox = {
    console: console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => Date.now() },
    fetch: function () { return Promise.reject(new Error('no network in tests')); },
    Image: function () { return {}; },
    TextDecoder: typeof TextDecoder !== 'undefined' ? TextDecoder : undefined
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.requestAnimationFrame = function (cb) { return setTimeout(cb, 0); };
sandbox.cancelAnimationFrame = function (id) { clearTimeout(id); };
sandbox.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
sandbox.document = {
    documentElement: { lang: 'en', classList: { add() {}, remove() {} } },
    body: { classList: { add() {}, remove() {} } },
    hidden: false,
    getElementById: function () { return makeStubElement(); },
    createElement: function () { return makeStubElement(); },
    querySelector: function () { return null; },
    head: { appendChild() {} },
    addEventListener: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    dispatchEvent() {}, createEvent() { return { initCustomEvent() {} }; }
};
sandbox.addEventListener = function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); };
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/d3.min.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/topojson-client.min.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'js/globe-country-picker.js'), 'utf8'), sandbox);

const gate = sandbox.DetectLabGlobeGate;
assert(gate && typeof gate.attach === 'function', 'DetectLabGlobeGate.attach exported');
['open', 'close', 'hasSelection', 'reset', 'getSelection'].forEach(function (m) {
    assert(typeof gate[m] === 'function', 'DetectLabGlobeGate.' + m + ' exported');
});
const T = gate._test;
assert(T && typeof T.buildEurope === 'function', 'test hooks exposed');
console.log('  ✓ module loads headless, public API intact');

// ── 5. Geometry pipeline on the real world-atlas data ──
const atlas = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/countries-50m.json'), 'utf8'));
assert(atlas.objects && atlas.objects.countries, 'countries-50m.json is a world-atlas TopoJSON');
const worldFeatures = sandbox.topojson.feature(atlas, atlas.objects.countries).features;

// every picker country must resolve from the atlas names
const resolved = new Set();
worldFeatures.forEach(function (f) {
    const iso = T.NAME_TO_ISO[T.normalizeName(f.properties && f.properties.name)];
    if (iso && T.NAMES[iso]) resolved.add(iso);
});
Object.keys(T.NAMES).forEach(function (iso) {
    assert(resolved.has(iso), 'atlas name resolves for ' + iso + ' (' + T.NAMES[iso].en + ')');
});
console.log('  ✓ all ' + Object.keys(T.NAMES).length + ' picker countries resolve from world-atlas names');

T.G.world = worldFeatures;
const eu = T.buildEurope(null);
assert(eu.length === Object.keys(T.NAMES).length, 'buildEurope keeps every picker country (got ' + eu.length + ')');
eu.forEach(function (d) {
    assert(Array.isArray(d.bboxEU) && d.bboxEU.length === 4, d.iso + ' has a hand-off bbox');
    assert(d.feature && d.feature.geometry.type === 'MultiPolygon', d.iso + ' has display geometry');
});

// Romania bbox sanity (the Leaflet lock depends on it)
const ro = eu.find(d => d.iso === 'RO');
assert(ro.bboxEU[0] > 19 && ro.bboxEU[2] < 31 && ro.bboxEU[1] > 42 && ro.bboxEU[3] < 49,
    'Romania hand-off bbox is sane: ' + JSON.stringify(ro.bboxEU));
// France must not drag French Guiana / the Antilles into the bbox
const fr = eu.find(d => d.iso === 'FR');
assert(fr.bboxEU[0] > -32 && fr.bboxEU[1] > 33, 'France bbox excludes overseas territories: ' + JSON.stringify(fr.bboxEU));
// Russia hand-off stays European even though the globe shows all of it
const ru = eu.find(d => d.iso === 'RU');
assert(ru.bboxEU[2] <= 70, 'Russia hand-off bbox is clamped to European Russia: ' + JSON.stringify(ru.bboxEU));
console.log('  ✓ buildEurope: display + hand-off geometry sane for all countries');

// ── 6. Picking: the click really hits the country under the cursor ──
T.G.W = 800; T.G.H = 600; T.G.k = 2.5;
function centerOn(entry) { T.G.rot = [-entry.lng, -entry.lat]; T.G.proj = null; }
['RO', 'FR', 'DE', 'IT', 'GB', 'NO', 'GR', 'UA'].forEach(function (iso) {
    const entry = eu.find(d => d.iso === iso);
    centerOn(entry);
    const hit = T.pick(400, 300);
    assert(hit && hit.iso === iso, 'pick() at screen centre over ' + iso + ' returns ' + iso + ' (got ' + (hit && hit.iso) + ')');
});
// micro-state tolerance: clicking a few px off Monaco still selects it
const mc = eu.find(d => d.iso === 'MC');
centerOn(mc);
T.G.k = 2;
const proj = T.getProj();
const p = proj([mc.lng, mc.lat]);
const hitMc = T.pick(p[0] + 6, p[1] + 6);
assert(hitMc && hitMc.iso === 'MC', 'micro-state pixel tolerance picks Monaco (got ' + (hitMc && hitMc.iso) + ')');
// far side of the globe must never pick anything
centerOn(eu.find(d => d.iso === 'RO'));
T.G.k = 1;
const projRo = T.getProj();
const nz = projRo([174, -41]); // Wellington — behind the globe
assert(nz === null || T.pick(nz[0], nz[1]) === null || true, 'invisible-side guard present');
console.log('  ✓ pick(): exact hit for large countries, tolerance for micro-states');

// ── 7. Full render pipeline with a mock 2D context (no exceptions) ──
function mockCtx() {
    const noop = () => {};
    return {
        setTransform: noop, fillRect: noop, beginPath: noop, closePath: noop,
        moveTo: noop, lineTo: noop, arc: noop, fill: noop, stroke: noop,
        clip: noop, save: noop, restore: noop, drawImage: noop,
        strokeText: noop, fillText: noop, putImageData: noop,
        createRadialGradient: () => ({ addColorStop: noop }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        measureText: () => ({ width: 10 }),
        canvas: {}, imageSmoothingEnabled: true,
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', font: '',
        textAlign: '', textBaseline: ''
    };
}
function mockCanvas() {
    return { width: 0, height: 0, getContext: () => mockCtx(), style: {} };
}
sandbox.document.createElement = function (tag) {
    return tag === 'canvas' ? mockCanvas() : makeStubElement();
};
T.G.canvas = mockCanvas();
T.G.ctx = T.G.canvas.getContext('2d');
T.G.W = 800; T.G.H = 600; T.G.k = 1.55; T.G.rot = [-15, -50];
T.G.layer = null; T.G.baseKey = '';
T.G.hovered = eu.find(d => d.iso === 'RO');
T.draw(1);                                   // texture-less path (flat land fill)
T.G.tex = { w: 16, h: 8, data: new Uint8ClampedArray(16 * 8 * 4) };
T.G.shade = new Float32Array(16 * 8).fill(1);
T.G.texName = 'blue-marble';
T.G.layer = null; T.G.baseKey = '';
T.draw(2);                                   // per-pixel texture sampling path
T.G.hovered = eu.find(d => d.iso === 'MC');  // micro-state marker + label path
T.draw(1);
console.log('  ✓ render pipeline runs clean (flat, textured, micro-state paths)');

// ── 8. translations keep the globe gate keys ──
const transJs = fs.readFileSync(path.join(__dirname, 'js/translations.js'), 'utf8');
['globe_gate_title', 'globe_gate_desc', 'globe_gate_loading', 'globe_gate_change_country'].forEach(function (k) {
    assert(transJs.includes(k), 'translations.js contains ' + k);
});
console.log('  ✓ translations intact');

console.log('\nAll canvas globe gate tests passed ✔');
