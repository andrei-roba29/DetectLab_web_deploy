/*
 * test-sat60-mobile-crash.js
 * ──────────────────────────────────────────────────────────────────────────
 * Guards the bug where the "Satellite imagery 60's" layer crashed the site
 * on mobile (including "Desktop site" mode and the installed PWA) when the
 * user zoomed in quickly or made a sudden map movement.
 *
 * The layer itself worked — imagery was drawn. What killed the tab was the
 * VOLUME of tile work during a gesture:
 *
 *   • 9 CORONA tile layers (6 pass mosaics + 3 frames) live in one pane.
 *   • Leaflet 1.9.4 defaults, per layer:
 *       updateWhenZooming : true              → re-queue tiles on EVERY frame
 *                                               of a pinch / scroll zoom
 *       updateWhenIdle    : L.Browser.mobile  → false when the user-agent is
 *                                               spoofed by "Desktop site", so
 *                                               EVERY pan frame re-runs
 *                                               _update() as well
 *       keepBuffer        : 2                 → a 2-tile ring of off-screen
 *                                               tiles retained per layer
 *   • _pruneTiles() additionally retains up to 5 ancestor levels and 2
 *     descendant levels per layer while the zoom is changing.
 *
 * 9 × (that) during a fast gesture = hundreds of in-flight requests and
 * decoded 256×256 PNGs in about a second → mobile WebKit/Chromium terminates
 * the tab (out of memory).
 *
 * The fix keeps WHAT is requested identical (same endpoint, same WMS-C URL
 * and parameter order, same layer names, same footprints, same z8/z12
 * gating) and only changes HOW OFTEN and HOW MANY tiles stay alive:
 *
 *   1. updateWhenZooming:false — zoom-animation frames become pure CSS
 *      transforms; tiles load once, at the end of the zoom.
 *   2. updateWhenIdle:true (explicit, not the UA sniff) — pan loads on
 *      moveend, not on every move frame.
 *   3. keepBuffer 1 on touch/low-memory devices (2 on desktop).
 *   4. Passes/frames that cannot draw in the current view (footprint
 *      off-screen, or min zoom not reached) are detached from the group
 *      after the gesture settles, so they stop holding tiles and levels.
 *
 * Run:  node test-sat60-mobile-crash.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const mapAppPath = path.join(__dirname, 'js/map-app.js');
const mapApp = fs.readFileSync(mapAppPath, 'utf8');

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
    checks++;
    if (cond) {
        console.log('  \u2713 ' + name);
    } else {
        failures++;
        console.error('  \u2717 ' + name + (detail ? ' — ' + detail : ''));
    }
}

/* The Sat60 block only — so the checks cannot be satisfied by unrelated code. */
const sat60Start = mapApp.indexOf('// ── SATELIT 60s');
const sat60End = mapApp.indexOf('window.setSatellite60sMapOpacity');
const sat60 = mapApp.slice(sat60Start, sat60End);

