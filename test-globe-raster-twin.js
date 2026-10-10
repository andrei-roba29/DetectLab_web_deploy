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
const sharedCreateTile = function createTile() { return null; };
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

console.log('[Test] Globe twins for Leaflet raster overlays...');

// ── Leaflet-shaped stand-ins ──────────────────────────────────────────────
class FakePoint {
    constructor(x, y) { this.x = x; this.y = y; }
    scaleBy(p) { return new FakePoint(this.x * p.x, this.y * p.y); }
    add(p) { return new FakePoint(this.x + p.x, this.y + p.y); }
}

// The MapLibre adapter: the globe layer that create() wraps. Its map keeps
// sources, layers and paint as MapLibre does; the style loads later when
// globalThis.__fakeStyleLoaded is false (the test fires 'style.load' itself).
const glPaints = [];
class FakeGlMap {
    constructor(owner, loaded) {
        this.owner = owner;
        this.loaded = loaded;
        this.sources = {};
        this.layers = [];
        this.paint = glPaints;
        this.handlers = {};
    }
    isStyleLoaded() { return this.loaded; }
    once(type, fn) { if (type === 'load' && this.loaded) fn(); else (this.handlers[type] = this.handlers[type] || []).push({ fn, once: true }); }
    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push({ fn, once: false }); }
    fire(type) {
        if (type === 'style.load') this.loaded = true;
        const list = this.handlers[type] || [];
        this.handlers[type] = list.filter((h) => !h.once);
        list.forEach((h) => h.fn());
    }
    addSource(id, spec) {
        if (!this.loaded) throw new Error('Style is not done loading');
        if (globalThis.__fakeRefuseSources) throw new Error('the style refuses this source');
        if (this.sources[id]) throw new Error('There is already a source with this ID');
        this.sources[id] = spec;
    }
    getSource(id) { return this.sources[id]; }
    removeSource(id) { if (!this.sources[id]) throw new Error('no source ' + id); delete this.sources[id]; }
    addLayer(spec) {
        if (!this.loaded) throw new Error('Style is not done loading');
        if (!this.sources[spec.source]) throw new Error('no source for layer ' + spec.id);
        this.layers.push(Object.assign({}, spec));
    }
    getLayer(id) { return this.layers.find((l) => l.id === id) || null; }
    removeLayer(id) { this.layers = this.layers.filter((l) => l.id !== id); }
    setPaintProperty(layer, prop, value) {
        const l = this.getLayer(layer);
        if (!l) throw new Error('no layer ' + layer);
        l.paint[prop] = value;
        this.paint.push({ layer, prop, value, adapter: this.owner });
    }
}
class FakeAdapter {
    constructor(options) {
        this.options = Object.assign({ opacity: 1 }, options);
        this._zooming = false;
        this._map = null;
        this.glMap = new FakeGlMap(this, globalThis.__fakeStyleLoaded !== false);
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

// The twin's own source and layer inside its pane's shared overlay.
function twinSpecs(layer) {
    const t = layer._detectlabTwin;
    if (!t || !t.handle || !t.shared) return null;
    const gl = t.shared.glMap;
    return { source: gl.sources[t.handle.sourceId], layer: gl.getLayer(t.handle.layerId), gl };
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
FakeTileLayer.prototype.createTile = sharedCreateTile;
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

function onMap(layer) { new FakeMap().addLayer(layer); return layer; }

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
    TileLayer: { prototype: { createTile: sharedCreateTile } },
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

// ── URL conversion: accepted when it reproduces Leaflet, refused otherwise ──
const xyz = onMap(new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png'));
xyz._tileZoom = 7;
const xyzSource = T.overlaySourceFor(xyz, FakeTileLayer.prototype.getTileUrl);
assert(xyzSource, 'a subdomain XYZ layer converts');
assert.deepEqual(Array.from(xyzSource.tiles), ['https://tiles.example/a/{z}/{x}/{y}.png', 'https://tiles.example/b/{z}/{x}/{y}.png'],
    'each subdomain becomes one tile template');
assert.equal(xyzSource.tileSize, 256);
assert.equal(xyz._tileZoom, 7, 'the probes restore the layer\'s own tile zoom');

const native4 = onMap(new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png', { maxNativeZoom: 4, maxZoom: 6, minZoom: 2 }));
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
assert.equal(created.length, 1, 'adding the layer opens the pane overlay (one instance for the pane)');
const twin1 = created[0];
assert.equal(twin1.options.pane, 'pane_twin_test', 'the overlay lives in the layer pane');
assert.equal(twin1._detectlabGlobeOverlay, true, 'the overlay is marked as an overlay');
assert.equal(twin1._detectlabGlobeBase, undefined, 'an overlay carries no basemap flags');
assert.equal(twin1.options.style.projection.type, 'globe', 'the overlay uses the globe projection');
assert.equal(twin1.glMap.layers.length, 1, 'the twin is one raster layer in the overlay');
assert.equal(twin1.glMap.layers[0].type, 'raster', 'the twin is a raster overlay');
assert.equal(twinSpecs(layer).gl, twin1.glMap, 'the twin is inside the overlay that is on the map');
assert.equal(urlAt(layer, 1, 2, 3), BLANK, 'while attached, Leaflet requests no tiles');
assert.equal(layer.getContainer().style.display, 'none', 'Leaflet tiles are hidden behind the twin');
assert(map.hasLayer(twin1), 'the twin is on the same map');

layer.setOpacity(0.4);
assert.equal(layer.options.opacity, 0.4, 'Leaflet keeps its own opacity state');
assert.equal(twinSpecs(layer).layer.paint['raster-opacity'], 0.4, 'the twin follows the layer opacity');
assert.equal(glPaints.filter((p) => p.adapter === twin1).slice(-1)[0].value, 0.4, 'opacity reaches the twin');

map.removeLayer(layer);
assert.equal(map.hasLayer(twin1), false, 'removing the layer removes its twin');
assert.equal(urlAt(layer, 1, 2, 3), 'https://tiles.example/b/3/1/2.png', 'Leaflet builds its own URLs again after removal');
assert.equal(layer.getContainer().style.display, '', 'Leaflet tiles are shown again after removal');

map.addLayer(layer);
assert.equal(created.length, 2, 're-adding opens a fresh overlay, as the last twin had closed the old one');
const oldSourceIds = Object.keys(twin1.glMap.sources);
assert.equal(oldSourceIds.length, 0, 'closing the last twin leaves no source behind');
layer._url = 'https://tiles.example/v2/{z}/{x}/{y}.png';
layer.redraw();
assert.equal(created.length, 2, 'a changed URL swaps the twin inside the same overlay');
assert.equal(map.layers.filter((l) => l === created[1]).length, 1, 'the pane overlay stays on the map');
assert.equal(Object.keys(created[1].glMap.sources).length, 1, 'only the current twin source is left');
assert.equal(twinSpecs(layer).source.tiles[0], 'https://tiles.example/v2/{z}/{x}/{y}.png', 'the new twin uses the new URL');
assert.equal(created[1].glMap.layers.length, 1, 'the old twin layer is gone');

// ── Zoom limits follow Leaflet's rounded test ─────────────────────────────
const limited = new FakeTileLayer('https://tiles.example/{s}/{z}/{x}/{y}.png', { maxNativeZoom: 4, maxZoom: 6, minZoom: 2 });
const limitedMap = new FakeMap();
B.attachTileTwin(limited);
limitedMap.addLayer(limited);
const limitedStyle = { sources: {}, layers: [] };
{
    const specs = twinSpecs(limited);
    limitedStyle.sources.only = specs.source;
    limitedStyle.layers[0] = specs.layer;
}
assert.equal(limitedStyle.sources.only.maxzoom, 4, 'the source stops at the native zoom and overzooms above it');
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
assert.match(twinSpecs(wmsLayer).source.tiles[0], /&BBOX=\{bbox-epsg-3857\}$/, 'the WMS twin asks for bboxes');
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

// ── Custom tile drawing and per-tile bbox URLs ────────────────────────────
const drawn = onMap(new FakeTileLayer('https://tiles.example/{z}/{x}/{y}.png'));
drawn.createTile = function () { return {}; };   // this layer draws its own tiles
assert.equal(T.overlaySourceFor(drawn, FakeTileLayer.prototype.getTileUrl), null, 'a layer that draws its own tiles is not converted');

const bboxUrl = (c) => 'https://ows.example/export?bboxSR=3857&size=256,256&bbox=' + tileBbox(c.z, c.x, c.y).join(',') + '&f=image';
const fnLayer = onMap(new FakeTileLayer('', {}));
fnLayer.getTileUrl = function (c) { return bboxUrl(c); };
const fnSource = T.overlaySourceFor(fnLayer, fnLayer.getTileUrl);
assert(fnSource, 'a per-tile URL whose only varying part is the EPSG:3857 bbox converts');
assert.equal(fnSource.tiles[0], 'https://ows.example/export?bboxSR=3857&size=256,256&bbox={bbox-epsg-3857}&f=image',
    'the bbox becomes the MapLibre placeholder');

const latLngBox = onMap(new FakeTileLayer('', {}));
latLngBox.getTileUrl = function (c) { const b = tileBbox(c.z, c.x, c.y); return 'https://ows.example/x?bbox=' + [b[1], b[0], b[3], b[2]].join(','); };
assert.equal(T.overlaySourceFor(latLngBox, latLngBox.getTileUrl), null, 'a bbox in another axis order is refused');

const tileParam = onMap(new FakeTileLayer('', {}));
tileParam.getTileUrl = function (c) { return bboxUrl(c) + '&tile=' + c.x; };
assert.equal(T.overlaySourceFor(tileParam, tileParam.getTileUrl), null, 'a second varying parameter is refused');

const fnTwinMap = new FakeMap();
const fnTwinLayer = new FakeTileLayer('', {});
fnTwinLayer.getTileUrl = function (c) { return bboxUrl(c); };
B.attachTileTwin(fnTwinLayer);
const beforeFn = created.length;
fnTwinMap.addLayer(fnTwinLayer);
assert.equal(created.length, beforeFn + 1, 'a converting per-tile bbox layer gets a twin');
assert.equal(twinSpecs(fnTwinLayer).source.tiles[0],
    'https://ows.example/export?bboxSR=3857&size=256,256&bbox={bbox-epsg-3857}&f=image', 'the twin asks for the bbox');

// ── One overlay instance per pane ─────────────────────────────────────────
// Twins in one pane share one MapLibre instance, so the page holds one WebGL
// context per pane instead of one per twin. Each twin is one source and one layer.
{
    const shareMap = new FakeMap();
    const before = created.length;
    const t1 = new FakeTileLayer('https://tiles.example/one/{z}/{x}/{y}.png', { pane: 'pane_share' });
    const t2 = new FakeTileLayer('https://tiles.example/two/{z}/{x}/{y}.png', { pane: 'pane_share' });
    const t3 = new FakeTileLayer('https://tiles.example/three/{z}/{x}/{y}.png', { pane: 'pane_other' });
    B.attachTileTwin(t1); B.attachTileTwin(t2); B.attachTileTwin(t3);
    shareMap.addLayer(t1);
    shareMap.addLayer(t2);
    assert.equal(created.length - before, 1, 'two twins in one pane share one overlay instance');
    assert.equal(t1._detectlabTwin.shared, t2._detectlabTwin.shared, 'both twins hold the same overlay');
    const shared = t1._detectlabTwin.shared;
    assert.equal(Object.keys(shared.glMap.sources).length, 2, 'both twin sources are in that overlay');
    assert.deepEqual(shared.glMap.layers.map((l) => l.source), [t1._detectlabTwin.handle.sourceId, t2._detectlabTwin.handle.sourceId],
        'the later twin is drawn above the earlier one, as Leaflet stacks a pane');
    shareMap.addLayer(t3);
    assert.equal(created.length - before, 2, 'a twin in another pane gets an overlay of its own');
    assert.notEqual(t3._detectlabTwin.shared, shared, 'the other pane does not share the instance');
    shareMap.removeLayer(t1);
    assert.equal(shareMap.hasLayer(shared.layer), true, 'the pane overlay stays while one of its twins remains');
    assert.deepEqual(Object.keys(shared.glMap.sources), [t2._detectlabTwin.handle.sourceId], 'only the remaining twin source is left');
    assert.equal(shared.glMap.layers.length, 1, 'and only its layer');
    shareMap.removeLayer(t2);
    assert.equal(shareMap.hasLayer(shared.layer), false, 'the pane overlay goes with its last twin');
    assert.equal(shared.glMap.layers.length, 0, 'and its layers are gone');
    shareMap.removeLayer(t3);
}

// ── Work queued until the style has loaded ────────────────────────────────
{
    globalThis.__fakeStyleLoaded = false;
    const lateMap = new FakeMap();
    const late = new FakeTileLayer('https://tiles.example/late/{z}/{x}/{y}.png', { pane: 'pane_late' });
    B.attachTileTwin(late);
    lateMap.addLayer(late);
    globalThis.__fakeStyleLoaded = true;
    const lateShared = late._detectlabTwin.shared;
    assert.equal(Object.keys(lateShared.glMap.sources).length, 0, 'while the style loads, the twin is only queued');
    lateShared.glMap.fire('style.load');
    assert.equal(Object.keys(lateShared.glMap.sources).length, 1, 'when the style loads, the queued twin is added');
    assert.equal(lateShared.glMap.layers.length, 1, 'with its layer');

    globalThis.__fakeStyleLoaded = false;
    const cancelMap = new FakeMap();
    const cancelled = new FakeTileLayer('https://tiles.example/cancelled/{z}/{x}/{y}.png', { pane: 'pane_cancel' });
    B.attachTileTwin(cancelled);
    cancelMap.addLayer(cancelled);
    const cancelShared = cancelled._detectlabTwin.shared;
    cancelMap.removeLayer(cancelled);
    globalThis.__fakeStyleLoaded = true;
    cancelShared.glMap.fire('style.load');
    assert.equal(Object.keys(cancelShared.glMap.sources).length, 0, 'a twin removed before the style loads is never added');
    globalThis.__fakeStyleLoaded = undefined;
}

// ── Opacity belongs to each twin, not to the pane ─────────────────────────
{
    const opMap = new FakeMap();
    const o1 = new FakeTileLayer('https://tiles.example/o1/{z}/{x}/{y}.png', { pane: 'pane_opacity' });
    const o2 = new FakeTileLayer('https://tiles.example/o2/{z}/{x}/{y}.png', { pane: 'pane_opacity' });
    B.attachTileTwin(o1); B.attachTileTwin(o2);
    opMap.addLayer(o1); opMap.addLayer(o2);
    o1.setOpacity(0.25);
    const gl = o1._detectlabTwin.shared.glMap;
    assert.equal(gl.getLayer(o1._detectlabTwin.handle.layerId).paint['raster-opacity'], 0.25, 'the changed twin takes its opacity');
    assert.equal(gl.getLayer(o2._detectlabTwin.handle.layerId).paint['raster-opacity'], 1, 'the other twin in the pane keeps its own');
    opMap.removeLayer(o1); opMap.removeLayer(o2);
}

// ── A style that refuses the twin leaves Leaflet's own tiles on screen ────
{
    const refusedMap = new FakeMap();
    const refused = new FakeTileLayer('https://tiles.example/refused/{s}/{z}/{x}/{y}.png', { pane: 'pane_refused' });
    B.attachTileTwin(refused);
    globalThis.__fakeRefuseSources = true;
    refusedMap.addLayer(refused);
    globalThis.__fakeRefuseSources = false;
    assert.equal(refused._detectlabTwin.handle, null, 'a refused twin is not kept');
    assert.equal(refused.getContainer().style.display, '', 'Leaflet tiles stay visible');
    assert.match(urlAt(refused, 1, 2, 3), /^https:\/\/tiles\.example\/refused\//, 'Leaflet builds its own URLs');
    assert.equal(refusedMap.layers.filter((l) => l instanceof FakeAdapter).length, 0, 'the overlay opened for it is closed again');
}

// ── Basemap: create() without options.overlay keeps the basemap flags ─────
const baseMap = new FakeMap();
const base = B.create(baseMap, {});
assert(base && base._detectlabGlobeBase === true, 'the basemap keeps its globe flag');
assert.equal(base._detectlabGlobeSourceId, 'detectlab', 'the basemap keeps its source id');

console.log('  ✓ URL conversion, zoom limits, attach/detach, opacity, redraw and fallback verified');
console.log('All globe raster twin tests passed.');
