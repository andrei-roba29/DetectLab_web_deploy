// Regression suite for the globe twins of Leaflet raster overlays.
// A Leaflet tile or WMS layer gets a MapLibre raster twin on the globe camera
// (same pane, same URLs). These tests check the URL conversion against
// Leaflet's own request format, the attach/detach/opacity/redraw hooks, the zoom
// limits, and the fallback when a layer cannot be reproduced exactly. The
// stand-ins follow Leaflet 1.9.4: WMS needs an L.point and a map, {z} comes from
// _tileZoom, and visibility uses Math.round(zoom). The real alignment check is
// in the browser harness; this file covers the logic.
// Run: node test-globe-raster-twin.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const source = fs.readFileSync(path.join(root, 'js/globe-base-layer.js'), 'utf8');
const HALF = 20037508.342789244;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

console.log('[Test] Globe twins for Leaflet raster overlays...');

// ── Leaflet-shaped stand-ins ──────────────────────────────────────────────
class FakePoint {
    constructor(x, y) { this.x = x; this.y = y; }
    scaleBy(p) { return new FakePoint(this.x * p.x, this.y * p.y); }
    add(p) { return new FakePoint(this.x + p.x, this.y + p.y); }
}

// The MapLibre adapter: the globe layer that create() wraps.
const glPaints = [];
class FakeAdapter {
    constructor(options) {
        this.options = Object.assign({ opacity: 1 }, options);
        this._zooming = false;
        this._map = null;
        this.glMap = {
            paint: glPaints,
            isStyleLoaded() { return true; },
            once(type, fn) { if (type === 'load') fn(); },
            on() {},
            getLayer(id) { return { id }; },
            setPaintProperty(layer, prop, value) { this.paint.push({ layer, prop, value, adapter: this.owner }); },
            owner: this
        };
    }
    getEvents() { return { move: this._throttledUpdate }; }
    _update() {}
    _throttledUpdate() {}
    addTo(map) { map.addLayer(this); return this; }
    onAdd(map) { this._map = map; }
    onRemove(map) { this._map = null; }
    getMaplibreMap() { return this.glMap; }
    setOpacity(value) { this.options.opacity = value; return this; }
}

class FakeMap {
    constructor() { this.layers = []; }
    addLayer(layer) { if (!this.hasLayer(layer)) this.layers.push(layer); if (layer.onAdd) layer.onAdd(this); return this; }
    removeLayer(layer) { this.layers = this.layers.filter((l) => l !== layer); if (layer.onRemove) layer.onRemove(this); return this; }
    hasLayer(layer) { return this.layers.includes(layer); }
}

// Leaflet's Util.template: {key} placeholders filled from data (options override data).
function template(str, data) {
    return str.replace(/\{ *([\w_ -]+) *\}/g, (match, key) => {
        if (data[key] === undefined) throw new Error('No value provided for variable ' + key);
        return String(data[key]);
    });
}

// Leaflet's TileLayer: {s} from (x + y) over the subdomains, {z} from _tileZoom.
function FakeTileLayer(url, options) {
    this._url = url;
    this.options = Object.assign({ tileSize: 256, opacity: 1, pane: 'pane_twin_test', subdomains: 'ab', zoomOffset: 0 }, options);
    this._map = null;
    this._container = { style: { display: '' } };
    this.redrawCount = 0;
}
FakeTileLayer.prototype._getZoomForUrl = function () { return this._tileZoom + this.options.zoomOffset; };
FakeTileLayer.prototype._getSubdomain = function (c) {
    const subs = this.options.subdomains;
    return subs[Math.abs(c.x + c.y) % subs.length];
};
FakeTileLayer.prototype.getTileUrl = function (c) {
    const data = { r: '', s: this._getSubdomain(c), x: c.x, y: c.y, z: this._getZoomForUrl() };
    return template(this._url, Object.assign({}, data, this.options));
};
FakeTileLayer.prototype.getContainer = function () { return this._container; };
FakeTileLayer.prototype.onAdd = function (map) { this._map = map; return this; };
FakeTileLayer.prototype.onRemove = function (map) { this._map = null; return this; };
FakeTileLayer.prototype.setOpacity = function (value) { this.options.opacity = value; return this; };
FakeTileLayer.prototype.redraw = function () { this.redrawCount += 1; return this; };

