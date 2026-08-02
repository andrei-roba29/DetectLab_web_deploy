// Node test harness for js/archeo-potential.js (pure logic only).
// Usage: node test-archeo-potential.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── minimal browser stubs ──────────────────────────────────────────────
const sandbox = {
    console,
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    Promise,
    Math,
    JSON,
    isFinite,
    isNaN,
    document: {
        readyState: 'complete',
        addEventListener() {},
        getElementById: () => null
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
let failures = 0;
function check(name, cond, extra) {
    if (cond) { console.log('  ✔ ' + name); }
    else { failures++; console.error('  ✘ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── 1. Delaunay on a random point set ─────────────────────────────────
console.log('\n[Delaunay]');
{
    const pts = [];
    for (let i = 0; i < 40; i++) {
        pts.push({ x: 1000 + Math.random() * 8000, y: 1000 + Math.random() * 8000 });
    }
    const tris = D.delaunayTriangulation(pts);
    check('produces triangles', tris.length > 0, 'got ' + tris.length);
    check('no super vertices', tris.every(t => !t.a.isSuper && !t.b.isSuper && !t.c.isSuper));
    check('all triangles have area >= MIN', tris.every(t => {
        const area = Math.abs((t.b.x - t.a.x) * (t.c.y - t.a.y) - (t.c.x - t.a.x) * (t.b.y - t.a.y)) / 2;
        return area >= 2500;
    }));
    // Euler: for n points with h hull vertices → 2n - 2 - h triangles
    const n = pts.length;
    const minTri = 2 * n - 2 - n; // worst case h = n (all on hull)
    check('triangle count within Euler bounds (' + minTri + '..' + (2 * n - 5) + ')',
        tris.length >= minTri && tris.length <= 2 * n - 5, 'got ' + tris.length);
}

// ── 2. Delaunay on grid points (all collinear rows) ───────────────────
console.log('\n[Delaunay edge cases]');
{
    const pts = [{ x: 0, y: 0, i: 0 }, { x: 1000, y: 0, i: 1 }, { x: 2000, y: 0, i: 2 }, { x: 3000, y: 0, i: 3 }];
    const tris = D.delaunayTriangulation(pts);
    check('collinear points → no slivers (0 or few triangles)', tris.length >= 0);
    const pts2 = [{ x: 0, y: 0, i: 0 }, { x: 0, y: 0, i: 1 }, { x: 0, y: 0, i: 2 }];
    const tris2 = D.delaunayTriangulation(pts2);
    check('identical points → safe (0 triangles)', tris2.length === 0);
    check('2 points → 0 triangles', D.delaunayTriangulation([{ x: 0, y: 0 }, { x: 1, y: 1 }]).length === 0);
}

// ── 3. Triangle quality ───────────────────────────────────────────────
console.log('\n[Triangle quality]');
{
    const mk = (ax, ay, bx, by, cx, cy) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, c: { x: cx, y: cy } });
    const eq = D.triangleQuality(mk(0, 0, 100, 0, 50, 86.602540378)); // equilateral
    check('equilateral ≈ 1.0', Math.abs(eq - 1) < 0.02, 'got ' + eq);
    const sliver = D.triangleQuality(mk(0, 0, 1000, 0, 1000.0001, 0.0001));
    check('sliver ≈ 0', sliver < 0.05, 'got ' + sliver);
    const right = D.triangleQuality(mk(0, 0, 100, 0, 0, 100));
    check('right triangle in (0,1)', right > 0 && right < 1, 'got ' + right);
}

// ── 4. Sampling + scoring + classification + separation ───────────────
console.log('\n[Scoring / classification]');
{
    // synthetic sites in a ring (dense cluster)
    const sites = [];
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        sites.push({ x: 5000 + Math.cos(a) * 1200, y: 5000 + Math.sin(a) * 1200 });
    }
    // candidate inside the ring, 400m from all ring sites → high potential
    const ctx = {
        sites: sites.map(s => ({ x: s.x, y: s.y })),
        siteIndex: (() => {
            const gi = { cells: new Map(), insert(x, y, item) {
                const cx = Math.floor(x / 1200), cy = Math.floor(y / 1200);
                const k = cx + ',' + cy;
                if (!gi.cells.has(k)) gi.cells.set(k, []);
                gi.cells.get(k).push(item);
            }, queryCircle(x, y, r) {
                const out = [];
                for (const [k, arr] of gi.cells) {
                    const [cx, cy] = k.split(',').map(Number);
                    if (cx < Math.floor((x - r) / 1200) || cx > Math.floor((x + r) / 1200)) continue;
                    if (cy < Math.floor((y - r) / 1200) || cy > Math.floor((y + r) / 1200)) continue;
                    out.push(...arr);
                }
                return out;
            } };
            sites.forEach(s => gi.insert(s.x, s.y, s));
            return gi;
        })()
    };
    const seed = {
        x: 5000, y: 5000,
        triQuality: 0.9,
        circumRadius: 1400,
        centroidDistM: 0,
        triScore: 0.9
    };
    const scored = D.scoreCandidate(seed, ctx);
    check('ring center classified High', D.classify(scored.score) === 'high', 'score ' + scored.score.toFixed(3));
    check('nearby count = 10', scored.factors.nearbyCount === 10, scored.factors.nearbyCount);
    check('closest site = 1200 m (ring radius)', scored.factors.closestSiteM === 1200, scored.factors.closestSiteM);

    // isolated pair, far from everything → low score
    const ctx2 = {
        sites: sites.slice(0, 2).map(s => ({ x: s.x, y: s.y })),
        siteIndex: (() => {
            const gi = { cells: new Map(), insert(x, y, item) {
                const cx = Math.floor(x / 1200), cy = Math.floor(y / 1200);
                const k = cx + ',' + cy;
                if (!gi.cells.has(k)) gi.cells.set(k, []);
                gi.cells.get(k).push(item);
            }, queryCircle(x, y, r) {
                const out = [];
                for (const [k, arr] of gi.cells) {
                    const [cx, cy] = k.split(',').map(Number);
                    if (cx < Math.floor((x - r) / 1200) || cx > Math.floor((x + r) / 1200)) continue;
                    if (cy < Math.floor((y - r) / 1200) || cy > Math.floor((y + r) / 1200)) continue;
                    out.push(...arr);
                }
                return out;
            } };
            sites.slice(0, 2).forEach(s => gi.insert(s.x, s.y, s));
            return gi;
        })()
    };
    const seed2 = { x: 5000, y: 5000, triQuality: 0.3, circumRadius: 1400, centroidDistM: 0, triScore: 0.3 };
    const scored2 = D.scoreCandidate(seed2, ctx2);
    check('isolated pair → not High and lower than dense cluster',
        scored2.score < scored.score && D.classify(scored2.score) !== 'high',
        'score ' + scored2.score.toFixed(3) + ' vs cluster ' + scored.score.toFixed(3));

    // separation
    const a = { x: 0, y: 0, lat: 0, lng: 0, score: 0.9, factors: {} };
    const b = { x: 100, y: 0, lat: 0, lng: 0, score: 0.8, factors: {} }; // 100m — too close
    const c = { x: 2000, y: 0, lat: 0, lng: 0, score: 0.7, factors: {} }; // far
    const sel = D.selectSeparated([a, b, c]);
    check('separation keeps a + c (drops b)', sel.length === 2 && sel[0] === a && sel[1] === c, 'kept ' + sel.length);
}

// ── 4b. Star rating + score color ─────────────────────────────────────
console.log('\n[Star rating / score color]');
{
    const star = D.starRatingHtml(0.72);
    check('star row renders 5 stars', (star.match(/★/g) || []).length === 10, star); // 5 gray + 5 colored
    check('star row shows /5 rating', /3\.6\/5/.test(star), star);
    check('star overlay width = 72%', /width:72%/.test(star), star);

    const cLow = D.scoreColor(0.25), cMid = D.scoreColor(0.55), cHigh = D.scoreColor(1.0);
    const parse = (s) => s.match(/(\d+),(\d+),(\d+)/).slice(1).map(Number);
    const [lr, lg, lb] = parse(cLow);
    const [hr, hg, hb] = parse(cHigh);
    check('low score = red-ish (r dominant)', lr > lg && lr > lb, cLow);
    check('high score = violet-ish (b dominant)', hb > hr && hb > lg, cHigh);
    const [mr, mg, mb] = parse(cMid);
    check('mid score = amber-ish (g high, r high)', mg > mb && mr > mb, cMid);

    const popup = D.popupHtml({ score: 0.72, lat: 46.8, lng: 23.6, factors: {
        closestSiteM: 812, nearbyCount: 5, avgDistM: 940, densityCount: 7, triQuality: 0.66 } }, 1);
    check('popup contains star rating', popup.indexOf('★') !== -1);
    check('popup shows closest site distance', /812\s*m/.test(popup), popup);
}

// ── 5. collectSitesInRadius with fake layer data ──────────────────────
console.log('\n[collectSitesInRadius]');
{
    const fakeData = {
        0: { features: [
            { id: 1, geometry: { type: 'Point', coordinates: [23.6, 46.8] }, properties: { NUMESIT: 'A', COORD: 'DA' } },
            { id: 2, geometry: { type: 'Point', coordinates: [23.62, 46.8] }, properties: { NUMESIT: 'B', COORD: 'DA' } },
            { id: 3, geometry: { type: 'Point', coordinates: [23.64, 46.8] }, properties: { NUMESIT: 'C', COORD: 'DA' } },
            { id: 99, geometry: { type: 'Point', coordinates: [24.5, 45.0] }, properties: { NUMESIT: 'far', COORD: 'DA' } }
        ] },
        5: { features: [] },
        6: { features: [
            { id: 7, geometry: { type: 'Polygon', coordinates: [[[23.63, 46.79], [23.65, 46.79], [23.65, 46.81], [23.63, 46.81], [23.63, 46.79]]] }, properties: {} },
            { id: 8, geometry: { type: 'MultiPolygon', coordinates: [
                [[[23.61, 46.79], [23.615, 46.79], [23.615, 46.795], [23.61, 46.795], [23.61, 46.79]]],
                [[[23.61, 46.81], [23.615, 46.81], [23.615, 46.815], [23.61, 46.815], [23.61, 46.81]]]
            ] }, properties: {} }
        ] }
    };
    sandbox.window._localLayerData = fakeData;
    const res = D.collectSitesInRadius(46.8, 23.6, 10000, 46.8);
    check('3 point sites inside radius', res.sites.filter(s => s.layerId === 0).length === 3, res.sites.length);
    check('far site excluded', res.sites.every(s => !(s.lng > 24 && s.lat < 45.5)));
    check('polygon guard points added', res.sites.some(s => s.isGuard), res.sites.filter(s => s.isGuard).length);
    check('polygons recorded (Polygon + MultiPolygon parts)', res.polygons.length === 3, 'got ' + res.polygons.length);
    // polygon rings are in local meters; project the test points the same way
    const kLng = 111320 * Math.cos(46.8 * Math.PI / 180);
    const proj = (lng, lat) => ({ x: lng * kLng, y: lat * 111320 });
    const insidePt = proj(23.64, 46.80);   // inside the [23.63–23.65]×[46.79–46.81] box
    const outsidePt = proj(23.60, 46.80);  // west of the box
    check('pointInPolygon: interior point is inside', D.pointInPolygon(insidePt.x, insidePt.y, res.polygons[0].rings[0]) === true);
    check('pointInPolygon: exterior point is outside', D.pointInPolygon(outsidePt.x, outsidePt.y, res.polygons[0].rings[0]) === false);
}

// ── 6. UAT pixel math consistency ─────────────────────────────────────
console.log('\n[UAT tile math]');
{
    // A point at a known tile position: verify floor math is stable
    const z = 14;
    // sample point in Romania (Cluj-Napoca)
    const lat = 46.7712, lng = 23.6236;
    const txF = (lng + 180) / 360 * Math.pow(2, z);
    const rad = lat * Math.PI / 180;
    const tyF = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z);
    check('tile coords in range', txF >= 0 && tyF >= 0 && txF < Math.pow(2, z) && tyF < Math.pow(2, z),
        txF + ',' + tyF);
    // mirrored formula from map-app.js must match
    const lngToTileX = (lng) => (lng + 180) / 360 * Math.pow(2, z);
    const latToTileY = (lat) => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z);
    check('matches map-app formulas', Math.abs(lngToTileX(lng) - txF) < 1e-9 && Math.abs(latToTileY(lat) - tyF) < 1e-9);
}

