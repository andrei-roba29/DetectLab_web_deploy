// Instrument de diagnostic pentru „Zone cu potențial arheologic": rulează câmpul
// de scor pe un scenariu sintetic (4 clustere de situri + raster UAT cu jumătate
// din fiecare tile „intravilan") și raportează cât de plin e canvas-ul de bule,
// distribuția razelor și unde se pierd celulele libere.
//
// Uz: node bench-archeo-coverage.js [razaKm] [lat] [lng] [jsonOverrides] [uatMode]
// uatMode: 'ok' (implicit) | 'unreadable' | 'missing' — cele din urmă simulează
// CORS/404 pe rasterul UAT, ca să vedem că analiza nu mai rămâne goală.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const radiusKm = Number(process.argv[2] || 10);
// Suprascrieri de configurare pentru explorarea parametrilor de împachetare:
//   node bench-archeo-coverage.js 10 '{"GAP_M":70,"MASK_CLEARANCE_M":20}'
const centerLat = Number(process.argv[3] || 46.8);
const centerLng = Number(process.argv[4] || 23.6);
const overrides = process.argv[5] ? JSON.parse(process.argv[5]) : null;
const uatMode = process.argv[6] || 'ok';

const sandbox = {
    console,
    performance: { now: () => Date.now() },
    setTimeout, clearTimeout, Promise, Math, JSON, isFinite, isNaN, Date,
    document: {
        readyState: 'complete',
        addEventListener() {},
        getElementById: () => null,
        createElement(tag) {
            if (tag !== 'canvas') return { style: {} };
            const canvas = {
                tagName: 'CANVAS', width: 0, height: 0, style: {}, className: '',
                draws: [], ops: [],
                getContext() {
                    return {
                        globalAlpha: 1, imageSmoothingEnabled: false,
                        createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
                        putImageData() {}, clearRect() {}, drawImage() {}, save() {}, restore() {}
                    };
                }
            };
            return canvas;
        }
    },
    window: {},
    L: { layerGroup: () => ({}), circle: () => ({}), circleMarker: () => ({}), polyline: () => ({}), latLng: (a, b) => ({ lat: a, lng: b }) }
};
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
sandbox.window.L = sandbox.L;
sandbox.window._currentLang = () => 'en';
sandbox.window._dlMap = null;
sandbox.window._localLayerData = {};
sandbox.window._uatGetTile = null;
sandbox.window._UAT_TILE_UNREADABLE = { unreadable: true };
sandbox.window.UAT_TILE_Z = 14;

const code = fs.readFileSync(path.join(__dirname, 'js', 'archeo-potential.js'), 'utf8');
vm.runInNewContext(code, sandbox, { filename: 'archeo-potential.js' });
const D = sandbox.window._archeoPotentialDebug;

// ── raster UAT: jumătatea vestică a fiecărui tile e intravilan (transparent),
//    jumătatea estică e teren liber (opac + întunecat = roșu pe strat).
const size = 256;
const tileData = new Uint8ClampedArray(size * size * 4);
for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const free = x >= size / 2;
        tileData[i] = free ? 40 : 0;
        tileData[i + 1] = 0;
        tileData[i + 2] = free ? 40 : 120;
        tileData[i + 3] = free ? 255 : 0;
    }
}
sandbox.window._uatGetTile = () => {
    if (uatMode === 'unreadable') return Promise.resolve(sandbox.window._UAT_TILE_UNREADABLE);
    if (uatMode === 'missing') return Promise.resolve(null);
    return Promise.resolve({ data: tileData, size });
};

// ── patrimoniu: 4 clustere dense + 1 sit departe ──
const features = [];
const clusters = [[-0.018, -0.018], [0.018, -0.018], [-0.018, 0.018], [0.018, 0.018]];
let fid = 1;
clusters.forEach(([dl, dc], ci) => {
    for (let j = 0; j < 4; j++) {
        const a = (j / 4) * Math.PI * 2;
        features.push({
            id: fid++,
            geometry: { type: 'Point', coordinates: [23.6 + dl + 0.0022 * Math.cos(a), 46.8 + dc + 0.0022 * Math.sin(a)] },
            properties: { NUMESIT: 'C' + ci + '_' + j, COORD: 'DA' }
        });
    }
});
sandbox.window._localLayerData = { 0: { features }, 5: { features: [] }, 6: { features: [] } };