// Leaflet's getParamString (TileLayer.WMS).
function getParamString(obj, existingUrl, uppercase) {
    const params = [];
    for (const i in obj) params.push(encodeURIComponent(uppercase ? i.toUpperCase() : i) + '=' + encodeURIComponent(obj[i]));
    return ((!existingUrl || existingUrl.indexOf('?') === -1) ? '?' : '&') + params.join('&');
}

// Leaflet's TileLayer.WMS: needs the layer's map and an L.point (scaleBy) for _tileCoordsToNwSe.
function FakeWmsLayer(url, wmsParams, options) {
    FakeTileLayer.call(this, url, Object.assign({ uppercase: true }, options));
    this.wmsParams = wmsParams;
    this._crs = { code: 'EPSG:3857' };
    this._wmsVersion = parseFloat(wmsParams.version);
}
FakeWmsLayer.prototype = Object.create(FakeTileLayer.prototype);
FakeWmsLayer.prototype.constructor = FakeWmsLayer;
FakeWmsLayer.prototype.getTileUrl = function (c) {
    if (!this._map) throw new TypeError("Cannot read properties of null (reading 'unproject')");
    if (typeof c.scaleBy !== 'function') throw new TypeError('coords.scaleBy is not a function');
    const bbox = tileBbox(c.z, c.x, c.y);
    const base = FakeTileLayer.prototype.getTileUrl.call(this, c);
    return base + getParamString(this.wmsParams, base, this.options.uppercase) +
        (this.options.uppercase ? '&BBOX=' : '&bbox=') + bbox.join(',');
};

function tileBbox(z, x, y) {
    const w = 2 * HALF / Math.pow(2, z);
    const minX = -HALF + x * w, maxY = HALF - y * w;
    return [minX, maxY - w, minX + w, maxY];
}

// Leaflet sets _tileZoom before it asks for a tile's URL, so do the same here.
function urlAt(layer, x, y, z) {
    layer._tileZoom = z;
    const c = new FakePoint(x, y);
    c.z = z;
    return layer.getTileUrl(c);
}

function loadBase(fakeL) {
    const sandbox = { console, isFinite, Math, Object, Array, Number, String, JSON };
    sandbox.window = { L: fakeL, maplibregl: { Map: function Map() {}, supported() { return true; } } };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: 'globe-base-layer.js' });
    return sandbox.window.DetectLabGlobeBase;
}

const created = [];
const fakeL = {
    maplibreGL(options) { const a = new FakeAdapter(options); created.push(a); return a; },
    point(x, y) { return new FakePoint(x, y); },
    DomUtil: { getPosition: () => ({ x: 0, y: 0 }) }
};
const B = loadBase(fakeL);
assert(B && B.attachTileTwin && B._test, 'DetectLabGlobeBase exposes attachTileTwin and its test hooks');
const T = B._test;

// ── Mercator tile bounds and WMS request comparison ───────────────────────
assert.deepEqual(Array.from(T.tileBbox3857(0, 0, 0)), [-HALF, -HALF, HALF, HALF], 'zoom 0 covers the whole EPSG:3857 square');
assert.deepEqual(Array.from(T.tileBbox3857(1, 1, 0)), [0, 0, HALF, HALF], 'the north-east quadrant at zoom 1');
assert.equal(T.sameWmsRequest('h?A=1&BBOX=1,2,3,4', 'h?A=1&BBOX=1.0000001,2,3,4', 'BBOX='), true, 'bbox agrees to a millimetre');
assert.equal(T.sameWmsRequest('h?A=1&BBOX=1,2,3,4', 'h?A=2&BBOX=1,2,3,4', 'BBOX='), false, 'a different parameter is a different request');
assert.equal(T.sameWmsRequest('h?A=1&BBOX=1,2,3,4', 'h?A=1&BBOX=1,2,3,5', 'BBOX='), false, 'a different bbox is a different request');

