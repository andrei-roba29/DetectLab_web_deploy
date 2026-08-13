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
 *   3. keepBuffer 0 on touch/low-memory devices (2 on desktop).
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
check('keepBuffer is 0 on low-power devices',
    /keepBuffer\s*:\s*lowPower\s*\?\s*0\s*:/.test(sat60));
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
 * 4. Only layers that can draw stay attached
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[4] Off-screen passes/frames are detached instead of held in memory');

check('a viewport-sync function exists', /_sat60SyncActiveLayers/.test(sat60));
check('each layer remembers its own footprint', /_sat60Bounds/.test(sat60));
check('membership is decided by footprint intersection with the view',
    /_sat60Bounds\.intersects\(/.test(sat60));
check('membership also respects the layer\'s min zoom',
    /zoom\s*>=\s*\(layer\.options\.minZoom/.test(sat60));
check('layers are added back when they become relevant',
    /_sat60MapLayer\.addLayer\(layer\)/.test(sat60));
check('layers are removed when they cannot draw',
    /_sat60MapLayer\.removeLayer\(layer\)/.test(sat60));
check('the sync runs only after a gesture settles (moveend/zoomend)',
    /map\.on\(\s*["']moveend zoomend["']\s*,\s*_sat60SyncActiveLayers\s*\)/.test(sat60));
check('the sync does NOT run on every move/zoom frame',
    !/map\.on\(\s*["'][^"']*\bmove\b[^"']*["']\s*,\s*_sat60SyncActiveLayers/.test(sat60) &&
    !/map\.on\(\s*["'][^"']*\bzoomanim\b[^"']*["']\s*,\s*_sat60SyncActiveLayers/.test(sat60));
check('the sync runs once when the layer is switched on',
    /_sat60SyncActiveLayers\(\);/.test(sat60));
check('the sync is a no-op while the group is not on the map',
    /!map\.hasLayer\(_sat60MapLayer\)\)\s*return/.test(sat60));
check('a not-yet-laid-out map cannot throw out of the sync',
    /try\s*\{[\s\S]{0,200}map\.getBounds\(\)/.test(sat60));

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Nothing about WHAT is requested changed
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[5] The imagery itself is untouched (same requests, same layers, same gating)');

check('same GWC WMS-C endpoint',
    sat60.indexOf('https://geoserve.cast.uark.edu/geoserver/gwc/service/wms') !== -1);
check('still one tile layer per corona layer via createCoronaWmsLayer',
    /createCoronaWmsLayer\(SAT60_WMS_URL, opts\)/.test(sat60));
check('pass mosaics still start at z8', /SAT60_PASS_MIN_ZOOM\s*=\s*8/.test(sat60));
check('frames still start at z12', /SAT60_FRAME_MIN_ZOOM\s*=\s*12/.test(sat60));
check('maxNativeZoom is still the server pyramid depth',
    /SAT60_MAX_NATIVE_ZOOM\s*=\s*15/.test(sat60));
check('all 9 verified layers are still configured',
    (sat60.match(/name:\s*"corona:/g) || []).length === 9,
    (sat60.match(/name:\s*"corona:/g) || []).length + ' found');
check('per-layer footprint bounds are still passed to Leaflet',
    /bounds:\s*layerBounds/.test(sat60));
check('opacity control still walks every layer',
    /_sat60Layers\.forEach\(function \(layer\) \{[\s\S]{0,120}setOpacity/.test(mapApp));
check('the tileerror hide-and-log-once handler is still attached',
    /\.on\("tileerror"/.test(sat60) && /_sat60ErrorLogged/.test(sat60));
check('the layer group is still what gets added to the map',
    /_sat60MapLayer\.addTo\(map\)/.test(sat60));
check('no manual "load here" machinery was introduced',
    sat60.indexOf('loadSatellite60sHere') === -1 &&
    sat60.indexOf('manualOnly') === -1 &&
    sat60.indexOf('CoronaWmsQueue') === -1);

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Behavioural simulation of the viewport sync
 * ═════════════════════════════════════════════════════════════════════════ */
console.log('\n[6] Simulated gesture: only relevant layers stay attached');

// Minimal stand-ins for the Leaflet pieces the sync function touches.
function Bounds(s, w, n, e) { this.s = s; this.w = w; this.n = n; this.e = e; }
Bounds.prototype.intersects = function (o) {
    return this.s < o.n && this.n > o.s && this.w < o.e && this.e > o.w;
};
Bounds.prototype.pad = function (f) {
    const dy = (this.n - this.s) * f, dx = (this.e - this.w) * f;
    return new Bounds(this.s - dy, this.w - dx, this.n + dy, this.e + dx);
};

// The real configuration, read out of map-app.js.
const entryRe = /\{\s*name:\s*"(corona:[^"]+)"\s*,\s*bounds:\s*\[\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*,\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*\]\s*\}/g;
const passBlock = sat60.slice(sat60.indexOf('var SAT60_PASS_LAYERS'), sat60.indexOf('var SAT60_FRAME_LAYERS'));
const frameBlock = sat60.slice(sat60.indexOf('var SAT60_FRAME_LAYERS'), sat60.indexOf('var SAT60_PASS_MIN_ZOOM'));

function parse(block, minZoom) {
    const out = [];
    let m;
    entryRe.lastIndex = 0;
    while ((m = entryRe.exec(block)) !== null) {
        out.push({
            name: m[1],
            options: { minZoom: minZoom },
            _sat60Bounds: new Bounds(+m[2], +m[3], +m[4], +m[5])
        });
    }
    return out;
}
const layers = parse(passBlock, 8).concat(parse(frameBlock, 12));
check('simulation loaded all 9 layers', layers.length === 9, layers.length + ' parsed');

const PAD = parseFloat((sat60.match(/SAT60_VIEWPORT_PAD\s*=\s*([\d.]+)/) || [])[1]);
check('SAT60_VIEWPORT_PAD is a sane fraction', PAD > 0 && PAD < 1, String(PAD));

// Reimplementation of the shipped predicate (kept in step with the source
// strings asserted in section 4).
function activeAt(view, zoom) {
    const padded = view.pad(PAD);
    return layers.filter(function (l) {
        return zoom >= (l.options.minZoom || 0) &&
            (!l._sat60Bounds || l._sat60Bounds.intersects(padded));
    }).map(function (l) { return l.name; });
}

// Romania overview, below every min zoom → nothing attached, nothing fetched.
const overview = new Bounds(43.5, 19.5, 48.5, 30.5);
check('at z6 (overview) no CORONA layer is attached',
    activeAt(overview, 6).length === 0, activeAt(overview, 6).join(','));

// Bucharest at z10: pass mosaics only, and only those covering the city.
const bucharest = new Bounds(44.35, 25.95, 44.55, 26.25);
const buchZ10 = activeAt(bucharest, 10);
check('at z10 over Bucharest only pass mosaics are attached',
    buchZ10.length > 0 && buchZ10.every(function (n) { return !/df\d+$/.test(n); }),
    buchZ10.join(','));
check('at z10 over Bucharest fewer than all 9 layers are attached',
    buchZ10.length < 9, buchZ10.length + ' of 9');
check('at z10 the Transylvania-only frames are NOT attached',
    buchZ10.indexOf('corona:1104-2155df004') === -1);

// Transylvania at z13: the frames that really cover it come in.
const transylvania = new Bounds(46.50, 22.80, 46.66, 23.00);
const transZ13 = activeAt(transylvania, 13);
check('at z13 over Transylvania the verified frame is attached',
    transZ13.indexOf('corona:1104-2155df004') !== -1, transZ13.join(','));
check('at z13 over Transylvania the Muntenia-only passes are dropped',
    transZ13.indexOf('corona:1103-1058Aft') === -1, transZ13.join(','));

// The imagery the user can see must never be dropped: at any zoom/place, a
// layer whose footprint covers the viewport centre is attached.
let coverageOk = true;
let coverageDetail = '';
[[46.58, 22.90, 13], [44.43, 26.10, 12], [44.42, 25.42, 10], [45.60, 22.00, 9]].forEach(function (t) {
    const v = new Bounds(t[0] - 0.05, t[1] - 0.05, t[0] + 0.05, t[1] + 0.05);
    const active = activeAt(v, t[2]);
    const covering = layers.filter(function (l) {
        return t[2] >= l.options.minZoom && l._sat60Bounds.intersects(v);
    }).map(function (l) { return l.name; });
    covering.forEach(function (n) {
        if (active.indexOf(n) === -1) {
            coverageOk = false;
            coverageDetail += ' missing ' + n + ' at ' + t.join('/');
        }
    });
});
check('every layer whose footprint covers the view stays attached', coverageOk, coverageDetail);

// The padding must make the attached set a superset of the strictly-visible
// set, so a drag never uncovers an area before moveend re-syncs.
const strict = layers.filter(function (l) {
    return 12 >= l.options.minZoom && l._sat60Bounds.intersects(transylvania);
}).map(function (l) { return l.name; });
const padded = activeAt(transylvania, 12);
check('padded selection is a superset of the strictly visible selection',
    strict.every(function (n) { return padded.indexOf(n) !== -1; }),
    strict.join(',') + ' vs ' + padded.join(','));

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n' + (checks - failures) + '/' + checks + ' checks passed');
if (failures > 0) {
    console.error(failures + ' FAILED');
    process.exit(1);
}
console.log('All satellite-60s mobile-crash checks passed.');
