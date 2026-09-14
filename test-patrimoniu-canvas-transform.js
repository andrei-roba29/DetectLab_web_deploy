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
assert.match(transform, /L\.point\(_canvasAnchor\)\.multiplyBy\(scale\)/,
    'zoom transform scales the exact bitmap anchor recorded by the redraw');
assert(!/map\.project\(_canvasCenter/.test(transform),
    'zoom transform must NOT scale around the unrounded project(_canvasCenter) that ' +
    'L.Renderer uses: the bitmap is anchored to the rounded pixel origin, so that ' +
    'difference is amplified by the zoom scale and shows up as a slide');
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
assert.match(redraw, /var topLeft = map\.containerPointToLayerPoint\(\[0, 0\]\);[\s\S]*_canvasAnchor = L\.point\(map\.getPixelOrigin\(\)\)\.add\(topLeft\);/,
    'the redraw records the project-space anchor of bitmap pixel (0,0)');
assert.match(redraw, /var radiusPoint = _layerPointUnrounded\(radiusLatLng\)/,
    'radius centers are projected without per-point integer rounding');
assert.match(siteRedraw, /var point = _layerPointUnrounded\(ll\)/,
    'pins and cluster bubbles are projected without per-point integer rounding');
assert.match(source, /function _layerPointUnrounded\(latlng, zoom\)\s*\{[\s\S]*map\.project\(latlng, zoom == null \? map\.getZoom\(\) : zoom\)[\s\S]*\.subtract\(map\.getPixelOrigin\(\)\)/,
    'the unrounded helper exists and subtracts the same (rounded) pixel origin the element is positioned with');
assert(!/map\.latLngToLayerPoint\(/.test(siteRedraw),
    'the pin/bubble pass must not fall back to the rounded helper');
assert(!/map\.latLngToLayerPoint\(/.test(redraw),
    'the radius pass must not fall back to the rounded helper');
assert.match(source, /var p0 = map\.project\(latlng, zoom\)[\s\S]*var p1 = map\.project\(L\.latLng\(latlng\.lat, latlng\.lng \+ lngDelta\), zoom\)/,
    'metres-per-pixel is measured between two unrounded projections (no whole-pixel rounding baked into the bitmap)');

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


// ── Numeric model of the residual slide ─────────────────────────────────────
// Canvas bitmap content of a site was anchored to the ROUNDED pixel origin
// (latLngToLayerPoint rounds every point) while the old transform scaled the
// UNROUNDED project(_canvasCenter, zoom).  The difference between the two
// origins is a fixed sub-pixel offset in bitmap space which the zoom scale
// multiplies — the "pins still slide a little while zooming" report.
//
//   bitmap position of a site : b   = round(u0) - anchor0      (anchor0 = rounded)
//   old offset                : o   = s * A0 - origin1         (A0    = unrounded)
//   old viewport position     : s * A0 - origin1 + s * b
//   geographic position       : s * u0 - origin1
//   error                     : s * ((round(u0) - u0) + (A0 - round(A0)))
//
// The new offset scales anchor0 instead, so the anchor terms cancel exactly.
function viewportPosition(strategy, s, u0, A0, origin1) {
    const anchor0 = Math.round(A0);            // getPixelOrigin() + topLeft (rounded)
    if (strategy === 'anchor') {
        // post-fix: bitmap drawn from the unrounded projection, element/scaled
        // origin is the exact anchor -> scale * anchor0 - origin1 + s * (u0 - anchor0)
        const b = u0 - anchor0;
        return (anchor0 * s - origin1) + s * b;
    }
    // pre-fix: bitmap drawn on Leaflet's rounded pixel grid, transform anchored
    // on the unrounded centre (L.Renderer style)
    const b = Math.round(u0) - anchor0;
    return (A0 * s - origin1) + s * b;
}

const scenarios = [
    { from: 6, to: 7 }, { from: 7, to: 8 }, { from: 10, to: 11 },
    { from: 11, to: 14 }, { from: 13, to: 14 }
];

let worstOld = 0;
let worstNew = 0;
for (const { from, to } of scenarios) {
    const s = Math.pow(2, to - from);
    for (let i = 0; i < 250; i++) {
        // deterministic pseudo-random fractional origins/positions
        const rnd = (k) => (Math.sin(i * 12.9898 + k * 78.233 + from * 3.7) * 43758.5453) % 1;
        const u0 = 100000.5 + 3000 * (0.5 + rnd(1));
        const origin0 = Math.round(u0 - 200);
        const A0 = origin0 + 0.5 * rnd(2);
        const origin1 = Math.round(origin0 * s);
        const truth = u0 * s - origin1;
        const oldPos = viewportPosition('old', s, u0, A0, origin1);
        const newPos = viewportPosition('anchor', s, u0, A0, origin1);
        worstOld = Math.max(worstOld, Math.abs(oldPos - truth));
        worstNew = Math.max(worstNew, Math.abs(newPos - truth));
    }
}
assert(worstOld > 1,
    'model sanity: the unrounded-centre transform must show the scale-amplified rounding error');
assert(worstNew < 1e-9,
    'the anchor-based transform must land exactly on the geographic position at every scale');
console.log(`    · pre-fix worst simulated slide ${worstOld.toFixed(2)} px ` +
    `(up to one bitmap pixel × zoom scale), post-fix ${worstNew.toExponential(1)} px`);

console.log('✓ Patrimoniu canvas transform / double-displacement regression tests passed');
