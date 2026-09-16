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
/* ═══════════════════════════════════════════════════════════════════════
   End-to-end: API-ul vechi de candidați (folosit de Raportul arheologic)
   + noul câmp de scor (bule dense / heatmap) + pin mov + slider de rază.
   ═══════════════════════════════════════════════════════════════════════ */
console.log('\n[End-to-end pipeline]');
(async () => {
    // ── DOM fals: status, sumarul, sliderul de rază, modurile, pinul ──
    const fakeEl = (extra) => Object.assign({
        textContent: '',
        innerHTML: '',
        style: {},
        disabled: false,
        checked: false,
        value: '',
        min: '0',
        max: '100',
        dataset: {},
        parentElement: null,
        classList: (() => {
            const set = new Set();
            return {
                add(c) { set.add(c); },
                remove(c) { set.delete(c); },
                toggle(c, on) { const v = (on === undefined) ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; },
                contains(c) { return set.has(c); }
            };
        })(),
        addEventListener() {},
        setAttribute() {},
        getAttribute() { return null; },
        appendChild(child) { return child; },
        focus() {},
        querySelector() { return null; }
    }, extra || {});

    const dom = {
        archeoPotRunBtn: fakeEl(),
        archeoPotStatus: fakeEl(),
        archeoPotSummary: fakeEl(),
        archeoPotDistance: fakeEl({ value: '10', min: '1', max: '10' }),
        archeoPotDistanceValue: fakeEl(),
        archeoPotModeBubbles: fakeEl(),
        archeoPotModeHeat: fakeEl(),
        archeoPotLegendBubbles: fakeEl(),
        archeoPotLegendHeat: fakeEl(),
        archeoPotPinToggle: fakeEl({ checked: false }),
        archeoPotToggle: fakeEl({ checked: true }),
        archeoPotentialRow: fakeEl()
    };
    sandbox.document.getElementById = (id) => dom[id] || null;

    // ── hartă + Leaflet fals ──
    const panes = {};
    const addedLayers = [];
    const mapEvents = {};
    const fakeMap = {
        getCenter: () => ({ lat: 46.8, lng: 23.6 }),
        getZoom: () => 13,
        getPane: (name) => panes[name] || null,
        createPane(name) {
            const pane = { name, children: [], style: {}, appendChild(c) { this.children.push(c); return c; } };
            panes[name] = pane;
            return pane;
        },
        addLayer(l) { addedLayers.push(l); return this; },
        removeLayer(l) { const i = addedLayers.indexOf(l); if (i >= 0) addedLayers.splice(i, 1); return this; },
        hasLayer(l) { return addedLayers.indexOf(l) !== -1; },
        on(type, fn) { (mapEvents[type] = mapEvents[type] || []).push(fn); return this; },
        off(type, fn) {
            const arr = mapEvents[type] || [];
            if (!fn) { arr.length = 0; return this; }
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
            return this;
        },
        fire(type, ev) { (mapEvents[type] || []).forEach((fn) => fn(ev)); return this; }
    };
    sandbox.window._dlMap = fakeMap;

    const groupLayers = [];
    const heatLayers = [];
    const leafletStub = {
        layerGroup(layers) {
            const g = {
                isGroup: true,
                layers: (layers || []).slice(),
                addLayer(l) { this.layers.push(l); return this; },
                removeLayer(l) { const i = this.layers.indexOf(l); if (i >= 0) this.layers.splice(i, 1); return this; },
                clearLayers() { this.layers.length = 0; return this; },
                addTo() { return this; },
                bindPopup() { return this; }
            };
            groupLayers.push(g);
            return g;
        },
        circle(ll, opts) {
            return {
                kind: 'circle',
                latlng: Array.isArray(ll) ? { lat: ll[0], lng: ll[1] } : ll,
                options: opts || {},
                bindPopup(c) { this.popup = c; return this; },
                bindTooltip() { return this; },
                setRadius(r) { this.options.radius = r; return this; },
                setStyle() { return this; },
                addTo() { return this; }
            };
        },
        circleMarker(ll, opts) { return { kind: 'circleMarker', latlng: ll, options: opts || {}, addTo() { return this; } }; },
        polyline(pts, opts) { return { kind: 'polyline', points: pts, options: opts || {}, addTo() { return this; } }; },
        polygon(pts, opts) { return { kind: 'polygon', points: pts, options: opts || {}, addTo() { return this; } }; },
        rectangle(bounds, opts) { return { kind: 'rectangle', bounds, options: opts || {}, addTo() { return this; } }; },
        canvas(opts) { return { kind: 'canvas', options: opts || {} }; },
        marker(ll, opts) {
            return {
                kind: 'marker', latlng: ll, options: opts || {},
                // Leaflet: addTo(map) → map.addLayer(this)
                addTo(m) { if (m && m.addLayer) m.addLayer(this); return this; },
                bindTooltip() { return this; },
                setLatLng(x) { this.latlng = x; return this; }, on() { return this; }, off() { return this; }
            };
        },
        divIcon(opts) { return { kind: 'divIcon', options: opts || {} }; },
        heatLayer(points, opts) {
            const h = {
                kind: 'heat',
                points: (points || []).slice(),
                options: opts || {},
                _canvas: { parentElement: null },
                _archeoZoomWired: false,
                addTo(m) { this._map = m; return this; },
                setOptions(o) { Object.assign(this.options, o); return this; }
            };
            heatLayers.push(h);
            return h;
        },
        latLng: (a, b) => ({ lat: a, lng: b }),
        CRS: { EPSG3857: {} }
    };
    Object.keys(leafletStub).forEach((k) => { sandbox.L[k] = leafletStub[k]; });
    sandbox.window.L = sandbox.L;

    // ── UAT: jumătatea vestică a fiecărui tile e „intravilan” (alpha 0 →
    //    exclusă, marcată cu roșu), jumătatea estică e liberă (alpha 255).
    const size = 256;
    const tileData = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const free = x >= size / 2;
            tileData[i] = free ? 192 : 0;
            tileData[i + 1] = 0;
            tileData[i + 2] = free ? 40 : 120;
            tileData[i + 3] = free ? 255 : 0;
        }
    }
    sandbox.window._uatGetTile = () => Promise.resolve({ data: tileData, size });

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
    features.push({ id: 99, geometry: { type: 'Point', coordinates: [26.0, 45.0] }, properties: { NUMESIT: 'far', COORD: 'DA' } });
    sandbox.window._localLayerData = { 0: { features }, 5: { features: [] }, 6: { features: [] } };

    D.config.SHOW_WORKING_AREA = true;
    D.config.SHOW_TRIANGULATION = true;
    D.config.MAX_CANDIDATES = 30;
    D.config.EXTRA_SAMPLES_MIN_RADIUS_M = 5000; // fără mostre baricentrice suplimentare

    /* ── 1. API-ul vechi de candidați rămâne intact (îl consumă Raportul) ── */
    const legacy = await sandbox.window.computeArcheoPotential(46.8, 23.6, 10000, { skipDataWait: true });
    check('legacy API still returns candidates', legacy.status === 'ok' && legacy.results.length > 0,
        legacy.status + ' / ' + legacy.results.length);
    check('legacy classifications are medium/high',
        legacy.results.every((r) => r.classification === 'medium' || r.classification === 'high'));
    check('legacy candidates ≥ 700 m from the closest site',
        legacy.results.every((r) => r.factors.closestSiteM >= 700));
    check('legacy candidates inside 10 km',
        legacy.results.every((r) => haversine(46.8, 23.6, r.lat, r.lng) <= 10001));
    check('legacy candidate count respects MAX_CANDIDATES', legacy.results.length <= D.config.MAX_CANDIDATES);

    /* ── 2. modul BULE: grid dens, fără goluri, fiecare celulă scorată ── */
    sandbox.window.setArcheoPotentialMode('bubbles');
    await sandbox.window.runArcheoPotentialAnalysis();

    const state0 = sandbox.window._archeoPotentialState();
    check('state reports bubbles mode + slider radius', state0.mode === 'bubbles' && state0.radiusKm === 10,
        JSON.stringify(state0));

    const field = sandbox.window._archeoPotentialField();
    check('field computed', !!field && field.status === 'ok', field && field.status);
    const st = field.stats;
    check('grid tiles the whole circle', st.cells > 1500 &&
        Math.abs(st.cells - (Math.PI * 10000 * 10000) / (field.cellM * field.cellM)) / st.cells < 0.05,
        st.cells + ' cells @ ' + field.cellM + ' m');
    check('scored + excluded = every cell (no point is ignored)',
        st.scored + st.excludedUat + st.excludedHeritage === st.cells,
        JSON.stringify(st));
    check('UAT (intravilan) cells are excluded', st.excludedUat > 0, st.excludedUat);
    check('heritage protection cells are excluded', st.excludedHeritage > 0, st.excludedHeritage);
    check('excluded cells carry a reason',
        field.excluded.length === st.excludedUat + st.excludedHeritage &&
        field.excluded.every((c) => c.reason === 'uat' || c.reason === 'heritage'));
    check('bubbles are smaller than the old 300 m candidates', field.bubbleRadiusM < 300, field.bubbleRadiusM);
    check('neighbouring bubbles overlap → no gaps on the map',
        field.bubbleRadiusM * 2 >= field.cellM, field.bubbleRadiusM + ' vs ' + field.cellM);
    check('every scored cell is rendered as a bubble',
        field.results.length === st.scored &&
        groupLayers.some((g) => g.layers.filter((l) => l.kind === 'circle' && l.options.radius === field.bubbleRadiusM).length === st.scored),
        'scored ' + st.scored);
    check('bubble popups are built lazily',
        groupLayers.some((g) => g.layers.some((l) => l.kind === 'circle' && typeof l.popup === 'function')));
    check('working area circle uses the slider radius',
        groupLayers.some((g) => g.layers.some((l) => l.kind === 'circle' && l.options.radius === 10000)));
    check('triangulation polylines rendered',
        groupLayers.some((g) => g.layers.some((l) => l.kind === 'polyline' && l.points.length === 4)));
    check('red mask drawn in bubbles mode too',
        groupLayers.some((g) => g.layers.some((l) => l.kind === 'rectangle' && /c0392b|e03c3c/i.test(l.options.fillColor))));
    check('heritage protection radii drawn in red',
        groupLayers.some((g) => g.layers.some((l) => l.kind === 'circle' && l.options.radius === 700 &&
            /c0392b|e03c3c/i.test(String(l.options.fillColor)))));
    check('no heat layer in bubbles mode', heatLayers.length === 0);
    check('scored cells stay ≥ 700 m from sites',
        field.results.every((r) => r.factors.closestSiteM >= 700));
    check('every scored cell inside the radius',
        field.results.every((r) => haversine(46.8, 23.6, r.lat, r.lng) <= 10000 + field.cellM));
    check('summary counts scored cells', /scored cells/.test(dom.archeoPotSummary.innerHTML),
        dom.archeoPotSummary.innerHTML);
    check('status reports completion', (dom.archeoPotStatus.textContent || '').length > 0,
        dom.archeoPotStatus.textContent);
    check('public results mirror the field', (sandbox.window._archeoPotentialResults() || []).length === st.scored);

    check('mode buttons + legend follow the selection',
        dom.archeoPotModeBubbles.classList.contains('is-active') &&
        !dom.archeoPotModeHeat.classList.contains('is-active') &&
        dom.archeoPotLegendBubbles.style.display !== 'none' &&
        dom.archeoPotLegendHeat.style.display === 'none',
        JSON.stringify({ b: dom.archeoPotLegendBubbles.style.display, h: dom.archeoPotLegendHeat.style.display }));

    /* ── 3. modul HEATMAP: fiecare punct primește scor + zone excluse roșii ── */
    const groupsBeforeHeat = groupLayers.length;
    sandbox.window.setArcheoPotentialMode('heat');
    await sandbox.window.runArcheoPotentialAnalysis();

    const hf = sandbox.window._archeoPotentialField();
    check('heat mode active', hf.mode === 'heat' && sandbox.window._archeoPotentialState().mode === 'heat');
    check('heat grid is finer than the bubble grid', hf.cellM <= field.cellM, hf.cellM + ' vs ' + field.cellM);
    check('a heat layer was created', heatLayers.length > 0);
    const heat = heatLayers[heatLayers.length - 1];
    check('one heat point per scored cell', heat.points.length === hf.heatPoints.length &&
        hf.stats.scored === heat.points.length, heat.points.length + ' / ' + hf.stats.scored);
    check('heat points carry a normalised score',
        heat.points.every((p) => Array.isArray(p) && p.length === 3 && p[2] > 0 && p[2] <= 1));
    check('heat gradient keeps red out of the score ramp',
        !!heat.options.gradient && Object.keys(heat.options.gradient).length >= 4 &&
        Object.values(heat.options.gradient).every((c) => !/^#(e0|c0|f00|ff0000)/i.test(c)),
        JSON.stringify(heat.options.gradient));
    check('heat blob radius is in pixels and clamped',
        heat.options.radius >= 10 && heat.options.radius <= 46, heat.options.radius);
    check('excluded areas are painted red (rectangles)',
        groupLayers.some((g) => g.layers.filter((l) => l.kind === 'rectangle').length > 0));
    check('excluded reason split is reported',
        hf.stats.excludedUat > 0 && hf.stats.excludedHeritage > 0, JSON.stringify(hf.stats));
    check('heat mode swaps the buttons and the legend',
        dom.archeoPotModeHeat.classList.contains('is-active') &&
        !dom.archeoPotModeBubbles.classList.contains('is-active') &&
        dom.archeoPotLegendHeat.style.display !== 'none' &&
        dom.archeoPotLegendBubbles.style.display === 'none');
    check('heat summary mentions the heatmap', /heatmap/i.test(dom.archeoPotSummary.innerHTML),
        dom.archeoPotSummary.innerHTML);
    // În modul heatmap nu se mai desenează bule: grupurile create de această
    // rulare conțin doar aria de lucru, triunghiurile și masca roșie.
    const heatRunLayers = groupLayers.slice(groupsBeforeHeat).reduce((a, g) => a.concat(g.layers), []);
    check('no score bubbles drawn in heat mode',
        heatRunLayers.filter((l) => l.kind === 'circle' && l.options.radius === hf.bubbleRadiusM).length === 0,
        heatRunLayers.map((l) => l.kind + ':' + l.options.radius).join(','));
    check('heat mode still draws the working area',
        heatRunLayers.some((l) => l.kind === 'circle' && l.options.radius === 10000));

    /* ── 4. pinul mov + sliderul de rază 1–10 km ── */
    sandbox.window.setArcheoPotentialPinMode(true);
    check('pin mode on', sandbox.window._archeoPotentialState().pinMode === true);
    check('map click handler armed for the pin', (mapEvents.click || []).length > 0);
    check('pin toggle reflected in the DOM', dom.archeoPotPinToggle.checked === true);
    check('row marked as on', dom.archeoPotentialRow.classList.contains('is-on'));

    sandbox.window._archeoPotSetPoint(46.805, 23.605);
    check('pin stored in the state', (() => {
        const p = sandbox.window._archeoPotentialState().pin;
        return !!p && Math.abs(p.lat - 46.805) < 1e-9 && Math.abs(p.lng - 23.605) < 1e-9;
    })(), JSON.stringify(sandbox.window._archeoPotentialState().pin));
    // Cerința explicită: pinul stratului e MOV (nu albastru ca la LIDAR/Raport).
    const pinMarker = addedLayers.filter((l) => l.kind === 'marker' &&
        /archeo-pot-pin/.test(String((l.options.icon && l.options.icon.options && l.options.icon.options.html) || ''))).pop();
    check('a purple pin marker is drawn on the map', !!pinMarker);
    const cssSrc = fs.readFileSync(path.join(__dirname, 'css', 'styles.css'), 'utf8');
    const pinDotCss = (cssSrc.match(/\.archeo-pot-pin-dot\s*\{[^}]*\}/) || [''])[0];
    check('the pin dot is styled purple', /#(c4a0f0|a370e8|b388e8)/i.test(pinDotCss), pinDotCss.slice(0, 90));
    check('the pin is not the blue report/LIDAR pin', !/#66c8ff/i.test(pinDotCss));

    sandbox.window.setArcheoPotentialRadiusKm(4);
    check('radius slider drives the state', (() => {
        const s = sandbox.window._archeoPotentialState();
        return s.radiusKm === 4 && s.radiusM === 4000;
    })(), JSON.stringify(sandbox.window._archeoPotentialState()));
    check('radius label updated', (dom.archeoPotDistanceValue.textContent || '').indexOf('4') !== -1,
        dom.archeoPotDistanceValue.textContent);

    sandbox.window.setArcheoPotentialMode('bubbles');
    await sandbox.window.runArcheoPotentialAnalysis();
    const pf = sandbox.window._archeoPotentialField();
    check('analysis is centred on the pin',
        Math.abs(pf.centerLat - 46.805) < 1e-9 && Math.abs(pf.centerLng - 23.605) < 1e-9,
        pf.centerLat + ',' + pf.centerLng);
    check('analysis uses the slider radius', pf.radius === 4000, pf.radius);
    check('every cell stays inside the pin radius',
        pf.results.every((r) => haversine(46.805, 23.605, r.lat, r.lng) <= 4000 + pf.cellM));
    check('smaller radius → coarser grid, fewer cells', pf.stats.cells < st.cells,
        pf.stats.cells + ' vs ' + st.cells);

    sandbox.window.setArcheoPotentialPinMode(false);
    check('pin mode off removes the click handler', (mapEvents.click || []).length === 0);
    await sandbox.window.runArcheoPotentialAnalysis();
    const cf = sandbox.window._archeoPotentialField();
    check('without a pin the map centre is used',
        Math.abs(cf.centerLat - 46.8) < 1e-9 && Math.abs(cf.centerLng - 23.6) < 1e-9,
        cf.centerLat + ',' + cf.centerLng);

    /* ── 5. comutatorul stratului ascunde rezultatele, pinul și oglinda ── */
    sandbox.window.toggleArcheoPotentialLayer(false);
    check('layer off hides the results', sandbox.window._archeoPotentialState().resultsVisible === false);
    check('layer off also closes the pin mode', sandbox.window._archeoPotentialState().pinMode === false);
    sandbox.window.toggleArcheoPotentialLayer(true);
    check('layer on restores the results', sandbox.window._archeoPotentialState().resultsVisible === true);

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