// ── URL conversion: accepted when it reproduces Leaflet, refused otherwise ──
const xyz = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png');
xyz._tileZoom = 7;
const xyzSource = T.overlaySourceFor(xyz, FakeTileLayer.prototype.getTileUrl);
assert(xyzSource, 'a subdomain XYZ layer converts');
assert.deepEqual(Array.from(xyzSource.tiles), ['https://tiles.example/a/{z}/{x}/{y}.png', 'https://tiles.example/b/{z}/{x}/{y}.png'],
    'each subdomain becomes one tile template');
assert.equal(xyzSource.tileSize, 256);
assert.equal(xyz._tileZoom, 7, 'the probes restore the layer\'s own tile zoom');

const native4 = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png', { maxNativeZoom: 4, maxZoom: 6, minZoom: 2 });
const native4Source = T.overlaySourceFor(native4, FakeTileLayer.prototype.getTileUrl);
assert(native4Source, 'a layer with native zoom limits converts');
assert.equal(native4Source.sourceMaxzoom, 4, 'the source stops at the native zoom');
assert.equal(native4Source.maxZoom, 6, 'the layer keeps its maxZoom for visibility');
assert.equal(native4Source.minZoom, 2, 'the layer keeps its minZoom for visibility');

assert.equal(T.overlaySourceFor(new FakeTileLayer('https://tiles.example/{q}.png'), FakeTileLayer.prototype.getTileUrl), null,
    'quadkey layers stay Leaflet layers');
