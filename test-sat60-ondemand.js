/*
 * test-sat60-ondemand.js
 * ──────────────────────────────────────────────────────────────────────────
 * Node harness that loads js/corona-wms-layer.js with stubbed browser APIs
 * and verifies the on-demand behaviour of the "Satellite imagery 60's" layer:
 *
 *   1. A manualOnly layer tile NEVER triggers fetch() — it renders only what
 *      is already in the IndexedDB cache ("nothing fetches until pressed").
 *   2. window.coronaProbeTiles() (the "Load images here" /
 *      "Încarcă imagini aici" button) DOES fetch the requested viewport
 *      tiles and reports which of them actually have imagery.
 *   3. After a successful probe the SAME tile of the manualOnly layer
 *      renders instantly from cache — still without any fetch.
 *   4. HTTP 4xx tiles count as "empty" (no imagery) and are negatively
 *      cached for the session (re-probing adds no new fetch).
 *
 * Run:  node test-sat60-ondemand.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ── Minimal Leaflet stub ─────────────────────────────────────────────────── */
function LatLngBounds(a, b) {
    const la = Array.isArray(a) ? { lat: a[0], lng: a[1] } : a;
    const lb = Array.isArray(b) ? { lat: b[0], lng: b[1] } : b;
    this.min = { lat: Math.min(la.lat, lb.lat), lng: Math.min(la.lng, lb.lng) };
    this.max = { lat: Math.max(la.lat, lb.lat), lng: Math.max(la.lng, lb.lng) };
}
LatLngBounds.prototype.isValid = function () { return isFinite(this.min.lat) && isFinite(this.max.lat); };
LatLngBounds.prototype.intersects = function (o) {
    return !(o.max.lat < this.min.lat || o.min.lat > this.max.lat ||
             o.max.lng < this.min.lng || o.min.lng > this.max.lng);
};

function FakeImg() {
    this.style = {};
    this.alt = '';
    this._onload = null;
}
Object.defineProperty(FakeImg.prototype, 'src', {
    set: function (v) {
        const self = this;
        self._src = v;
        setTimeout(function () { if (self.onload) self.onload(); }, 0);
    }
});

const L = {
    extend: function (target) {
        for (let i = 1; i < arguments.length; i++) {
            const src = arguments[i] || {};
            for (const k in src) target[k] = src[k];
        }
        return target;
    },
    latLngBounds: function (a, b) { return new LatLngBounds(a, b); },
    point: function (x, y) { return { x: x, y: y }; },
    DomUtil: {
        create: function (tag, cls) { const img = new FakeImg(); img.className = cls || ''; return img; }
    }
};

// Minimal class system mimicking Leaflet's Class.extend used by the module.
function WMSTileLayer() {}
WMSTileLayer.prototype.initialize = function (url, options) { this._url = url; this.options = options; };
WMSTileLayer.prototype.getTileUrl = function (coords) {
    return 'https://wms.test/tile?LAYERS=' + encodeURIComponent(this.options.layers || 'corona:x') +
        '&Z=' + coords.z + '&X=' + coords.x + '&Y=' + coords.y;
};
WMSTileLayer.prototype._removeTile = function () {};
WMSTileLayer.extend = function (proto) {
    function SubClass() {
        if (this.initialize) this.initialize.apply(this, arguments);
    }
    SubClass.prototype = Object.create(WMSTileLayer.prototype);
    for (const k in proto) SubClass.prototype[k] = proto[k];
    return SubClass;
};
L.TileLayer = { WMS: WMSTileLayer };

/* ── In-memory IndexedDB shim (only the bits the module touches) ─────────── */
const idbStore = {};
const fakeDb = {
    objectStoreNames: { contains: function () { return true; } },
    transaction: function () {
        return {
            objectStore: function () {
                function wrap(fn) {
                    // NOTE: real IDBRequest objects carry onsuccess/onerror as
                    // predefined null props — the module checks
                    // `typeof r.onsuccess !== 'undefined'`, so they must exist.
                    const req = { onsuccess: null, onerror: null, result: undefined };
                    setTimeout(function () {
                        req.result = fn();
                        if (req.onsuccess) req.onsuccess();
                    }, 0);
                    return req;
                }
                return {
                    get: function (k) { return wrap(function () { return idbStore[k] || null; }); },
                    put: function (rec) { return wrap(function () { idbStore[rec.key] = rec; return rec.key; }); },
                    delete: function (k) { return wrap(function () { delete idbStore[k]; return undefined; }); }
                };
            }
        };
    },
    createObjectStore: function () {}
};
const indexedDB = {
    open: function () {
        const req = { result: fakeDb };
        setTimeout(function () {
            if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: fakeDb } });
            if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
    }
};

