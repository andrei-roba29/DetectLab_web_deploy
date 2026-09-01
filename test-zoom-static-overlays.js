// Source-level tests: heritage radii, LIDAR scanner overlays and
// archeological-potential circles must stay glued to their lat/lng
// while the map zooms. A viewport-sized canvas that redraws at the
// *target* zoom mid-animation (or a map pane whose transform-origin
// is not 0 0) makes every dot slide off its site.
// Usage: node test-zoom-static-overlays.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
    return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

const mapApp = read('js/map-app.js');
const mapRotate = read('js/map-rotate.js');
const lidar = read('js/lidar-scanner.js');
const archeo = read('js/archeo-potential.js');
const battles = read('js/battles-layer.js');
const css = read('css/styles.css');

console.log('[Test] Overlay zoom-lock (heritage / LIDAR / archeo)...');

// ── Heritage 600 m canvas ────────────────────────────────────────────
assert.match(
    mapApp,
    /_displayCanvas\.className\s*=\s*['\"]leaflet-zoom-animated['\"]/,
    'heritage radius canvas must be leaflet-zoom-animated so it CSS-scales with the map'
);
assert.match(
    mapApp,
    /map\.on\(\s*['\"]zoomanim['\"]/,
    'heritage canvas must listen to zoomanim (same hook as L.Renderer)'
);
assert.match(
    mapApp,
    /function _updateCanvasTransform/,
    'heritage canvas must implement a Renderer-style _updateCanvasTransform'
);
assert.match(
    mapApp,
    /if\s*\(\s*map\._animatingZoom\s*\)\s*return/,
    'heritage _redrawAll must not repaint at the target zoom while CSS zoom is in flight'
);
assert.match(
    mapApp,
    /latLngToLayerPoint\(L\.latLng\(latlng\.lat,\s*latlng\.lng\s*\+\s*lngDelta\)\)/,
    'heritage radius in pixels must be derived from latLngToLayerPoint so it cannot drift from the site'
);
assert.match(
    mapApp,
    /_getNewPixelOrigin\(center,\s*zoom\)/,
    'heritage zoomanim transform must use Leaflet\'s _getNewPixelOrigin (same math as L.Renderer)'
);
assert.match(
    css,
    /canvas\.leaflet-zoom-animated\s*\{[\s\S]*transform-origin:\s*0\s+0/,
    'heritage radius canvas must keep transform-origin 0 0 during zoom'
);

// ── Map rotation must not steal the zoom-animation origin ────────────
assert.match(
    mapRotate,
    /transformOrigin\s*=\s*['\"]0px 0px['\"]/,
    'unrotated map pane must pin transform-origin at 0 0'
);
assert.match(
    mapRotate,
    /if\s*\(\s*!this\._animatingZoom\s*\)/,
    'rotated origin must stay frozen for the duration of a CSS zoom'
);

// ── LIDAR scanner: geographic circles + tags anchored on the site ──
assert.match(
    lidar,
    /L\.circle\(\s*\[\s*p\.lat\s*,\s*p\.lng\s*\]/,
    'LIDAR result rings must be L.circle at the site lat/lng (metre radius, zooms with the map)'
);
assert.match(
    lidar,
    /L\.circle\(\s*ll\s*,\s*circleOptions\)/,
    'LIDAR search radius must be an L.circle locked to the search point'
);
assert.match(
    lidar,
    /RESULT_LABEL_OFFSET\s*=\s*\[\s*0\s*,\s*-14\s*\]/,
    'LIDAR result tags must use a small pixel offset so they do not drift from the site when zooming'
);
assert.match(
    lidar,
    /bindTooltip\([\s\S]*assignPane\(\{[\s\S]*permanent:\s*true/,
    'LIDAR result tags must be permanent tooltips (Leaflet repositions them on zoomanim)'
);

// ── Battles: title tags glued to their circle, without a snap ─────────
// Raw <div>s in a custom pane are NOT touched by Leaflet's zoom animation,
// so they used to sit still for the 250 ms CSS zoom and then jump — the
// "tags keep moving when I zoom" complaint. They must be zoom-animated like
// L.Marker (class + zoomanim target transform), and the rise above the point
// must be clamped: a 9–26 km radius doubles in pixels at every zoom level.
assert.match(
    battles,
    /className = 'battles-label leaflet-zoom-animated'/,
    'battle title tags must carry leaflet-zoom-animated (constant size + the 0.25s transform transition)'
);
assert.match(
    battles,
    /map\.on\('zoomanim'/,
    'battle tags must be repositioned on zoomanim, not only on zoomend'
);
assert.match(
    battles,
    /if \(map\._animatingZoom\) placeLabels\(e\.zoom, e\.center\)/,
    'battle tags must be written once, at the target zoom, while the CSS zoom is in flight'
);
assert.match(
    battles,
    /map\._latLngToNewLayerPoint\(latlng, zoom, center\)/,
    'battle tag anchor must use the Renderer/Marker target-layer-point maths so zoomend cannot snap'
);
assert.match(
    battles,
    /Math\.min\(rMeters \* ppm \+ LABEL_GAP, LABEL_MAX_RISE \+ LABEL_GAP\)/,
    'battle tag rise must be clamped so the tag never flies away with the growing radius'
);
assert.match(
    battles,
    /map\.on\('moveend zoomend resize viewreset zoom'/,
    'battle tags must also follow pinch-zoom (continuous zoom events)'
);
assert.match(
    css,
    /\.battles-label\s*\{[\s\S]*?transform-origin:\s*0 0/,
    'battle tags must keep transform-origin 0 0 (same contract as .leaflet-zoom-animated)'
);

// ── Archeological potential: candidate circles at lat/lng ────────────
assert.match(
    archeo,
    /L\.circle\(\s*\[\s*c\.lat\s*,\s*c\.lng\s*\]/,
    'archeo candidates must be L.circle at the candidate lat/lng'
);
assert.match(
    archeo,
    /radius:\s*CONFIG\.CANDIDATE_RADIUS_M/,
    'archeo candidates must use a metre radius so they stay geographically static while zooming'
);
assert.match(
    archeo,
    /L\.circle\(\s*\[\s*ctx\.centerLat\s*,\s*ctx\.centerLng\s*\]/,
    'archeo working-area circle must be locked to the analysis centre'
);

console.log('✅ ALL ZOOM-STATIC OVERLAY TESTS PASSED');
