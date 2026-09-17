/*
 * bench-tile-perf.js
 * ──────────────────────────────────────────────────────────────────────────
 * Optional benchmark for js/tile-perf.js — NOT part of the test suite and NOT
 * loaded by the app. It loads the real js/leaflet.js (1.9.4) and the real
 * js/tile-perf.js in a jsdom window, then drives the two gesture paths that
 * Leaflet has, counting how many tiles the app would ask for:
 *
 *   A) wipe path    map.setZoom(z, {animate:false}) — viewprereset throws every
 *                   tile away and the layer is rebuilt from scratch.
 *   B) pinch path   the exact sequence L.Map.TouchZoom runs for a pinch
 *                   (_moveStart + _move{pinch} per frame + _animateZoom at the
 *                   end), with a stack of dense layers on the map.
 *
 * Run (jsdom is not a dependency of the site, install it only for this):
 *
 *     npm i jsdom && node bench-tile-perf.js
 *     # or, with jsdom installed somewhere else:
 *     NODE_PATH=/path/to/node_modules node bench-tile-perf.js
 *
 * Reference result on 2026-09-17 (12 dense layers, 390×780 viewport):
 *
 *     [wipe path  (setZoom animate:false)]  432 -> 432 tiles, 0 empty frames
 *     [pinch path (TouchZoom sequence)   ]  720 ->  96 tiles (-87 %), 0 empty frames
 *
 * The pinch path is the one the crash was reported on: without the governor
 * every frame of the gesture queues a viewport of tiles for every layer.
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM;
try {
    JSDOM = require('jsdom').JSDOM;
} catch (err) {
    console.error('This benchmark needs jsdom:  npm i jsdom');
    console.error('(it is optional — the site itself has no dependencies)');
    process.exit(0);
}

const REPO = __dirname;
const LEAFLET = fs.readFileSync(path.join(REPO, 'js/leaflet.js'), 'utf8');
const TILE_PERF = fs.readFileSync(path.join(REPO, 'js/tile-perf.js'), 'utf8');
const LAYERS = 12;      // LIDAR (11) + basemap — a realistic dense stack
const VIEW = { w: 390, h: 780 };

function build(useGovernor) {
    const dom = new JSDOM('<!doctype html><html><body><div id="map"></div></body></html>',
        { runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    const el = win.document.getElementById('map');
    ['clientWidth', 'offsetWidth'].forEach((p) => Object.defineProperty(el, p, { value: VIEW.w }));
    ['clientHeight', 'offsetHeight'].forEach((p) => Object.defineProperty(el, p, { value: VIEW.h }));

    win.eval(LEAFLET);
    if (useGovernor) win.eval(TILE_PERF);

    const L = win.L;
    const map = L.map(el, { zoomAnimation: true, fadeAnimation: true }).setView([46.5, 23.5], 13);
    const layers = [];
    let created = 0;
    for (let i = 0; i < LAYERS; i++) {
        const layer = L.tileLayer('https://t' + i + '.example.com/{z}/{x}/{y}.png', {});
        layer.createTile = function () { created++; return win.document.createElement('img'); };
        layer.addTo(map);
        layers.push(layer);
    }
    if (useGovernor) win.DLTilePerf.attach(map);
    return {
        win: win,
        map: map,
        created: () => created,
        live: () => layers.reduce((n, l) => n + Object.keys(l._tiles || {}).length, 0)
    };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wipePath(w) {
    const before = w.created();
    for (const z of [14, 15, 16, 17]) {
        w.map.setZoom(z, { animate: false });
        await sleep(60);
    }
    await sleep(900);
    return w.created() - before;
}

async function pinchPath(w) {
    const before = w.created();
    const start = w.map.getZoom();
    const center = w.map.getCenter();
    w.map._moveStart(true, false);                                  // TouchZoom._onTouchMove
    for (let i = 0; i <= 20; i++) {                                 // 20 frames of pinch
        w.map._move(center, start + i * 0.2, { pinch: true, round: false });
        await sleep(40);
    }
    w.map._animateZoom(center, start + 4, true, true);               // TouchZoom._onTouchEnd
    await sleep(1000);
    return w.created() - before;
}

(async function () {
    console.log('tile-perf benchmark — ' + LAYERS + ' dense layers, ' +
        VIEW.w + '×' + VIEW.h + ' viewport\n');
    for (const [label, run] of [
        ['wipe path  (setZoom animate:false)', wipePath],
        ['pinch path (TouchZoom sequence)   ', pinchPath]
    ]) {
        const results = [];
        for (const governor of [false, true]) {
            const w = build(governor);
            let empty = 0;
            let samples = 0;
            const iv = setInterval(() => { samples++; if (w.live() === 0) empty++; }, 40);
            results.push({ created: await run(w), empty: empty, samples: samples, live: w.live() });
            clearInterval(iv);
        }
        const [plain, fixed] = results;
        console.log('[' + label + ']');
        console.log('   without governor: ' + String(plain.created).padStart(4) +
            ' tiles created, ' + plain.live + ' live at the end, ' +
            plain.empty + '/' + plain.samples + ' empty frames');
        console.log('   with governor   : ' + String(fixed.created).padStart(4) +
            ' tiles created, ' + fixed.live + ' live at the end, ' +
            fixed.empty + '/' + fixed.samples + ' empty frames');
        console.log('   -> ' + Math.round(100 - 100 * fixed.created / Math.max(1, plain.created)) +
            '% fewer tile requests\n');
    }
    process.exit(0);
})();