/* ── fetch stub: counts calls; URLs containing MISSING return 404 ────────── */
let fetchCalls = 0;
const fetchedUrls = [];
// "Hold mode" — fetches stay pending until released, so tests can observe how
// many requests are in flight at once (the probe pool vs. the map-tile pool).
let holdFetches = false;
let fetchActive = 0;
let maxFetchActive = 0;
const heldFetches = [];   // { settled, resolve, result }
function releaseHeldFetches() {
    heldFetches.splice(0).forEach(function (h) { h.resolve(h.result); });
}
function fakeFetch(url, opts) {
    fetchCalls++;
    fetchedUrls.push(url);
    const u = String(url);
    // GWC404 fails ONLY on the GWC tile-cache path (tests the WMS fallback).
    if (u.indexOf('GWC404') !== -1 && u.indexOf('/gwc/') !== -1) {
        return Promise.resolve({ ok: false, status: 404, headers: { get: function () { return null; } } });
    }
    // WMS404 fails ONLY on the plain WMS path (tests the double-failure case).
    if (u.indexOf('WMS404') !== -1 && u.indexOf('/geoserver/wms') !== -1) {
        return Promise.resolve({ ok: false, status: 404, headers: { get: function () { return null; } } });
    }
    if (u.indexOf('MISSING') !== -1) {
        return Promise.resolve({ ok: false, status: 404, headers: { get: function () { return null; } } });
    }
    const ok200 = function () {
        return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: function () { return 'image/png'; } },
            blob: function () { return Promise.resolve({ fakePng: true }); }
        });
    };
    if (holdFetches) {
        fetchActive++;
        if (fetchActive > maxFetchActive) maxFetchActive = fetchActive;
        return new Promise(function (resolve, reject) {
            const entry = { settled: false, result: ok200() };
            entry.resolve = function (r) {
                if (entry.settled) return;
                entry.settled = true;
                fetchActive--;
                resolve(r);
            };
            if (opts && opts.signal) {
                opts.signal.addEventListener('abort', function () {
                    if (entry.settled) return;
                    entry.settled = true;
                    fetchActive--;
                    reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                });
            }
            heldFetches.push(entry);
        });
    }
    return ok200();
}

/* ── canvas stub: opaque by default; set fakeCanvasTransparentCount = N to
      make the next N decodes fully transparent (simulates a GWC placeholder
      tile and/or a transparent WMS answer). */
let fakeCanvasTransparentCount = 0;
function fakeCanvas() {
    return {
        width: 0, height: 0,
        getContext: function () {
            return {
                clearRect: function () {}, // corona-wms-layer reuses one scratch canvas
                drawImage: function () {},
                getImageData: function (x, y, w, h) {
                    // A full 256×256 RGBA buffer, like a real canvas — the
                    // probe samples every 4th pixel (stride 16 bytes), so the
                    // buffer must be large enough to yield >= 4 alpha samples.
                    const data = new Uint8ClampedArray(256 * 256 * 4);
                    if (fakeCanvasTransparentCount > 0) {
                        fakeCanvasTransparentCount--;
                        return { data: data };          // all alpha = 0
                    }
                    // Four opaque pixels spread across the tile (on the
                    // stride-16 sampling grid) → tileHasVisibleContent() true.
                    data[3] = 255; data[3 + 16] = 255; data[3 + 32] = 255; data[3 + 48] = 255;
                    return { data: data };
                }
            };
        }
    };
}

/* ── Fake map: real Web-Mercator unproject so the Romania filter runs ────── */
const fakeMap = {
    unproject: function (px, z) {
        const n = Math.pow(2, z);
        const lng = px[0] / (256 * n) * 360 - 180;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * px[1] / (256 * n)))) * 180 / Math.PI;
        return { lat: lat, lng: lng };
    },
    project: function () { throw new Error('no projection needed in test'); },
    getCenter: function () { return { lat: 46, lng: 25 }; }
};