assert.equal(T.overlaySourceFor(new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png', { subdomains: [] }), FakeTileLayer.prototype.getTileUrl), null,
    'a {s} template without subdomains is refused');
assert.equal(T.overlaySourceFor(new FakeTileLayer('https://tiles.example/{z}/{x}/{y}.png', { tms: true }), FakeTileLayer.prototype.getTileUrl), null,
    'TMS layers stay Leaflet layers in this phase');
assert.equal(T.overlaySourceFor(new FakeTileLayer('https://tiles.example/{z}/{x}/{y}.png', { minNativeZoom: 1 }), FakeTileLayer.prototype.getTileUrl), null,
    'a minimum native zoom is refused (Leaflet clamps tiles up to it)');
assert.equal(T.overlaySourceFor(new FakeTileLayer('https://tiles.example/{z}/{x}/{y}.png', { tileSize: 512 }), FakeTileLayer.prototype.getTileUrl), null,
    'non-256 tiles are refused');
assert.equal(T.overlaySourceFor(new FakeTileLayer('https://tiles.example/{z}/{x}/{y}.png', { zoomOffset: 1 }), FakeTileLayer.prototype.getTileUrl), null,
    'a zoom offset is refused');

const wms = new FakeWmsLayer('https://wms.example/ows', { layers: 'borders', format: 'image/png', transparent: 'true', version: '1.1.1', srs: 'EPSG:3857' });
new FakeMap().addLayer(wms);
const wmsSource = T.overlaySourceFor(wms, FakeWmsLayer.prototype.getTileUrl);
assert(wmsSource && wmsSource.wms, 'a WMS layer in EPSG:3857 converts');
assert.match(wmsSource.tiles[0], /&BBOX=\{bbox-epsg-3857\}$/, 'the WMS template ends in the bbox placeholder');

const wmsNoMap = new FakeWmsLayer('https://wms.example/ows', { layers: 'borders', version: '1.1.1' });
assert.equal(T.overlaySourceFor(wmsNoMap, FakeWmsLayer.prototype.getTileUrl), null, 'a WMS layer that is not on a map is not converted yet');

const wmsDrift = new FakeWmsLayer('https://wms.example/ows', { layers: 'borders', version: '1.1.1', srs: 'EPSG:3857' });
new FakeMap().addLayer(wmsDrift);
wmsDrift.getTileUrl = function (c) {
    return FakeWmsLayer.prototype.getTileUrl.call(this, c).replace('&BBOX=', '&BBOX=' + (c.z > 0 ? '0,0,0,0&X=' : ''));
};
assert.equal(T.overlaySourceFor(wmsDrift, wmsDrift.getTileUrl), null, 'a WMS request Leaflet would not make is refused');

const wmsOther = new FakeWmsLayer('https://wms.example/ows', { layers: 'borders' });
new FakeMap().addLayer(wmsOther);
wmsOther._crs = { code: 'EPSG:4326' };
assert.equal(T.overlaySourceFor(wmsOther, FakeWmsLayer.prototype.getTileUrl), null, 'WMS in another CRS stays Leaflet');

// ── Attach, add, opacity, remove and redraw ───────────────────────────────
const map = new FakeMap();
const layer = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png');
assert.equal(B.attachTileTwin(layer), true, 'the hooks install on a convertible layer');
assert.equal(B.attachTileTwin(layer), false, 'a layer is only hooked once');
assert.equal(created.length, 0, 'no twin before the layer is on a map');

map.addLayer(layer);
assert.equal(created.length, 1, 'adding the layer attaches one globe twin');
const twin1 = created[0];
assert.equal(twin1.options.pane, 'pane_twin_test', 'the twin lives in the layer pane');
assert.equal(twin1._detectlabGlobeOverlay, true, 'the twin is marked as an overlay');
assert.equal(twin1._detectlabGlobeBase, undefined, 'an overlay twin carries no basemap flags');
assert.equal(twin1.options.style.projection.type, 'globe', 'the twin uses the globe projection');
assert.equal(twin1.options.style.layers[0].type, 'raster', 'the twin is a raster overlay');
assert.equal(urlAt(layer, 1, 2, 3), BLANK, 'while attached, Leaflet requests no tiles');
assert.equal(layer.getContainer().style.display, 'none', 'Leaflet tiles are hidden behind the twin');
assert(map.hasLayer(twin1), 'the twin is on the same map');

layer.setOpacity(0.4);
assert.equal(layer.options.opacity, 0.4, 'Leaflet keeps its own opacity state');
assert.equal(twin1.options.opacity, 0.4, 'the twin follows the layer opacity');
assert.equal(glPaints.filter((p) => p.adapter === twin1).slice(-1)[0].value, 0.4, 'opacity reaches the twin');

map.removeLayer(layer);
assert.equal(map.hasLayer(twin1), false, 'removing the layer removes its twin');
assert.equal(urlAt(layer, 1, 2, 3), 'https://tiles.example/b/3/1/2.png', 'Leaflet builds its own URLs again after removal');
assert.equal(layer.getContainer().style.display, '', 'Leaflet tiles are shown again after removal');

map.addLayer(layer);
assert.equal(created.length, 2, 're-adding attaches a fresh twin');
layer._url = 'https://tiles.example/v2/{z}/{x}/{y}.png';
layer.redraw();
assert.equal(created.length, 3, 'a changed URL rebuilds the twin');
assert.equal(map.layers.filter((l) => l === created[1] || l === created[2]).length, 1, 'only the current twin stays on the map');
assert.equal(created[2].options.style.sources['detectlab-overlay'].tiles[0], 'https://tiles.example/v2/{z}/{x}/{y}.png',
    'the rebuilt twin uses the new URL');

// ── Zoom limits follow Leaflet's rounded test ─────────────────────────────
const limited = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png', { maxNativeZoom: 4, maxZoom: 6, minZoom: 2 });
const limitedMap = new FakeMap();
B.attachTileTwin(limited);
limitedMap.addLayer(limited);
const limitedTwin = created[created.length - 1];
const limitedStyle = limitedTwin.options.style;
assert.equal(limitedStyle.sources['detectlab-overlay'].maxzoom, 4, 'the source stops at the native zoom and overzooms above it');
// The adapter drives the camera at Leaflet zoom minus 1, so the limits are in camera zoom.
assert.equal(limitedStyle.layers[0].maxzoom, 5.5, 'camera zoom 5.5 is Leaflet zoom 6.5, where round(zoom) passes maxZoom 6');
assert.equal(limitedStyle.layers[0].minzoom, 0.5, 'camera zoom 0.5 is Leaflet zoom 1.5, where round(zoom) reaches minZoom 2');
// Sweep Leaflet zooms in 1/8 steps (exact in binary, so the half-level edges are exact):
// Leaflet shows the layer when round(zoom) is inside [minZoom, maxZoom]; the twin's camera
// is at zoom - 1, and it must show at exactly the same zooms.
for (let i = 0; i <= 80; i++) {
    const lz = i / 8;
    const leafletVisible = Math.round(lz) >= 2 && Math.round(lz) <= 6;
    const gz = lz - 1;
    const twinVisible = gz >= limitedStyle.layers[0].minzoom && gz < limitedStyle.layers[0].maxzoom;
    assert.equal(twinVisible, leafletVisible, 'the twin shows exactly when Leaflet does, at Leaflet zoom ' + lz);
}

// ── WMS twin end to end ───────────────────────────────────────────────────
const wmsMap = new FakeMap();
const wmsLayer = new FakeWmsLayer('https://wms.example/ows', { layers: 'borders', format: 'image/png', version: '1.1.1', srs: 'EPSG:3857' }, { pane: 'pane_wms_test' });
B.attachTileTwin(wmsLayer);
wmsMap.addLayer(wmsLayer);
const wmsTwin = created[created.length - 1];
assert.match(wmsTwin.options.style.sources['detectlab-overlay'].tiles[0], /&BBOX=\{bbox-epsg-3857\}$/, 'the WMS twin asks for bboxes');
assert.equal(wmsTwin.options.pane, 'pane_wms_test');

// ── A layer that is already on a map gets its twin at attach time ─────────
const preAdded = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png');
new FakeMap().addLayer(preAdded);
const beforePre = created.length;
B.attachTileTwin(preAdded);
assert.equal(created.length, beforePre + 1, 'attaching a layer that is already on a map builds its twin at once');

// ── Fallback: a layer that cannot be reproduced keeps Leaflet's own tiles ──
const fallbackMap = new FakeMap();
const quad = new FakeTileLayer('https://tiles.example/{q}.png');
B.attachTileTwin(quad);
const before = created.length;
fallbackMap.addLayer(quad);
assert.equal(created.length, before, 'no twin for a layer that cannot be reproduced');
assert.equal(quad.getContainer().style.display, '', 'Leaflet tiles stay visible');
assert.equal(quad.redrawCount, 1, 'Leaflet reloads its tiles after the failed twin');

const drift = new FakeWmsLayer('https://wms.example/ows', { layers: 'borders', version: '1.1.1', srs: 'EPSG:3857' });
drift.getTileUrl = wmsDrift.getTileUrl;
B.attachTileTwin(drift);
const beforeDrift = created.length;
new FakeMap().addLayer(drift);
assert.equal(created.length, beforeDrift, 'a WMS whose requests do not reproduce is not twinned');

const broken = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png');
broken.getTileUrl = function () { throw new Error('boom'); };
B.attachTileTwin(broken);
const beforeBroken = created.length;
assert.doesNotThrow(() => new FakeMap().addLayer(broken), 'a converter error does not break adding the layer');
assert.equal(created.length, beforeBroken, 'a converter error builds no twin');
assert.equal(broken.redrawCount, 1, 'a converter error reloads Leaflet\'s own tiles');
assert.equal(urlAt(broken, 1, 2, 3), 'https://tiles.example/b/3/1/2.png', 'Leaflet builds its own URLs after a converter error');

// ── Basemap: create() without options.overlay keeps the basemap flags ─────
const baseMap = new FakeMap();
const base = B.create(baseMap, {});
assert(base && base._detectlabGlobeBase === true, 'the basemap keeps its globe flag');
assert.equal(base._detectlabGlobeSourceId, 'detectlab', 'the basemap keeps its source id');

console.log('  ✓ URL conversion, zoom limits, attach/detach, opacity, redraw and fallback verified');
console.log('All globe raster twin tests passed.');
