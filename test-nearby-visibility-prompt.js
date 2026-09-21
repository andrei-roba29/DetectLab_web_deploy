// Behavioural test: „Vezi alți detectoriști în zonă" must ask the SAME
// question as the Detect switch before it publishes the user's position.
//
// The requirement
// ---------------
// Turning the Detect switch (or the 🎯 live-location button) ON shows
//     „Vrei să fii vizibil și pentru alți utilizatori?" / Da · Nu
// because that is the moment the user's position is handed to the other
// detectorists.  Asking to SEE the other detectorists is the same moment, so
// the magnifier flow must show the same window — and, unlike the switch, it is
// an async flow: the search has to WAIT for the answer instead of publishing a
// position behind an open question.
//
// What the test does
// ------------------
// It extracts the REAL code out of js/map-app.js (`_presenceVisible`,
// `_promptVisibleToOthers`, `answerVisibleToOthers` and `searchNearbyDetectors`)
// and runs it in a vm against a small DOM / Leaflet / Supabase harness, so the
// control flow itself is exercised:
//   • the dialog is on screen and NOTHING has happened yet (no GPS watcher, no
//     presence row, no query) — the search is parked on the answer;
//   • „Da"  → search resumes, live location starts, presence goes out as
//     visible = true;
//   • „Nu"  → search still runs (you see the neighbours) but every presence row
//     stays visible = false;
//   • two asks that overlap share one window and both receive the answer;
//   • with the modal markup missing the ask resolves immediately with the stored
//     choice, so no flow can hang on a dialog that cannot open;
//   • installed PWAs pick the change up (cache-busted script + new cache name).
//
// Run: node test-nearby-visibility-prompt.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const MAP_SRC = fs.readFileSync(path.join(ROOT, 'js/map-app.js'), 'utf8');
const INDEX_SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW_SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
    if (!cond) {
        console.error('✗ ' + name + (extra ? '\n    ' + extra : ''));
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log('✓ ' + name);
}

/* ── Extract the real functions from js/map-app.js ─────────────────────────── */

function extractFn(src, marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error('could not find "' + marker + '" in js/map-app.js');
    const open = src.indexOf('{', start);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error('unbalanced braces for "' + marker + '"');
}

const presenceSrc = extractFn(MAP_SRC, 'function _presenceVisible()') +
    '\nwindow._presenceVisible = _presenceVisible;';
const promptSrc = extractFn(MAP_SRC, 'window._promptVisibleToOthers = function (cb)') + ';';
const answerSrc = extractFn(MAP_SRC, 'window.answerVisibleToOthers = function (yes)') + ';';
const searchSrc = extractFn(MAP_SRC, 'window.searchNearbyDetectors = async function()') + ';';

/* ── Harness ───────────────────────────────────────────────────────────────── */

// Another detectorist is live 1 km away; the second row is our own device, so
// exactly ONE live pin may be drawn.
const LIVE_ROWS = [
    { user_id: 'u-neighbour', device_id: 'device-theirs', full_name: 'Andrei Popescu',
      email: 'andrei@example.com', latitude: 45.755, longitude: 21.215 },
    { user_id: 'u-me', device_id: 'device-me', full_name: 'Me',
      email: 'me@example.com', latitude: 45.7489, longitude: 21.2087 }
];

function makeClassList() {
    const set = new Set();
    return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); },
        _set: set
    };
}