/* ── Assemble the fake window ─────────────────────────────────────────────── */
const sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    AbortController: AbortController,
    L: L,
    navigator: { userAgent: 'node-test' },
    indexedDB: indexedDB,
    fetch: fakeFetch,
    Image: FakeImg,
    document: {
        createElement: function (tag) {
            if (tag === 'canvas') return fakeCanvas();
            if (tag === 'style') return { id: '', textContent: '' };
            return { style: {} };
        },
        getElementById: function () { return null; },
        head: { appendChild: function () {} }
    }
};
sandbox.window = sandbox;
sandbox.self = sandbox;
let blobUrlCount = 0;
sandbox.URL = { createObjectURL: function () { return 'blob:fake-' + (++blobUrlCount); }, revokeObjectURL: function () {} };

vm.createContext(sandbox);
const code = fs.readFileSync(path.join(__dirname, 'js', 'corona-wms-layer.js'), 'utf8');
vm.runInContext(code, sandbox, { filename: 'corona-wms-layer.js' });

/* ── Test helpers ─────────────────────────────────────────────────────────── */
const W = sandbox;
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function latToTileY(lat, z) {
    const rad = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
}

let failures = 0;
function check(name, cond) {
    if (cond) { console.log('  PASS', name); }
    else { failures++; console.error('  FAIL', name); }
}