(async () => {
    if (overrides) {
        Object.keys(overrides).forEach((k) => {
            if (k === 'BUBBLE' || k === 'HEAT' || k === 'FIELD' || k === 'UAT' || k === 'CLASSIFY') {
                Object.assign(D.config[k], overrides[k]);
            } else {
                D.config[k] = overrides[k];
            }
        });
        console.log('[overrides] ' + JSON.stringify(overrides));
    }
    const field = await sandbox.window.computeArcheoPotentialField(centerLat, centerLng, radiusKm * 1000, {
        mode: 'bubbles', skipDataWait: true
    });
    const st = field.stats;
    const bubbles = field.bubbles;

    console.log('UAT: ' + uatMode + ' → tile-uri ' + st.uatTilesOk + '/' + st.uatTiles +
        ' | celule fără date UAT: ' + st.uatUnknown);
    console.log('\n=== rază ' + radiusKm + ' km · centrul ' + centerLat + ',' + centerLng +
        ' · celulă ' + field.cellM + ' m · stare ' + field.status + ' ===');
    console.log('celule: ' + st.cells + ' | scorate: ' + st.scored +
        ' | excluse UAT: ' + st.excludedUat + ' | excluse patrimoniu: ' + st.excludedHeritage);
    console.log('bule: ' + st.bubbles + ' (plafon ' + (st.bubbleCap || D.bubbleCountCap(field.radius)) +
        ', dintre care de umplutură ' + (st.gapFill || 0) + ')');
    console.log('acoperire teren liber: ' + (st.coverage * 100).toFixed(1) + '% din ' +
        st.freeAreaKm2 + ' km²');

    const hist = {};
    bubbles.forEach((b) => {
        const bucket = Math.floor(b.radiusM / 50) * 50;
        hist[bucket] = (hist[bucket] || 0) + 1;
    });
    console.log('raze (grupate la 50 m): ' + Object.keys(hist).sort((a, b) => a - b)
        .map((k) => k + '-' + (Number(k) + 49) + 'm:' + hist[k]).join('  '));

    // unde se pierde terenul liber: celule scorate care nu au găzduit nicio bulă
    const used = new Set(bubbles.map((b) => b.row + ',' + b.col));
    const unused = field.results.filter((r) => !used.has(r.row + ',' + r.col));
    const clearanceHist = { 'sub 70 m': 0, '70-150 m': 0, '150-300 m': 0, 'peste 300 m': 0 };
    const maskIndex = D.createGridIndex(Math.max(field.cellM, 250), Math.max(field.cellM, 250));
    field.excluded.forEach((e) => maskIndex.insert(e.x, e.y, e));
    unused.forEach((r) => {
        const c = D.measureClearance(field, maskIndex, r.x, r.y, 0);
        if (c < 70) clearanceHist['sub 70 m']++;
        else if (c < 150) clearanceHist['70-150 m']++;
        else if (c < 300) clearanceHist['150-300 m']++;
        else clearanceHist['peste 300 m']++;
    });
    console.log('celule libere neocupate: ' + unused.length + ' → spațiu liber: ' +
        JSON.stringify(clearanceHist));

    // ── diagnostic alfa/score pe rasterul de heat ──
    const heatField = await sandbox.window.computeArcheoPotentialField(centerLat, centerLng, radiusKm * 1000, {
        mode: 'heat', skipDataWait: true
    });
    const raster = D.buildHeatRaster(heatField);
    const pts = heatField.results.filter((r) => r.row != null).map((r) => ({
        s: r.score,
        base: raster.base[r.row * raster.cols + r.col],
        smooth: raster.values[r.row * raster.cols + r.col],
        a: raster.rgba[(r.row * raster.cols + r.col) * 4 + 3]
    })).sort((x, y) => x.s - y.s);
    const half = Math.floor(pts.length / 2);
    const avg = (arr, k) => arr.reduce((a, p) => a + p[k], 0) / Math.max(1, arr.length);
    console.log('alpha: media jumătății slabe ' + avg(pts.slice(0, half), 'a').toFixed(1) +
        ' vs jumătatea bună ' + avg(pts.slice(half), 'a').toFixed(1));
    console.log('base == score? ' + pts.every((p) => Math.abs(p.base - p.s) < 1e-6));
    console.log('smooth vs base (primele 5): ' + pts.slice(0, 5).map((p) => p.base.toFixed(3) + '→' + p.smooth.toFixed(3)).join(' '));
    console.log('score range: ' + pts[0].s.toFixed(3) + '..' + pts[pts.length - 1].s.toFixed(3));
    process.exit(0);
})();