function makeSandbox(opts) {
    opts = opts || {};
    const elements = {};
    ['nearbyStatus', 'nearbyModal', 'visibilityModal', 'nearbyHomeBtn',
     'nearbyDetectorsBtn', 'pwaNearbyBtn'].forEach(function (id) {
        elements[id] = { id: id, innerHTML: '', style: {}, classList: makeClassList() };
    });
    // „show" mirrors the shipped markup: the search dialog is open when the
    // user presses its „Da / Yes" button (inline onclick → searchNearbyDetectors).
    elements.nearbyModal.classList.add('show');
    const missingModal = !!opts.missingVisibilityModal;
    const captured = { markers: [], fits: 0 };

    const sandbox = {
        console: { warn() {}, log() {}, error() {} },
        // ── state normally owned by the map-app closure ──
        _detLat: opts.detLat !== undefined ? opts.detLat : 45.7489,
        _detLng: opts.detLng !== undefined ? opts.detLng : 21.2087,
        _visibleToOthers: !!opts.visibleToOthers,
        _visibilityWaiters: [],
        DETECTOR_DEVICE_ID: 'device-me',
        navigator: { geolocation: {} },
        localStorage: {
            _store: {},
            getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
            setItem(k, v) { this._store[k] = String(v); }
        },
        // ── live-location bridge (js/map-app.js exposes the same three) ──
        _liveOn: false,
        _liveStarts: 0,
        _gpsWaits: 0,
        // ── presence + nearby plumbing ──
        publishes: [],
        queries: 0,
        nearbyUser: function () {
            return { id: 'u-me', email: 'me@example.com', user_metadata: { full_name: 'Me' } };
        },
        nearbyDistance: function (a, b, c, d) {
            const R = 6371, x = (c - a) * Math.PI / 180, y = (d - b) * Math.PI / 180;
            const q = Math.sin(x / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(y / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(q));
        },
        nearbyInitials: function (name) {
            return String(name || '?').replace(/[<>&"']/g, '').trim().split(/\s+/).slice(0, 2)
                .map(function (x) { return x[0]; }).join('').toUpperCase() || '?';
        },
        detectorSocialSlotHtml: function () { return ''; },
        setNearbyButtonsActive: function () {},
        // The offline (black & white) bubbles have their own regression test; the
        // nearby search only has to call them.
        addOfflineDetectorBubbles: async function () { return 0; },
        document: {
            getElementById: function (id) {
                if (id === 'visibilityModal' && missingModal) return null;
                return elements[id] || null;
            },
            querySelectorAll: function () { return []; }
        },
        L: {
            divIcon(o) { return { options: o }; },
            marker(latlng, o) {
                const m = {
                    latlng: latlng, options: o || {},
                    getLatLng() { return { lat: latlng[0], lng: latlng[1] }; },
                    bindPopup(html) { m.popup = html; return m; },
                    addTo(layer) { layer.addLayer(m); captured.markers.push(m); return m; }
                };
                return m;
            },
            layerGroup() {
                return {
                    _layers: [],
                    addLayer(l) { this._layers.push(l); return this; },
                    getLayers() { return this._layers; },
                    clearLayers() { this._layers = []; return this; }
                };
            },
            latLngBounds(latlngs) {
                return { _latlngs: latlngs, pad() { return this; }, extend() { return this; } };
            }
        },
        map: { fitBounds() { captured.fits++; }, getCenter() { return null; }, getZoom() { return 10; } }
    };

    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.nearbyLayer = sandbox.L.layerGroup();
    sandbox.publishDetectorPresence = function (lat, lng, visible) {
        sandbox.publishes.push({ lat: lat, lng: lng, visible: visible, live: sandbox._liveOn });
        return Promise.resolve(true);
    };
    sandbox._isLiveLocationActive = function () { return sandbox._liveOn; };
    sandbox._startLiveLocation = function () { sandbox._liveOn = true; sandbox._liveStarts++; };
    sandbox._stopLiveLocation = function () { sandbox._liveOn = false; };
    sandbox.waitForDetPosition = async function () {
        sandbox._gpsWaits++;
        sandbox._detLat = 45.7489;
        sandbox._detLng = 21.2087;
        return true;
    };
    sandbox.supabaseClient = {
        from() {
            return {
                select() { return this; },
                eq() { return this; },
                gt() { sandbox.queries++; return Promise.resolve({ data: LIVE_ROWS, error: null }); }
            };
        }
    };

    vm.createContext(sandbox);
    vm.runInContext([presenceSrc, promptSrc, answerSrc, searchSrc].join('\n'), sandbox);
    return { sandbox: sandbox, elements: elements, captured: captured };
}

function flush() { return new Promise(function (r) { setTimeout(r, 0); }); }

/* ── Scenario A: „Da" ──────────────────────────────────────────────────────
   No GPS fix yet, so the whole flow (dialog → answer → GPS → publish) runs in
   order and every step can be observed.                                       */
async function scenarioA() {
    const h = makeSandbox({ detLat: null, detLng: null });
    const w = h.sandbox, els = h.elements;

    const search = w.searchNearbyDetectors();
    await flush();

    check('A1. the visibility question is on screen (same window as the Detect switch)',
        els.visibilityModal.classList.contains('show'));
    check('A2. the search dialog steps aside while the question is up',
        !els.nearbyModal.classList.contains('show'));
    check('A3. nothing is started or published behind the open question',
        w._liveStarts === 0 && w._gpsWaits === 0 && w.publishes.length === 0 && w.queries === 0,
        JSON.stringify({ liveStarts: w._liveStarts, publishes: w.publishes.length, queries: w.queries }));

    w.answerVisibleToOthers(true);
    check('A4. „Da" is persisted for the programmatic re-activations',
        w.localStorage.getItem('detect_visible_to_others') === 'true' &&
        w._visibleToOthers === true);
    check('A5. answering closes the question', !els.visibilityModal.classList.contains('show'));

    await search;

    check('A6. the search resumes once the answer is in (live location + GPS wait)',
        w._liveStarts === 1 && w._gpsWaits === 1,
        JSON.stringify({ liveStarts: w._liveStarts, gpsWaits: w._gpsWaits }));
    check('A7. the presence publish after the answer is visible = true',
        w.publishes.length > 0 && w.publishes[w.publishes.length - 1].visible === true,
        JSON.stringify(w.publishes));
    check('A8. the search dialog comes back with the results',
        els.nearbyModal.classList.contains('show') &&
        /detectorist/i.test(els.nearbyStatus.innerHTML),
        els.nearbyStatus.innerHTML);
    check('A9. the neighbour is drawn (our own device is skipped)',
        h.captured.markers.length === 1 &&
        /detector-nearby-marker/.test((h.captured.markers[0].options.icon || {}).options.html || ''),
        'markers=' + h.captured.markers.length);
}

/* ── Scenario B: „Nu" — you see the neighbours without being seen ─────────── */
async function scenarioB() {
    const h = makeSandbox({});
    const w = h.sandbox, els = h.elements;

    const search = w.searchNearbyDetectors();
    await flush();
    check('B1. the question is asked even when a GPS fix already exists',
        els.visibilityModal.classList.contains('show'));

    w.answerVisibleToOthers(false);
    await search;

    check('B2. „Nu" is persisted and every presence row stays hidden',
        w.localStorage.getItem('detect_visible_to_others') === 'false' &&
        w._visibleToOthers === false &&
        w.publishes.length > 0 &&
        w.publishes.every(function (p) { return p.visible === false; }),
        JSON.stringify(w.publishes));
    check('B3. the search still runs — „Nu" hides you, it does not stop the search',
        w._liveStarts === 1 && h.captured.markers.length === 1 && w.queries === 1,
        JSON.stringify({ liveStarts: w._liveStarts, markers: h.captured.markers.length, queries: w.queries }));
}

/* ── Scenario C: no prompt implementation → search must not hang ──────────── */
async function scenarioC() {
    const h = makeSandbox({});
    const w = h.sandbox;
    w._promptVisibleToOthers = undefined;

    await w.searchNearbyDetectors();

    check('C1. without the dialog API the search runs straight through',
        w._liveStarts === 1 && h.captured.markers.length === 1 &&
        h.elements.visibilityModal.classList.contains('show') === false);
}

/* ── Scenario D: overlapping asks share ONE window, all get the answer ────── */
async function scenarioD() {
    const h = makeSandbox({ visibleToOthers: true });
    const w = h.sandbox;

    const first = w._promptVisibleToOthers();
    const second = w._promptVisibleToOthers();
    await flush();
    check('D1. a second ask joins the open window instead of stacking a new one',
        w._visibilityWaiters.length === 2 &&
        h.elements.visibilityModal.classList.contains('show'));

    w.answerVisibleToOthers(true);
    const answers = await Promise.all([first, second]);

    check('D2. every waiter is released with the same answer',
        answers[0] === true && answers[1] === true && w._visibilityWaiters.length === 0,
        JSON.stringify(answers));
}

/* ── Scenario E: markup missing → immediate answer, never a hang ──────────── */
async function scenarioE() {
    const h = makeSandbox({ missingVisibilityModal: true, visibleToOthers: true });
    const w = h.sandbox;

    const answer = await w._promptVisibleToOthers();
    check('E1. with no dialog in the page the ask answers itself with the stored choice',
        answer === true);
}

/* ── Ship checks: the PWA has to pick the change up ───────────────────────── */
function shipChecks() {
    const href = (INDEX_SRC.match(/src="(js\/map-app\.js\?v=[^"]+)"/) || [])[1];
    check('F1. index.html requests js/map-app.js with a cache-busting ?v=', !!href, 'no ?v= found');
    if (href) {
        check('F2. that exact script URL is in the service worker PRECACHE_URLS',
            SW_SRC.indexOf("'" + href + "'") !== -1, href + ' not pre-cached in sw.js');
    }
    const cacheName = SW_SRC.match(/const CACHE_NAME = 'detectlab-v(\d+)-([a-z0-9-]+)'/);
    check('F3. the service worker cache name was bumped (installed PWAs drop the old shell)',
        !!cacheName && Number(cacheName[1]) >= 117, 'cache name: ' + (cacheName ? cacheName[0] : '<not found>'));
    check('F4. the dialog is the same markup the Detect switch uses (one window, one copy)',
        /id="visibilityModal"/.test(INDEX_SRC) &&
        /Vrei să fii vizibil și pentru alți utilizatori\?/.test(INDEX_SRC) &&
        /Do you want to be visible to other users too\?/.test(INDEX_SRC) &&
        /Ceilalți detectoriști te vor putea vedea pe hartă în „Vezi alți detectoriști în zonă"/.test(INDEX_SRC) &&
        /id="visibilityYesBtn"[^>]*answerVisibleToOthers\(true\)/.test(INDEX_SRC) &&
        /id="visibilityNoBtn"[^>]*answerVisibleToOthers\(false\)/.test(INDEX_SRC));
    check('F5. the search dialog still asks for the 10 km search before it (unchanged entry)',
        /onclick="searchNearbyDetectors\(\)"/.test(INDEX_SRC) &&
        /id="nearbyModal"/.test(INDEX_SRC));
}

/* ── Run the scenarios in order, then the ship checks ─────────────────────── */
(async function run() {
    await scenarioA();
    await scenarioB();
    await scenarioC();
    await scenarioD();
    await scenarioE();
    shipChecks();

    console.log('\n' + passed + ' checks passed.');
    if (process.exitCode) console.error('FAILED');
})();
