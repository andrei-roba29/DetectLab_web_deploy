// Regression test: turning the detection switch ON must not make map events
// (and every other marker) unclickable — and the breakage must not survive
// turning the switch back OFF.
//
// Background / root cause
// -----------------------
// window.toggleDetection(true) auto-enables the heritage layer:
//
//     var heritageChk = document.querySelector('input[onchange*="togglePatrimoniuLayer"]');
//     if (heritageChk && !heritageChk.checked) heritageChk.click();
//
// togglePatrimoniuLayer(true) adds patrimoniuLayer, whose features are drawn by
// an L.canvas renderer pinned to pane_patrimoniu. An L.canvas renderer is ONE
// <canvas> element sized to the whole viewport (Renderer._update sizes it to
// the map size plus padding), NOT one element per feature.
//
// Leaflet's stylesheet neutralises pointer events for `.leaflet-pane > svg path`
// but has NO equivalent rule for `.leaflet-pane > canvas`:
//
//     .leaflet-marker-icon, .leaflet-pane > svg path, … { pointer-events: none }
//     .leaflet-pane > svg path.leaflet-interactive, …   { pointer-events: auto }
//
// pane_patrimoniu sits at z-index 620 — ABOVE the marker pane (600) where the
// Events warrior-helmet markers live (js/events.js uses a plain L.layerGroup,
// so its markers land in the default markerPane). With pointer events left on,
// that viewport-sized canvas won the browser hit test over the entire map, so
// no marker underneath it could be clicked.
//
// It persisted after switching detection OFF because toggleDetection(false)
// never turns the heritage layer back off — the canvas simply stayed on top.
//
// The same trap is documented at length in js/lidar-scanner.js (PANE_CIRCLES is
// declared pointer-events:none for exactly this reason), and every other
// full-viewport surface in js/map-app.js above the markers already sets
// pointerEvents = 'none'.
//
// Run: node test-detect-events-clickable.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const eventsJs = fs.readFileSync(path.join(__dirname, 'js/events.js'), 'utf8');
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

// ── 0. Confirm the premises the bug rests on are still true ──────────────────

// Leaflet only makes SVG paths click-transparent, never canvases. If a future
// Leaflet upgrade adds a canvas rule, the pane fix stays correct but this test's
// reasoning should be revisited.
check(
    '0. Leaflet CSS neutralises `.leaflet-pane > svg path` but not `> canvas`',
    /\.leaflet-pane\s*>\s*svg\s+path\s*,/.test(leafletCss) &&
    !/\.leaflet-pane\s*>\s*canvas\s*\{[^}]*pointer-events\s*:\s*none/.test(leafletCss)
);

// Events markers use a plain layerGroup → Leaflet's default markerPane (600).
check(
    '0. events.js markers land in the default marker pane (no explicit pane)',
    /eventsLayer\s*=\s*L\.layerGroup\(\)\.addTo\(map\)/.test(eventsJs) &&
    /L\.marker\(\[ev\.latitude,\s*ev\.longitude\],\s*\{\s*icon:\s*icon\s*\}\)/.test(eventsJs)
);

// Detection really does force the heritage layer on.
check(
    '0. toggleDetection(true) auto-enables the heritage layer',
    /heritageChk\.click\(\);\s*\/\/\s*triggers togglePatrimoniuLayer\(true\)/.test(mapApp)
);

// Originally toggleDetection(false) never turned the heritage layer back off,
// which is why the breakage outlived the switch. That asymmetry is fixed
// separately (see test-detect-toggle-symmetry.js), but the pane fix below is
// still load-bearing: while detection is ON the heritage layer is ON by design,
// so its canvas must not block clicks in the first place. Restoring state on the
// way out is not a substitute for that.
const toggleDetectionBody = mapApp.slice(
    mapApp.indexOf('window.toggleDetection = function (on) {'),
    mapApp.indexOf('window.dismissSiteAlert')
);
assert(toggleDetectionBody.length > 0, 'could not locate toggleDetection in js/map-app.js');
check(
    '0. detection still force-enables the heritage layer while ON, so the pane fix is required',
    /heritageChk\.click\(\)/.test(toggleDetectionBody) &&
    /togglePatrimoniuLayer\(false\)/.test(toggleDetectionBody)  // and cleans up on the way OFF
);

// ── 1. Parse the pane / renderer wiring out of map-app.js ────────────────────

