// Test suite for js/lidar-scanner.js
// Usage: node test-lidar-scanner.js
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const scriptCode = fs.readFileSync(path.join(__dirname, 'js/lidar-scanner.js'), 'utf8');
const lidarGeoCode = fs.readFileSync(path.join(__dirname, 'js/lidar-geo.js'), 'utf8');

// load() rethrows after surfacing errors (same as production); swallow them here
// so scenario D can assert the graceful failure path without crashing Node.
const unhandledRejections = [];
process.on('unhandledRejection', (e) => { unhandledRejections.push(e); });

function flushMicrotasks(times) {
    let p = Promise.resolve();
    for (let i = 0; i < (times || 30); i++) p = p.then(() => {});
    return p;
}

function makeSandbox(opts) {
    opts = opts || {};
    const state = {
        addedLayers: [],
        removedLayers: [],
        mapEventListeners: {},
        createdCircles: [],
        createdMarkers: [],
        warnings: []
    };

    const mockMap = {
        addLayer(l) { state.addedLayers.push(l); return this; },
        removeLayer(l) { state.removedLayers.push(l); return this; },
        on(evt, fn) { state.mapEventListeners[evt] = fn; return this; },
        off(evt) { delete state.mapEventListeners[evt]; return this; },
        fitBounds() {},
        createPane() { return { style: {} }; },
        getPane() { return { style: {} }; }
    };

    const domElements = {
        lidarScannerToggle: { checked: false, listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
        lidarScannerDistance: { value: '10', listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
        lidarScannerDistanceValue: { textContent: '' },
        lidarScannerRun: { listeners: {}, addEventListener(e, fn) { this.listeners[e] = fn; } },
        lidarScannerStatus: { textContent: '' },
        lidarScannerRow: {
            classList: {
                toggle(cls, val) { this[cls] = val; }
            }
        },
        lidarScannerLoading: {
            classList: {
                add() {},
                remove() {}
            }
        }
    };

    const mockL = {
        circle(latlng, opts2) {
            const c = {
                type: 'circle',
                latlng,
                options: opts2,
                bindTooltip(html, topts) { this._tooltip = html; this._tooltipOpts = topts; return this; },
                bindPopup(html) { this._popup = html; return this; },
                setRadius(r) { this.options.radius = r; },
                addTo(map) { map.addLayer(this); return this; }
            };
            state.createdCircles.push(c);
            return c;
        },
        circleMarker(latlng, opts2) {
            return {
                type: 'circleMarker',
                latlng,
                options: opts2,
                addTo(map) { map.addLayer(this); return this; }
            };
        },
        marker(latlng, opts2) {
            const m = {
                type: 'marker',
                latlng,
                options: opts2,
                bindTooltip(html, topts) { this._tooltip = html; this._tooltipOpts = topts; return this; },
                bindPopup(html) { this._popup = html; return this; },
                addTo(map) { map.addLayer(this); return this; }
            };
            state.createdMarkers.push(m);
            return m;
        },
        divIcon(opts2) {
            return {
                type: 'divIcon',
                options: opts2
            };
        },
        layerGroup() {
            const layers = [];
            return {
                layers,
                addLayer(l) { layers.push(l); },
                clearLayers() { layers.length = 0; },
                addTo(map) { map.addLayer(this); return this; }
            };
        },
        latLngBounds() {
            return {
                pad() { return this; }
            };
        }
    };

    const sandbox = {
        console: {
            log: console.log,
            warn() { state.warnings.push(Array.prototype.map.call(arguments, String).join(' ')); }
        },
        setTimeout: opts.immediateTimeouts ? function (fn) { fn(); return 0; } : setTimeout,
        clearTimeout,
        Promise,
        Math,
        JSON,
        isFinite,
        parseFloat,
        parseInt,
        document: {
            readyState: 'complete',
            addEventListener() {},
            getElementById(id) { return domElements[id] || null; }
        },
        window: {
            _dlMap: mockMap,
            _localLayerData: opts.localLayerData || {}
        },
        L: mockL,
        fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(opts.csv || '') })
    };
    sandbox.window.window = sandbox.window;
    sandbox.window.document = sandbox.document;
    sandbox.window.L = sandbox.L;

    vm.createContext(sandbox);
    if (opts.realLidarGeo) {
        vm.runInContext(lidarGeoCode, sandbox); // attaches window.LidarGeo
        sandbox.LidarGeo = sandbox.window.LidarGeo;
    } else {
        sandbox.LidarGeo = opts.lidarGeo || {
            looks_like_ecef: () => true,
            load_points: () => [],
            scan: () => []
        };
    }
    vm.runInContext(scriptCode, sandbox);
    return { sandbox, state, domElements };
}