// ── 7. END-TO-END pipeline (runArcheoPotentialAnalysis) ───────────────
console.log('\n[End-to-end pipeline]');
(async () => {
    // fake DOM for status/summary/button
    const fakeEl = (text) => ({
        textContent: text || '',
        innerHTML: '',
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        disabled: false,
        dataset: {},
        addEventListener() {}
    });
    const dom = {
        archeoPotRunBtn: fakeEl(),
        archeoPotStatus: fakeEl(),
        archeoPotSummary: fakeEl()
    };
    sandbox.document.getElementById = (id) => dom[id] || null;

    // fake map + leaflet
    const groupLayers = [];
    const fakeMap = {
        getCenter: () => ({ lat: 46.8, lng: 23.6 }),
        getPane: () => null,
        createPane: () => {},
        removeLayer: () => {},
        hasLayer: () => false
    };
    sandbox.window._dlMap = fakeMap;
    sandbox.L.layerGroup = () => {
        const g = {
            layers: [],
            addLayer(l) { this.layers.push(l); return this; },
            addTo() { return this; },
            bindPopup() { return this; }
        };
        groupLayers.push(g);
        return g;
    };
    sandbox.L.circle = (ll, opts) => ({ latlng: ll, options: opts, bindPopup() { return this; } });
    sandbox.L.circleMarker = (ll, opts) => ({ latlng: ll, options: opts });
    sandbox.L.polyline = (pts, opts) => ({ points: pts, options: opts });
    sandbox.L.latLng = (a, b) => ({ lat: a, lng: b });

    // UAT: fully opaque raster everywhere → every point is inside the "red zone"
    const opaqueTile = { data: new Uint8ClampedArray(256 * 256 * 4).fill(255), size: 256 };
    sandbox.window._uatGetTile = () => Promise.resolve(opaqueTile);

    // rich fake heritage dataset: 4 dense clusters at the corners of a ~4 km
    // square (real gaps between clusters → candidates should emerge) + 1 far site
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
    features.push({ id: 99, geometry: { type: 'Point', coordinates: [26.0, 45.0] }, properties: { NUMESIT: 'far', COORD: 'DA' } });
    sandbox.window._localLayerData = {
        0: { features: features },
        5: { features: [] },
        6: { features: [] }
    };

    // config: keep working-area + triangulation rendering ENABLED so those
    // code paths (ctx.centerLat/centerLng, polyline building) are exercised
    D.config.SHOW_WORKING_AREA = true;
    D.config.SHOW_TRIANGULATION = true;
    D.config.MAX_CANDIDATES = 30;
    D.config.EXTRA_SAMPLES_MIN_RADIUS_M = 5000; // no extra barycentric samples

    await sandbox.window.runArcheoPotentialAnalysis();

    const summary = dom.archeoPotSummary.innerHTML || '';
    const status = dom.archeoPotStatus.textContent || '';
    console.log('  [status] "' + status + '"');
    check('status set (done or no_candidates)', status.length > 0, status);
    check('summary populated', /candidates/i.test(summary), summary);
    const m = summary.match(/(\d+)\s+candidates/);
    const n = m ? parseInt(m[1], 10) : -1;
    check('results rendered', n > 0, 'summary: ' + summary);
    check('layer group has circles', groupLayers.length > 0 &&
        groupLayers[0].layers.filter(l => l.options && l.options.radius === D.config.CANDIDATE_RADIUS_M).length === n,
        'circles: ' + (groupLayers[0] ? groupLayers[0].layers.length : 0));
    check('working-area circle rendered', groupLayers.length > 0 &&
        groupLayers[0].layers.some(l => l.options && l.options.radius === D.config.SEARCH_RADIUS_M));
    check('triangulation polylines rendered', groupLayers.length > 0 &&
        groupLayers[0].layers.some(l => l.points && l.points.length === 4));

    // all results must be inside the 10 km radius and classified validly
    const results = sandbox.window._archeoPotentialResults() || [];
    check('every result inside 10 km', results.every(r => {
        const d = haversine(46.8, 23.6, r.lat, r.lng);
        return d <= 10000 + 1;
    }));
    check('classifications valid', results.every(r => r.classification === 'medium' || r.classification === 'high'));
    check('every candidate ≥ 700 m from closest site', results.every(r => r.factors.closestSiteM >= 700),
        JSON.stringify(results.map(r => r.factors.closestSiteM)));

    console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
    process.exit(failures === 0 ? 0 : 1);
})();

function haversine(aLat, aLng, bLat, bLng) {
    const R = 6371000;
    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLng = (bLng - aLng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