const paneZ = {};
for (const m of mapApp.matchAll(/getPane\(["'](\w+)["']\)\.style\.zIndex\s*=\s*(\d+)/g)) {
    paneZ[m[1]] = Number(m[2]);
}
const panesWithoutPointerEvents = new Set();
for (const m of mapApp.matchAll(/getPane\(["'](\w+)["']\)\.style\.pointerEvents\s*=\s*["']none["']/g)) {
    panesWithoutPointerEvents.add(m[1]);
}

// Every pane hosting an L.canvas renderer holds a viewport-sized <canvas>.
const canvasRendererPanes = new Set();
for (const m of mapApp.matchAll(/L\.canvas\(\{\s*pane:\s*["'](\w+)["']/g)) {
    canvasRendererPanes.add(m[1]);
}

check(
    '1. the heritage layer still renders through an L.canvas renderer on pane_patrimoniu',
    canvasRendererPanes.has('pane_patrimoniu')
);

const MARKER_PANE_Z = 600; // Leaflet's .leaflet-marker-pane — where event markers live

// ── 2. THE REGRESSION ────────────────────────────────────────────────────────
// No canvas-renderer pane painted above the markers may keep pointer events,
// or it swallows every click over the whole viewport.

for (const pane of canvasRendererPanes) {
    const z = paneZ[pane];
    assert(Number.isFinite(z), 'pane ' + pane + ' has no numeric z-index in map-app.js');
    if (z <= MARKER_PANE_Z) continue;
    check(
        '2. canvas-renderer pane "' + pane + '" (z=' + z + ', above markerPane ' +
        MARKER_PANE_Z + ') is click-transparent',
        panesWithoutPointerEvents.has(pane)
    );
}

// Guard the whole class of bug, not just this one pane: any full-viewport
// surface above the markers must be click-transparent.
const displayCanvasDecl = mapApp.match(/_displayCanvas\.style\.cssText\s*=\s*'([^']+)'/);
assert(displayCanvasDecl, 'could not find the radius display canvas declaration');
check(
    '2. the always-on radius canvas is click-transparent too',
    /pointer-events:\s*none/.test(displayCanvasDecl[1])
);

// ── 3. Heritage features must STILL be clickable ─────────────────────────────
// A click-transparent renderer canvas never receives the DOM click Leaflet's
// canvas renderer uses to dispatch feature events, so map-app.js has to run the
// hit test itself. Losing heritage popups would just trade one bug for another.

check(
    '3. heritage features expose a hit-test callback instead of a dead DOM click handler',
    /_dlHeritageHit\s*=\s*function/.test(mapApp)
);
check(
    '3. a map-level hit test dispatches heritage clicks',
    /_containsPoint\(point\)/.test(mapApp) && /hit\._dlHeritageHit\(e\.latlng\)/.test(mapApp)
);
check(
    '3. the hit test is skipped while the heritage layer is off',
    /if\s*\(!map\.hasLayer\(patrimoniuLayer\)\)\s*return;/.test(mapApp)
);
check(
    '3. the hit test keeps the LAST match (the feature painted on top), like Canvas._onClick',
    /hit\s*=\s*layer;\s*\/\/\s*keep the last match/.test(mapApp)
);
// The app is installed as a PWA, so the pan guard must not rely on mousedown
// coordinates (which touch input never sets) — use Leaflet's own drag check.
check(
    '3. the hit test ignores the click that ends a pan, touch-safely',
    /map\._draggableMoved\(map\)\)\s*return;/.test(mapApp) &&
    !/_mdX[\s\S]{0,400}hit\._dlHeritageHit/.test(mapApp)
);
// Registering on the map means Leaflet only calls us when the click did not
// already land on an interactive layer — markers keep priority over heritage dots.
check(
    '3. no heritage feature re-registers a per-feature DOM click on the dead canvas',
    !/showLocalPopup\(lid, f\.properties, e\.latlng\)/.test(mapApp) &&
    !/showLocalPopup\(6, f\.properties, e\.latlng\)/.test(mapApp)
);

// ── 4. Behavioural simulation of the browser hit test ────────────────────────
// Model what the browser does on a click at the event marker's position: walk
// the paint order from the top and stop at the first element that accepts
// pointer events. Before the fix the heritage canvas won; now the marker does.

function topmostHitAt(surfaces) {
    return surfaces
        .filter(s => s.acceptsPointerEvents && s.coversPoint)
        .sort((a, b) => b.z - a.z)[0];
}

const heritageCanvasZ = paneZ['pane_patrimoniu'];

// Detection ON → heritage layer on → its viewport-sized canvas is on the map.
const withDetectionOn = [
    { name: 'event marker', z: MARKER_PANE_Z, coversPoint: true, acceptsPointerEvents: true },
    {
        name: 'heritage renderer canvas',
        z: heritageCanvasZ,
        coversPoint: true, // viewport-sized: covers every point on the map
        acceptsPointerEvents: !panesWithoutPointerEvents.has('pane_patrimoniu')
    }
];
check(
    '4. with detection ON, a click on an event marker reaches the marker',
    topmostHitAt(withDetectionOn).name === 'event marker'
);

// Detection switched back OFF: the heritage layer is deliberately left on
// (toggleDetection(false) does not undo it), so the canvas is still there.
check(
    '4. after detection is switched OFF again, event markers stay clickable',
    topmostHitAt(withDetectionOn).name === 'event marker'
);

// And the pre-fix arrangement really did break — proving the test can fail.
const preFix = [
    { name: 'event marker', z: MARKER_PANE_Z, coversPoint: true, acceptsPointerEvents: true },
    { name: 'heritage renderer canvas', z: heritageCanvasZ, coversPoint: true, acceptsPointerEvents: true }
];
check(
    '4. sanity: the old pointer-events-enabled canvas did swallow the click',
    topmostHitAt(preFix).name === 'heritage renderer canvas'
);

console.log('\n' + passed + ' checks passed.');
if (process.exitCode) console.error('SOME CHECKS FAILED');
