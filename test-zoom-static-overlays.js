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
    /map\.project\(L\.latLng\(latlng\.lat,\s*latlng\.lng\s*\+\s*lngDelta\),\s*zoom\)/,
    'heritage radius in pixels must be projected unrounded so no whole-pixel rounding is baked into a bitmap the zoom animation scales'
);
assert.match(
    mapApp,
    /_getNewPixelOrigin\(center,\s*zoom\)/,
    'heritage zoomanim transform must use Leaflet\'s _getNewPixelOrigin (same math as L.Renderer)'
);
assert.match(
    mapApp,
    /_canvasAnchor = L\.point\(map\.getPixelOrigin\(\)\)\.add\(topLeft\)/,
    'heritage canvases must scale around the exact bitmap anchor (rounded pixel origin) instead of the unrounded projection'
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

// ── Archeological potential: candidate circles at lat/lng ────────────
assert.match(
    archeo,
    /L\.circle\(\s*\[\s*c\.lat\s*,\s*c\.lng\s*\]/,
    'archeo candidates must be L.circle at the candidate lat/lng'
);
// The layer now scores a dense grid instead of a few 300 m candidates, and the
// bubbles are a sparse selection of that grid. Each bubble still takes its
// radius in METRES (its own radiusM, capped by the free ground around it), so
// every bubble stays glued to its geography while zooming.
assert.match(
    archeo,
    /var bubbles = field\.bubbles \|\| \[\];/,
    'archeo bubbles must come from the scored field selection'
);
assert.match(
    archeo,
    /radius:\s*c\.radiusM,/,
    'archeo bubbles must use that metre radius so they stay geographically static while zooming'
);
// The heatmap is no longer leaflet-heat (pixel-radius blobs that slid on zoom):
// it is a score raster drawn between the geographic corners of the grid, so it
// cannot drift while zooming either.
assert.match(
    archeo,
    /var nw = layerPointUnrounded\(map, \{ lat: bbox\.maxLat, lng: bbox\.minLng \}\);/,
    'the heat surface must be drawn between the geographic corners of the grid'
);
assert.ok(
    !/L\.heatLayer\(/.test(archeo),
    'the archeo layer must not fall back to pixel-radius leaflet-heat blobs'
);
assert.match(
    archeo,
    /function bubbleBaseRadiusM\(radiusM\) \{/,
    'the bubble base radius is a metre value derived from the analysis radius (no pixel radii)'
);
assert.match(
    archeo,
    /var radius = Math\.min\(baseR, Math\.floor\(cells\[k\]\.clearance - maskGap\)\);/,
    'each bubble radius stays in metres, limited by the free ground around it'
);
assert.match(
    archeo,
    /radius:\s*siteRadius,/,
    'the red heritage protection rings must also be metre circles'
);
assert.match(
    archeo,
    /L\.circle\(\s*\[\s*ctx\.centerLat\s*,\s*ctx\.centerLng\s*\]/,
    'archeo working-area circle must be locked to the analysis centre'
);

console.log('✅ ALL ZOOM-STATIC OVERLAY TESTS PASSED');