(async function () {
    console.log('[test] Satellite imagery 60\'s — on-demand "Load images here" behaviour');

    const layerLabel = 'corona:1105-2235Fore';
    const z = 12;
    const x = Math.floor((26.0 + 180) / 360 * Math.pow(2, z)); // lng 26E (central RO)
    const y = latToTileY(44.8, z);                              // lat 44.8N

    // ── 1) manualOnly layer tile — must NOT fetch anything ──────────────────
    const layer = W.createCoronaWmsLayer('https://wms.test/wms', {
        layers: layerLabel,
        coronaLayer: layerLabel,
        manualOnly: true,
        minZoom: 4
    });
    layer._map = fakeMap;

    let tile1Done = null;
    const tile1 = layer.createTile({ x: x, y: y, z: z }, function (err, t) { tile1Done = t || true; });
    await wait(60);
    check('1.1 layer tile processed (done callback fired)', tile1Done !== null);
    check('1.2 NO fetch() made by manualOnly layer tile', fetchCalls === 0);
    check('1.3 uncached tile hidden (rendered empty)', tile1.style.display === 'none');

    // ── 2) "Load images here" probe — the button presses ARE allowed to fetch ─
    const urlGood = layer.getTileUrl({ x: x, y: y, z: z }); // same URL a real tile would get
    const probeRes1 = await W.coronaProbeTiles([
        { url: urlGood, layerLabel: layerLabel, z: z, x: x, y: y }
    ]);
    await wait(30);
    check('2.1 probe fetched exactly one tile', fetchCalls === 1);
    check('2.2 probe reports imagery found', probeRes1.found === 1 && probeRes1.empty === 0);
    check('2.3 probe reports the right tile key', probeRes1.foundTiles.indexOf(z + '/' + x + '/' + y) !== -1);

    // ── 3) After the probe, the layer renders the tile from cache w/o fetching ─
    let tile2Done = null;
    const tile2 = layer.createTile({ x: x, y: y, z: z }, function (err, t) { tile2Done = t || true; });
    await wait(60);
    check('3.1 probed tile renders from cache (not hidden)', tile2.style.display !== 'none');
    check('3.2 still NO extra fetch() for the cached tile', fetchCalls === 1);
    check('3.3 done callback fired for the cached tile', tile2Done !== null);

    // ── 4) Missing tile: 404 → reported empty + negatively cached ────────────
    const missingJob = { url: 'https://wms.test/tile?LAYERS=corona:MISSING&Z=12&X=2290&Y=1440',
        layerLabel: 'corona:MISSING', z: z, x: x + 3, y: y - 1 };
    const probeRes2 = await W.coronaProbeTiles([missingJob]);
    await wait(20);
    check('4.1 404 tile counted as empty (no imagery here)', probeRes2.empty === 1 && probeRes2.found === 0);
    const callsBefore = fetchCalls;
    const probeRes3 = await W.coronaProbeTiles([missingJob]);
    await wait(20);
    check('4.2 re-probe of a known-missing tile adds NO fetch', fetchCalls === callsBefore && probeRes3.empty === 1);

    const s = W.CoronaWmsQueue.stats();
    console.log('[test] queue stats:', JSON.stringify({
        cacheHits: s.totals.cacheHits, fetched: s.totals.fetched,
        empty: s.totals.empty, requested: s.totals.requested
    }));
    check('5.1 queue fetched exactly 2 blobs (1 good + 1 probe of the 404)', s.totals.fetched === 1);
    check('5.2 queue served the re-probe from the negative cache (empty counted)', s.totals.empty >= 3);

    // ── 6) GWC tile-cache 404 → probe falls back to the WMS endpoint ────────
    // (Distinct x/y so the IndexedDB shim never returns an earlier blob.)
    fakeCanvasTransparentCount = 0;
    const c6 = fetchCalls;
    const gwcOnlyUrl = 'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms?SERVICE=WMS&LAYERS=corona%3A' +
        layerLabel + '&BBOX=1%2C2%2C3%2C4&GWC404=1';
    const probeRes4 = await W.coronaProbeTiles([
        { url: gwcOnlyUrl, layerLabel: layerLabel, z: z, x: x + 5, y: y + 2 }
    ]);
    await wait(30);
    check('6.1 GWC 404 falls back to WMS endpoint (2 fetches)', fetchCalls === c6 + 2);
    check('6.2 fallback URL hits the plain /geoserver/wms endpoint',
        fetchedUrls.some(function (u) { return String(u).indexOf('/geoserver/wms') !== -1; }));
    check('6.3 imagery found via the fallback',
        probeRes4.found === 1 && probeRes4.empty === 0 && probeRes4.failed === 0);

    // ── 7) Transparent tile from the GWC cache → retried on the WMS endpoint ─
    fakeCanvasTransparentCount = 1;
    const c7 = fetchCalls;
    const gwcTransparentUrl = 'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms?SERVICE=WMS&LAYERS=corona%3A' +
        layerLabel + '&BBOX=1%2C2%2C3%2C4';
    const probeRes5 = await W.coronaProbeTiles([
        { url: gwcTransparentUrl, layerLabel: layerLabel, z: z, x: x + 6, y: y + 3 }
    ]);
    await wait(30);
    check('7.1 transparent GWC tile retried on WMS (2 fetches)', fetchCalls === c7 + 2);
    check('7.2 imagery found after the WMS retry', probeRes5.found === 1 && probeRes5.empty === 0);
    fakeCanvasTransparentCount = 0;

    // ── 8) Both endpoints fail → definitively empty (negative-cached) ───────
    const c8 = fetchCalls;
    const bothFailUrl = 'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms?SERVICE=WMS&LAYERS=corona%3AMISSING' +
        '&BBOX=1%2C2%2C3%2C4&GWC404=1&WMS404=1';
    const probeRes6 = await W.coronaProbeTiles([
        { url: bothFailUrl, layerLabel: 'corona:MISSING', z: z, x: x + 7, y: y + 4 }
    ]);
    await wait(30);
    check('8.1 GWC 404 + WMS 404 → empty (both endpoints tried)', fetchCalls === c8 + 2);
    check('8.2 definitive miss reported as empty', probeRes6.empty === 1 && probeRes6.found === 0);

    // ── 9) Separate probe pool: a bulk probe may use probeConcurrent (12 on
    //        desktop) instead of the map-tile cap (8), so 2000-tile loads
    //        don't take ~10 minutes. ─────────────────────────────────────────
    holdFetches = true;
    maxFetchActive = 0;
    const c9 = fetchCalls;
    const probeJobs9 = [];
    for (let i = 0; i < 30; i++) {
        probeJobs9.push({ url: 'https://wms.test/probe?i=' + i, layerLabel: 'corona:PROBEPOOL', z: z, x: x + i, y: y + 1 });
    }
    const probePromise9 = W.coronaProbeTiles(probeJobs9);
    await wait(80); // let the queue start as many jobs as its pools allow
    check('9.1 probe pool starts 12 concurrent fetches (probeConcurrent)', maxFetchActive === 12);
    check('9.2 probe pool never exceeds 12', maxFetchActive <= 12);
    // Drain: every released slot lets the queue start another held fetch.
    while (heldFetches.length > 0) { releaseHeldFetches(); await wait(40); }
    const res9 = await probePromise9;
    await wait(30);
    check('9.3 all 30 probe jobs fetched and found', fetchCalls === c9 + 30 && res9.found === 30);
    holdFetches = false;

    // ── 9b) Map-tile pool is NOT raised: normal (auto-fetch) layer tiles are
    //        still capped at CONFIG.concurrent (8), so the probe pool doesn't
    //        silently turn the map into a request storm. ─────────────────────
    maxFetchActive = 0;
    holdFetches = true;
    const autoLayer = W.createCoronaWmsLayer('https://wms.test/wms', {
        layers: 'corona:POOLREG', coronaLayer: 'corona:POOLREG',
        manualOnly: false, minZoom: 4
    });
    autoLayer._map = fakeMap;
    for (let i = 0; i < 30; i++) {
        autoLayer.createTile({ x: x + i, y: y + 2, z: z }, function () {});
    }
    await wait(80);
    check('9.4 map-tile pool stays capped at 8 concurrent', maxFetchActive === 8);
    while (heldFetches.length > 0) { releaseHeldFetches(); await wait(40); }
    await wait(80);
    holdFetches = false;

    // ── 10) Stale probe cancellation: zooming away mid-load must drop the
    //        remaining jobs (queued) and abort the in-flight fetches. ────────
    holdFetches = true;
    maxFetchActive = 0;
    const c10 = fetchCalls;
    const cancelJobs = [];
    for (let i = 0; i < 20; i++) {
        cancelJobs.push({ url: 'https://wms.test/cancel?i=' + i, layerLabel: 'corona:CANCEL', z: z, x: x + 50 + i, y: y + 2 });
    }
    const cancelPromise = W.coronaProbeTiles(cancelJobs);
    await wait(80); // 12 started (in flight), 8 queued
    W.CoronaWmsQueue.cancelProbes();
    const res10 = await cancelPromise;
    await wait(30);
    check('10.1 cancelled probe resolves with the cancelled count', res10.cancelled === 20 && res10.found === 0);
    check('10.2 nothing new fetched after the cancel (in-flight aborted, queue dropped)',
        fetchCalls === c10 + maxFetchActive);
    holdFetches = false;

    // ── 11) Definitively-empty tiles are persisted (IDB "empty" marker) — a
    //        re-probe of the same tile issues ZERO network requests. ─────────
    fakeCanvasTransparentCount = 2; // GWC placeholder + WMS placeholder both transparent
    const c11 = fetchCalls;
    const emptyUrl = 'https://geoserve.cast.uark.edu/geoserver/gwc/service/wms?SERVICE=WMS&LAYERS=corona%3Acorona%3AEMPTY&BBOX=1%2C2%2C3%2C4';
    const res11a = await W.coronaProbeTiles([
        { url: emptyUrl, layerLabel: 'corona:EMPTY', z: z, x: x + 200, y: y + 3 }
    ]);
    await wait(30);
    check('11.1 transparent on both endpoints → empty (2 fetches)',
        fetchCalls === c11 + 2 && res11a.empty === 1 && res11a.found === 0);
    const res11b = await W.coronaProbeTiles([
        { url: emptyUrl, layerLabel: 'corona:EMPTY', z: z, x: x + 200, y: y + 3 }
    ]);
    await wait(30);
    check('11.2 re-probe of a persisted-empty tile issues NO fetch',
        fetchCalls === c11 + 2 && res11b.empty === 1 && res11b.found === 0);
    fakeCanvasTransparentCount = 0;

    // ── 12) Probe progress + incremental per-tile callback ──────────────────
    const c12 = fetchCalls;
    const progressCalls = [];
    const foundCalls = [];
    const jobs12 = [];
    for (let i = 0; i < 20; i++) {
        jobs12.push({ url: 'https://wms.test/progress?i=' + i, layerLabel: 'corona:PROGRESS', z: z, x: x + 300 + i, y: y + 1 });
    }
    const res12 = await W.coronaProbeTiles(jobs12, {
        onProgress: function (p) { progressCalls.push(p); },
        onTileFound: function (job) { foundCalls.push(job); return false; }
    });
    await wait(30);
    check('12.1 progress reported with final totals',
        progressCalls.length > 0 && progressCalls[progressCalls.length - 1].done === 20 &&
        progressCalls[progressCalls.length - 1].total === 20);
    check('12.2 onTileFound called once per found tile', foundCalls.length === 20);
    check('12.3 all 20 probe tiles found', res12.found === 20);

    if (failures > 0) {
        console.error('\n[test] ' + failures + ' assertion(s) FAILED');
        process.exit(1);
    }
    console.log('\n[test] ALL OK — layer fetches nothing until "Load images here" is pressed,');
    console.log('       probed tiles render from cache afterwards, missing tiles stay quiet,');
    console.log('       and GWC-only misses fall back to the plain WMS endpoint.');
    process.exit(0);
})().catch(function (e) {
    console.error('[test] crashed:', e);
    process.exit(1);
});