/* ══════════════════════════════════════════════════════════════════════════
 * 0. The whole file must actually parse
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[0] js/map-app.js is syntactically valid (a parse error disables the map entirely)');

let parseError = null;
try {
    new (require('vm').Script)(mapApp, { filename: 'js/map-app.js' });
} catch (err) {
    parseError = err;
}
check('js/map-app.js parses as a script', parseError === null,
    parseError ? parseError.message : '');

// The specific corruption that was found: a duplicated paste left a dangling
// `var tl =` followed by an `if` statement inside readSerial().
check('no truncated "var tl =" assignment left by a bad paste',
    !/var\s+tl\s*=\s*\n?\s*if\s*\(/.test(mapApp) &&
    !/var\s+tl\s*=\s{2,}if\s*\(/.test(mapApp));
check('readSerial() decodes SQLite text serial types normally',
    /var tl = \(s - 13\) \/ 2, tb = new Uint8Array\(buf, off, tl\), ts = ''/.test(mapApp));

check('Sat60 block located', sat60Start !== -1 && sat60End > sat60Start);

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Zoom animations must not queue tiles frame by frame
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[1] Fast zoom cannot flood the browser (updateWhenZooming disabled)');

check('tile layers are built with updateWhenZooming: false',
    /updateWhenZooming\s*:\s*false/.test(sat60));
check('updateWhenZooming is never re-enabled for Sat60',
    !/updateWhenZooming\s*:\s*true/.test(sat60));

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Sudden pans must not queue tiles frame by frame
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[2] Sudden movement cannot flood the browser (updateWhenIdle forced on)');

check('tile layers are built with updateWhenIdle: true',
    /updateWhenIdle\s*:\s*true/.test(sat60));
check('updateWhenIdle is set explicitly, not left to the user-agent sniff',
    !/updateWhenIdle\s*:\s*L\.Browser\.mobile/.test(sat60));

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Fewer retained off-screen tiles on constrained devices
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[3] Off-screen tile ring is reduced on touch / low-memory devices');

check('keepBuffer is configured per device', /keepBuffer\s*:/.test(sat60));
check('keepBuffer is 1 on low-power devices',
    /keepBuffer\s*:\s*lowPower\s*\?\s*1\s*:/.test(sat60));
check('a low-power device detector exists', /_sat60IsLowPowerDevice/.test(sat60));
check('detection survives "Desktop site" mode (coarse pointer, not just the UA)',
    /pointer:\s*coarse/.test(sat60) &&
    (/maxTouchPoints/.test(sat60) || /ontouchstart/.test(sat60)));
check('Leaflet\'s own mobile sniff is still honoured',
    /L\.Browser\s*&&\s*L\.Browser\.mobile/.test(sat60));
check('low-memory devices are covered', /deviceMemory/.test(sat60));
check('the behaviour can be overridden for debugging',
    /SAT60_LOW_POWER_TILES/.test(sat60));

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Only products that can draw stay attached
 *    (the Europe-wide manager in js/corona-wms-layer.js replaced the
 *     hand-written list + _sat60SyncActiveLayers; the memory contract is the
 *     same: nothing that cannot draw is kept alive)
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Off-screen passes/frames are detached instead of held in memory');

const coronaLibPath = path.join(__dirname, 'js/corona-wms-layer.js');
const coronaLib = fs.readFileSync(coronaLibPath, 'utf8');

check('the manager re-evaluates the view in update()', /update:\s*function/.test(coronaLib));
check('membership is decided by the footprint polygon intersecting the view',
    /ringsIntersectBbox\(/.test(coronaLib) && /selectProducts:/.test(coronaLib));
check('products outside the view are removed from the group',
    /this\._group\.removeLayer\(layer\)/.test(coronaLib));
check('products entering the view are added back',
    /this\._group\.addLayer\(tileLayer\)/.test(coronaLib));
check('tile layers are created lazily, not one per catalogue entry',
    /_tileLayerFor:\s*function/.test(coronaLib) && /var existing = this\._layers\[location\]/.test(coronaLib));
check('the tile-layer cache is bounded (unused layers are evicted)',
    /_evictUnused/.test(coronaLib));
check('a not-yet-laid-out map cannot throw out of the update',
    /try\s*\{[\s\S]{0,200}this\._map\.getBounds\(\)/.test(coronaLib));
check('there are hard caps on how many products may be active at once',
    /maxActivePasses/.test(coronaLib) && /maxActiveFrames/.test(coronaLib));

check('the sync runs only after a gesture settles (moveend/zoomend)',
    /map\.on\(\s*["']moveend zoomend["']/.test(sat60));
check('the sync does NOT run on every move/zoom frame',
    !/map\.on\(\s*["'][^"']*\bmove\b[^"']*["']\s*,\s*function/.test(sat60) &&
    !/zoomanim/.test(sat60));
check('the sync runs once when the layer is switched on',
    /_sat60Manager\.update\(\)/.test(sat60));
check('the manager only works while the layer is on', /_sat60On\s*&&\s*_sat60Manager/.test(sat60));
check('low-power devices get smaller caps and a smaller viewport pad',
    /maxActivePasses:\s*lowPower\s*\?/.test(sat60) &&
    /viewportPad:\s*lowPower\s*\?/.test(sat60));

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Nothing about WHAT is requested changed
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[5] The imagery itself is untouched (same requests, same gating)');

check('same GWC WMS-C endpoint',
    coronaLib.indexOf('https://geoserve.cast.uark.edu/geoserver/gwc/service/wms') !== -1);
check('still one tile layer per corona product via createCoronaWmsLayer',
    /createCoronaWmsLayer\s*\n?\s*\?\s*root\.createCoronaWmsLayer\(this\.options\.url, opts\)/.test(coronaLib) ||
    /root\.createCoronaWmsLayer\(this\.options\.url, opts\)/.test(coronaLib));
check('pass mosaics still live at z8-11',
    /var PASS_MIN_ZOOM = 8;/.test(coronaLib) && /var PASS_MAX_ZOOM = 11;/.test(coronaLib));
check('frames still start at z12',
    /var FRAME_MIN_ZOOM = 12;/.test(coronaLib));
check('maxNativeZoom is the server pyramid depth (18 GWC levels → z17)',
    /maxNativeZoom:\s*17/.test(coronaLib));
check('per-product footprint bounds are still passed to Leaflet',
    /bounds:\s*bounds/.test(coronaLib));
check('opacity is applied to every active product',
    /setOpacity:\s*function[\s\S]{0,400}layer\.setOpacity\(opacity\)/.test(coronaLib));
check('the tileerror hide-and-log-once handler is still attached',
    /\.on\('tileerror'/.test(coronaLib) && /_coronaErrorLogged/.test(coronaLib));
check('the layer group is still what gets added to the map',
    /_sat60MapLayer\.addTo\(map\)/.test(sat60));
check('no manual "load here" machinery was introduced',
    sat60.indexOf('loadSatellite60sHere') === -1 &&
    sat60.indexOf('manualOnly') === -1 &&
    sat60.indexOf('CoronaWmsQueue') === -1);

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Behavioural simulation with the real manager
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[6] Simulated gesture: only relevant products stay attached');

const vm = require('vm');

function classExtend(proto) {
    function SubClass() { if (this.initialize) this.initialize.apply(this, arguments); }
    SubClass.prototype = Object.create(this.prototype || {});
    for (const k in proto) SubClass.prototype[k] = proto[k];
    return SubClass;
}
function WMSBase(url, options) { this._url = url; this.options = options || {}; }
WMSBase.extend = classExtend;
WMSBase.prototype = {
    initialize: function (url, options) { this._url = url; this.options = options || {}; },
    on: function () { return this; },
    off: function () { return this; },
    setOpacity: function () { return this; }
};
function LatLngBounds(a, b) {
    if (Array.isArray(a) && Array.isArray(a[0])) { b = a[1]; a = a[0]; }
    this.s = Math.min(a[0], b[0]); this.n = Math.max(a[0], b[0]);
    this.w = Math.min(a[1], b[1]); this.e = Math.max(a[1], b[1]);
}
LatLngBounds.prototype = {
    getSouth: function () { return this.s; },
    getNorth: function () { return this.n; },
    getWest: function () { return this.w; },
    getEast: function () { return this.e; },
    pad: function (f) {
        const dy = (this.n - this.s) * f, dx = (this.e - this.w) * f;
        return new LatLngBounds([this.s - dy, this.w - dx], [this.n + dy, this.e + dx]);
    }
};
function LayerGroup(layers) { this._set = new Set(layers || []); }
LayerGroup.prototype = {
    addLayer: function (l) { this._set.add(l); return this; },
    removeLayer: function (l) { this._set.delete(l); return this; },
    hasLayer: function (l) { return this._set.has(l); },
    size: function () { return this._set.size; }
};
const Lstub = {
    extend: function (t) {
        for (let i = 1; i < arguments.length; i++) {
            const s2 = arguments[i] || {};
            for (const k in s2) t[k] = s2[k];
        }
        return t;
    },
    TileLayer: { WMS: WMSBase },
    latLngBounds: function (a, b) { return new LatLngBounds(a, b); },
    layerGroup: function (l) { return new LayerGroup(l); },
    tileLayer: { wms: function (u, o) { return new WMSBase(u, o); } }
};
const sandbox = { console: { info: function () {}, warn: function () {}, error: function () {} },
    L: Lstub, encodeURIComponent: encodeURIComponent, Promise: Promise, Object: Object };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(coronaLib, sandbox, { filename: 'corona-wms-layer.js' });
const Atlas = sandbox.CoronaAtlas;

// A Europe-wide catalogue: three passes crossing Romania/Hungary/Poland,
// each with two frames — the shape the CAST catalogue really has.
function strip(id, lon0, lat0, lon1, lat1) {
    // A Corona pass is a long, rotated quad; its frames tile that quad.
    const width = 1.2;
    const lonMid = (lon0 + lon1) / 2;
    const latm = (lat0 + lat1) / 2;
    const quad = [[lon0, lat0], [lon0 + width, lat0], [lon1 + width, lat1], [lon1, lat1], [lon0, lat0]];
    const lower = [[lon0, lat0], [lon0 + width, lat0], [lonMid + width, latm], [lonMid, latm], [lon0, lat0]];
    const upper = [[lonMid, latm], [lonMid + width, latm], [lon1 + width, lat1], [lon1, lat1], [lonMid, latm]];
    function ext(ring) {
        const xs = ring.map(function (p) { return p[0]; });
        const ys = ring.map(function (p) { return p[1]; });
        return [Math.min.apply(null, xs), Math.min.apply(null, ys),
            Math.max.apply(null, xs), Math.max.apply(null, ys)];
    }
    return {
        id: id, label: id, location: id, extent: ext(quad), rings: [quad],
        images: [
            { label: id + 'df001', location: id + 'df001', extent: ext(lower), rings: [lower] },
            { label: id + 'df002', location: id + 'df002', extent: ext(upper), rings: [upper] }
        ]
    };
}
const catalogue = [
    strip('1104-2155Fore', 22.0, 44.0, 24.0, 48.0),   // Romania → Poland
    strip('1036-2139Fore', 25.5, 43.8, 27.5, 47.5),   // Moldova corridor
    strip('1022-2104Aft', 4.0, 48.0, 6.0, 52.0)       // France → Benelux
];

function managerAt(zoom, s, w, n, e, pad) {
    const group = Lstub.layerGroup([]);
    const map = {
        getZoom: function () { return zoom; },
        getBounds: function () { return new LatLngBounds([s, w], [n, e]); }
    };
    const manager = Atlas.createManager(map, {
        group: group,
        viewportPad: pad === undefined ? 0.35 : pad,
        maxActivePasses: 18,
        maxActiveFrames: 24,
        tileLayerOptions: { updateWhenZooming: false, updateWhenIdle: true, keepBuffer: 1 }
    });
    manager.setCatalog(catalogue);
    manager.update();
    return { manager: manager, group: group };
}

// Europe overview, below every min zoom → nothing attached, nothing fetched.
const overview = managerAt(5, 36.0, -10.0, 60.0, 30.0);
check('at z5 (Europe overview) no CORONA product is attached',
    overview.group.size() === 0, String(overview.group.size()));

// Transylvania at z10 → pass mosaics only, and only those crossing it.
const transZ10 = managerAt(10, 45.0, 22.6, 45.2, 22.9);
const transZ10names = transZ10.manager.getActiveProducts().map(function (p) { return p.product.location; });
check('at z10 only pass mosaics are attached',
    transZ10names.length > 0 && transZ10names.every(function (n) { return !/df\d+$/.test(n); }),
    transZ10names.join(','));
check('at z10 a pass on the other side of Europe is not attached',
    transZ10names.indexOf('1022-2104Aft') === -1, transZ10names.join(','));

// Same place at z13 → individual frames instead of the mosaic.
const transZ13 = managerAt(13, 45.0, 22.6, 45.2, 22.9);
const transZ13names = transZ13.manager.getActiveProducts().map(function (p) { return p.product.location; });
check('at z13 frames replace the pass mosaic',
    transZ13names.length > 0 && transZ13names.every(function (n) { return /df\d+$/.test(n); }),
    transZ13names.join(','));

// France at z10 → the French pass, not the Romanian ones.
const franceNames = managerAt(10, 48.5, 4.5, 48.8, 5.0).manager
    .getActiveProducts().map(function (p) { return p.product.location; });
check('panning to France swaps the attached products',
    franceNames.indexOf('1022-2104Aft') !== -1 &&
    franceNames.indexOf('1104-2155Fore') === -1, franceNames.join(','));

// A pan away detaches what can no longer draw (same manager instance).
const panning = managerAt(10, 45.0, 22.6, 45.2, 22.9);
const attachedBefore = panning.group.size();
panning.manager._map.getBounds = function () { return new LatLngBounds([48.5, 4.5], [48.8, 5.0]); };
panning.manager.update();
const afterNames = panning.manager.getActiveProducts().map(function (p) { return p.product.location; });
check('after the pan the Romanian passes are detached',
    attachedBefore > 0 && afterNames.indexOf('1104-2155Fore') === -1, afterNames.join(','));
check('after the pan the group holds only what can draw',
    panning.group.size() === afterNames.length,
    panning.group.size() + ' attached vs ' + afterNames.length + ' selected');

// The padding makes the attached set a superset of the strictly visible one.
const strictNames = managerAt(10, 45.0, 22.6, 45.2, 22.9, 0).manager
    .getActiveProducts().map(function (p) { return p.product.location; });
check('padded selection is a superset of the strictly visible selection',
    strictNames.every(function (n) { return transZ10names.indexOf(n) !== -1; }),
    strictNames.join(',') + ' vs ' + transZ10names.join(','));

// The caps really cap.
const capped = (function () {
    const group = Lstub.layerGroup([]);
    const map = {
        getZoom: function () { return 9; },
        getBounds: function () { return new LatLngBounds([40.0, 0.0], [55.0, 30.0]); }
    };
    const manager = Atlas.createManager(map, { group: group, viewportPad: 0, maxActivePasses: 2 });
    manager.setCatalog(catalogue);
    return manager.update();
})();
check('maxActivePasses caps how many mosaics can be attached at once',
    capped.length === 2, String(capped.length));

// Tile-layer options (the memory contract) reach the real tile layers.
const activeLayers = transZ10.manager.getActiveLayers();
check('the active selection produced real tile layers', activeLayers.length > 0);
const opts = (activeLayers[0] || { options: {} }).options;
check('updateWhenZooming:false reaches the tile layer', opts.updateWhenZooming === false);
check('updateWhenIdle:true reaches the tile layer', opts.updateWhenIdle === true);
check('keepBuffer reaches the tile layer', opts.keepBuffer === 1);

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All satellite-60s mobile-crash checks passed.');
