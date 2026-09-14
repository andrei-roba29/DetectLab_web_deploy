#!/usr/bin/env node
'use strict';

// Regression test for the custom Heritage canvases.  Both surfaces are direct
// children of Leaflet's map pane and use the same L.Canvas-style contract:
// draw layer points after compensating for the canvas top-left, use the
// Renderer transform only during zoomanim, and reset the transform before the
// next settled redraw.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');

function between(start, end) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert(from >= 0, `missing ${start}`);
    assert(to > from, `missing ${end}`);
    return source.slice(from, to);
}

const transform = between('function _updateCanvasTransform(center, zoom)', 'function _redrawHeritageSites');
const redraw = between('function _redrawAll()', 'function _metersToPixels');
const siteRedraw = between('function _redrawHeritageSites()', 'function _redrawAll()');

assert.match(source, /_displayCanvas\.className\s*=\s*['"]leaflet-zoom-animated['"]/,
    'radius canvas remains eligible for Leaflet zoom animation');
assert.match(source, /_sitesCanvas\.className\s*=\s*['"]leaflet-zoom-animated['"]/,
    'site canvas remains eligible for Leaflet zoom animation');
assert.match(source, /_mapPane\.appendChild\(_displayCanvas\)/,
    'radius canvas is attached to the map pane');
assert.match(source, /_mapPane\.appendChild\(_sitesCanvas\)/,
    'site canvas is attached to the map pane');

assert.match(transform, /map\.getZoomScale\(zoom,\s*_canvasZoom\)/,
    'zoom scale is relative to the last settled canvas frame');
assert.match(transform, /map\._getNewPixelOrigin\(center,\s*zoom\)/,
    'zoom transform uses Leaflet pixel-origin math');
assert(!/containerPointToLayerPoint/.test(transform),
    'zoom transform does not mix container-to-layer conversion into renderer math');
assert.match(transform, /L\.DomUtil\.setTransform\(_displayCanvas,\s*topLeftOffset,\s*scale\)/,
    'radius canvas gets exactly the renderer-style zoom transform');
assert.match(transform, /L\.DomUtil\.setTransform\(_sitesCanvas,\s*topLeftOffset,\s*scale\)/,
    'site canvas gets exactly the renderer-style zoom transform');

assert.match(redraw, /var topLeft = map\.containerPointToLayerPoint\(\[0, 0\]\)/,
    'settled canvas origin is calculated once in layer-point space');
assert.match(redraw,
    /L\.DomUtil\.setPosition\(_displayCanvas,\s*topLeft\);[\s\S]*L\.DomUtil\.setPosition\(_sitesCanvas,\s*topLeft\);/,
    'settled redraw resets both canvases, clearing any zoomanim transform');
assert.match(siteRedraw, /ctx\.translate\(-topLeft\.x,\s*-topLeft\.y\)/,
    'site pixels compensate for the same canvas top-left used by the element');
assert.match(redraw, /ctx\.translate\(-topLeft\.x,\s*-topLeft\.y\)/,
    'radius pixels compensate for the same canvas top-left used by the element');
assert.match(redraw, /map\.latLngToLayerPoint\(radiusLatLng\)/,
    'radius centers stay in geographic layer-point coordinates');
assert.match(siteRedraw, /map\.latLngToLayerPoint\(ll\)/,
    'pins and cluster bubbles stay in geographic layer-point coordinates');

// Small coordinate model of the bug fixed above.  With a map-pane pan P, a
// geographic point has layer coordinate G-P and the canvas origin is -P.
// Positioning the canvas at -P gives viewport coordinate G. Leaving it at 0
// adds P a second time — exactly the baseline drift seen after pan/zoom.
function renderedPoint(G, P, canvasPosition) {
    const topLeft = { x: -P.x, y: -P.y };
    const layerPoint = { x: G.x - P.x, y: G.y - P.y };
    const local = { x: layerPoint.x - topLeft.x, y: layerPoint.y - topLeft.y };
    return {
        x: P.x + canvasPosition.x + local.x,
        y: P.y + canvasPosition.y + local.y
    };
}

const G = { x: 600, y: 400 };
const P = { x: 37, y: -19 };
assert.deepStrictEqual(renderedPoint(G, P, { x: -P.x, y: -P.y }), G,
    'a positioned canvas keeps a site fixed after pan');
assert.notDeepStrictEqual(renderedPoint(G, P, { x: 0, y: 0 }), G,
    'the old unpositioned site canvas reproduces the double-pan drift');

console.log('✓ Patrimoniu canvas transform / double-displacement regression tests passed');