async function main() {
    console.log('[Test] Running LIDAR Scanner tests...');

    // ── Scenario A: neon search-point selection UX (original suite, ECEF-style mock) ──
    {
        const { sandbox, state, domElements } = makeSandbox({
            csv: 'id,X,Y,Z,category,name\n1,3900000,1800000,4700000,Fort,Test'
        });

        // 1. Activate scanner
        assert(typeof sandbox.window.toggleLidarScannerLayer === 'function', 'toggleLidarScannerLayer should be exposed');
        sandbox.window.toggleLidarScannerLayer(true);
        assert(state.mapEventListeners['click'], 'map click listener should be registered when active');

        // 2. Click map to choose a search point
        state.addedLayers = [];
        state.mapEventListeners['click']({ latlng: { lat: 45.75, lng: 21.22 } });

        assert(state.addedLayers.length >= 2, 'Search marker and search circle should be added to map');
        const marker = state.addedLayers.find(l => l.type === 'marker');
        const circle = state.addedLayers.find(l => l.type === 'circle');

        assert(marker, 'Marker should be placed at search point');
        assert(circle, 'Selection circle should be placed around search point');

        // Check neon green marker styling
        assert(marker.options.icon, 'Marker should use custom divIcon');
        assert(marker.options.icon.options.className.includes('lidar-search-marker-wrapper'), 'divIcon class should be lidar-search-marker-wrapper');
        assert(marker.options.icon.options.html.includes('lidar-search-dot'), 'divIcon HTML should include neon green lidar-search-dot');
        assert(marker.options.icon.options.html.includes('lidar-search-pulse'), 'divIcon HTML should include neon green lidar-search-pulse');
        assert(marker._tooltip.includes('Search Point / Punct căutare') || marker._tooltip.includes('Punct'), 'Marker should have search point tooltip');

        // Check neon green circle styling
        assert(circle.options.color === '#8cff66', 'Circle stroke should be neon green #8cff66');
        assert(circle.options.fillColor === '#39ff14', 'Circle fill should be neon green #39ff14');

        // 3. Update distance slider
        domElements.lidarScannerDistance.value = '25';
        domElements.lidarScannerDistance.listeners['input'].call(domElements.lidarScannerDistance);
        assert.strictEqual(circle.options.radius, 25000, 'Selection circle radius should update to 25km');

        // 4. Deactivate scanner
        sandbox.window.toggleLidarScannerLayer(false);
        assert(!state.mapEventListeners['click'], 'Map click listener should be removed when deactivated');
        assert(state.removedLayers.includes(marker), 'Selected marker should be removed when layer turned off');
        assert(state.removedLayers.includes(circle), 'Selection circle should be removed when layer turned off');
        console.log('  ✅ A: search point selection UX');
    }

    // ── Scenario B: latitude/longitude CSV (the documented .example format) loads and scans end-to-end ──
    {
        const csv = 'id,latitude,longitude,category,name\n' +
                    'example-1,46.7712,23.6236,Possible structure,Example location\n' +
                    'example-2,45.7489,21.2087,Artifact scatter,Example location\n';
        const { sandbox, state, domElements } = makeSandbox({ csv, realLidarGeo: true, immediateTimeouts: true });

        sandbox.window.toggleLidarScannerLayer(true);
        await flushMicrotasks();

        assert(domElements.lidarScannerStatus.textContent.startsWith('2 points loaded'),
            'lat/lon CSV should load 2 points, got status: ' + domElements.lidarScannerStatus.textContent);
        assert.strictEqual(state.warnings.length, 0, 'lat/lon CSV must not produce CSV errors: ' + state.warnings.join(' | '));

        // Choose a search point next to example-1 (default radius 10 km) and run the scan.
        state.mapEventListeners['click']({ latlng: { lat: 46.771, lng: 23.624 } });
        domElements.lidarScannerRun.listeners['click']();

        assert(domElements.lidarScannerStatus.textContent.startsWith('1 result'),
            'scan should find exactly the nearby point, got status: ' + domElements.lidarScannerStatus.textContent);

        const resultCircle = state.createdCircles.find(c => c.options.radius === 100);
        assert(resultCircle, 'a 100m result circle should be created');
        assert(Math.abs(resultCircle.latlng[0] - 46.7712) < 1e-9 && Math.abs(resultCircle.latlng[1] - 23.6236) < 1e-9,
            'result circle should sit at the CSV latitude/longitude, got ' + JSON.stringify(resultCircle.latlng));
        assert(resultCircle._popup.includes('Possible structure'), 'result popup should carry the category');
        assert(resultCircle._tooltip.includes('Possible structure'), 'result tooltip should carry the category');
        console.log('  ✅ B: latitude/longitude CSV loads + scans end-to-end');
    }

    // ── Scenario C: shipped data/lidar_scanner_points.csv loads (guards the real artifact) ──
    {
        const shippedCsv = fs.readFileSync(path.join(__dirname, 'data/lidar_scanner_points.csv'), 'utf8');
        const { sandbox, state, domElements } = makeSandbox({ csv: shippedCsv, realLidarGeo: true, immediateTimeouts: true });

        sandbox.window.toggleLidarScannerLayer(true);
        await flushMicrotasks();

        assert(domElements.lidarScannerStatus.textContent.startsWith('5 points loaded'),
            'shipped CSV should load 5 points, got status: ' + domElements.lidarScannerStatus.textContent);
        assert.strictEqual(state.warnings.length, 0, 'shipped CSV must not log CSV errors: ' + state.warnings.join(' | '));

        // Scan next to the first shipped point (44.680496658, 22.532812357) — Caraș-Severin area.
        state.mapEventListeners['click']({ latlng: { lat: 44.6805, lng: 22.5328 } });
        domElements.lidarScannerRun.listeners['click']();
        assert(domElements.lidarScannerStatus.textContent.startsWith('1 result'),
            'scan in the Caraș-Severin area should find the shipped fortificație point, got: ' + domElements.lidarScannerStatus.textContent);
        const c = state.createdCircles.find(x => x.options.radius === 100);
        assert(c && Math.abs(c.latlng[0] - 44.680496658) < 1e-9 && Math.abs(c.latlng[1] - 22.532812357) < 1e-9,
            'result circle should sit at the shipped coordinate, got ' + (c && JSON.stringify(c.latlng)));
        assert(c._popup.includes('fortificație'), 'popup should carry the Romanian category: ' + c._popup);
        console.log('  ✅ C: shipped CSV loads + scans (5 real points)');
    }

    // ── Scenario D: header-only CSV (no data rows yet) loads quietly ──
    {
        const { sandbox, state, domElements } = makeSandbox({ csv: 'id,latitude,longitude,category,name\n', realLidarGeo: true });

        sandbox.window.toggleLidarScannerLayer(true);
        await flushMicrotasks();

        assert(domElements.lidarScannerStatus.textContent.startsWith('0 points loaded'),
            'header-only CSV should load 0 points quietly, got status: ' + domElements.lidarScannerStatus.textContent);
        assert.strictEqual(state.warnings.length, 0, 'header-only CSV must not log CSV errors: ' + state.warnings.join(' | '));
        console.log('  ✅ D: header-only CSV loads quietly');
    }

    // ── Scenario E: Romanian headers (Latitudine,Longitudine,Categorie) — the user's actual file ──
    {
        const csvRo = 'Latitudine,Longitudine,Categorie\n' +
                      '44.680496658,22.532812357,fortificație\n' +
                      '44.746747673,22.418674167,burgus\n' +
                      '46.936926644,21.671022392,tumul\n';
        const { sandbox, state, domElements } = makeSandbox({ csv: csvRo, realLidarGeo: true, immediateTimeouts: true });

        sandbox.window.toggleLidarScannerLayer(true);
        await flushMicrotasks();

        assert(domElements.lidarScannerStatus.textContent.startsWith('3 points loaded'),
            'Romanian-header CSV should load 3 points, got status: ' + domElements.lidarScannerStatus.textContent);
        assert.strictEqual(state.warnings.length, 0, 'Romanian-header CSV must not log CSV errors: ' + state.warnings.join(' | '));

        state.mapEventListeners['click']({ latlng: { lat: 44.7467, lng: 22.4187 } });
        domElements.lidarScannerRun.listeners['click']();
        assert(domElements.lidarScannerStatus.textContent.startsWith('1 result'),
            'scan should find the burgus point, got status: ' + domElements.lidarScannerStatus.textContent);
        const c = state.createdCircles.find(x => x.options.radius === 100);
        assert(c && Math.abs(c.latlng[0] - 44.746747673) < 1e-9 && Math.abs(c.latlng[1] - 22.418674167) < 1e-9,
            'result circle should sit at the CSV coordinate, got ' + (c && JSON.stringify(c.latlng)));
        assert(c._popup.includes('burgus'), 'popup should carry the Categorie value: ' + c._popup);
        console.log('  ✅ E: Romanian headers (Latitudine/Longitudine/Categorie) load + scan');
    }

    // ── Scenario F: CSV with unknown columns fails gracefully with a clear status ──
    {
        const { sandbox, state, domElements } = makeSandbox({ csv: 'id,foo,bar\n1,2,3\n', realLidarGeo: true });

        sandbox.window.toggleLidarScannerLayer(true);
        await flushMicrotasks();
        await new Promise(res => setTimeout(res, 0)); // unhandledRejection fires on a macrotask turn

        assert(domElements.lidarScannerStatus.textContent.includes('need latitude,longitude or X,Y,Z columns'),
            'unknown columns should show the guidance status, got: ' + domElements.lidarScannerStatus.textContent);
        assert.strictEqual(state.warnings.length, 1, 'unknown columns should log exactly one warning');
        assert(state.warnings[0].includes('found: id, foo, bar'), 'warning should list the columns it actually found: ' + state.warnings[0]);
        assert(unhandledRejections.length >= 1, 'rethrown load error should surface (as in the browser console)');
        console.log('  ✅ F: unknown columns fail with a clear message');
    }

    console.log('✅ ALL LIDAR SCANNER TESTS PASSED');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
