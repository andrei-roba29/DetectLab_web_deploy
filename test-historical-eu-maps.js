// Test suite for European Historical Maps (CENAGIS / IH PAN)
// Usage: node test-historical-eu-maps.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('[Test] European Historical Maps (CENAGIS / IH PAN)...');

// 1. Check index.html markup
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
assert(indexHtml.includes('id="histEuRow"'), 'index.html contains histEuRow');
assert(indexHtml.includes('id="histEuSubLayers"'), 'index.html contains histEuSubLayers');
assert(indexHtml.includes('id="histEuToggle"'), 'index.html contains histEuToggle');
assert(indexHtml.includes('id="histEuExpandBtn"'), 'index.html contains histEuExpandBtn');
assert(indexHtml.includes('js/historical-eu-maps.js'), 'index.html loads js/historical-eu-maps.js');
console.log('  ✓ index.html structure verified');

// 2. Check sw.js precache
const swJs = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
assert(swJs.includes('js/historical-eu-maps.js'), 'sw.js precaches js/historical-eu-maps.js');
const shellVersion = Number((swJs.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
assert(shellVersion >= 147, 'sw.js cache must be v147 or newer so European maps ship in installed PWAs');
console.log('  ✓ sw.js precache and cache name verified');

// 3. Check translations.js
const transJs = fs.readFileSync(path.join(__dirname, 'js/translations.js'), 'utf8');
assert(transJs.includes('layer_historical_eu'), 'translations.js contains layer_historical_eu key');
console.log('  ✓ translations.js verified');

// 4. Load and verify historical-eu-maps.js
const euMapsCode = fs.readFileSync(path.join(__dirname, 'js/historical-eu-maps.js'), 'utf8');

const mockWindow = {
    localStorage: { getItem: () => 'ro' },
    document: {
        documentElement: { lang: 'ro' },
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: () => null,
        querySelectorAll: () => []
    },
    L: {
        CRS: { EPSG3857: {} },
        tileLayer: {
            wms: (url, opts) => ({
                url,
                opts,
                setOpacity: () => {},
                addTo: () => {},
                hasLayer: () => false
            })
        }
    }
};

const sandbox = {
    window: mockWindow,
    document: mockWindow.document,
    L: mockWindow.L,
    console: console,
    alert: () => {}
};

vm.createContext(sandbox);
vm.runInContext(euMapsCode, sandbox);

const DetectLabEuMaps = sandbox.window.DetectLabEuMaps;
assert(DetectLabEuMaps, 'DetectLabEuMaps exported to window');

// Verify catalog
const catalog = DetectLabEuMaps.catalog;
assert.ok(Object.keys(catalog).length >= 22, 'Catalog contains all core regional/national maps + city plans');
assert.ok(catalog.wig300k, 'Catalog contains wig300k');
assert.strictEqual(catalog.wig300k.wms_layer, 'wig300k_3857');
assert.strictEqual(catalog.chrzanowski.wms_layer, 'chrzanowski_3857');
assert.strictEqual(catalog.tkkp_126k.wms_layer, 'TKKP_126k_3857');
assert.strictEqual(catalog.kummersberg.wms_layer, 'kummersberg_3857');
assert.strictEqual(catalog.m25k.wms_layer, 'm25k_3857');
console.log('  ✓ Catalog metadata verified (' + Object.keys(catalog).length + ' maps)');

// Verify countries
const countries = DetectLabEuMaps.countries;
assert.strictEqual(countries.length, 19, '19 European countries registered');

const countryCodes = countries.map(c => c.code);
['PL', 'DE', 'UA', 'BY', 'LT', 'LV', 'CZ', 'SK', 'AT', 'HU', 'RU', 'MD', 'RO', 'FR', 'BE-LU', 'NL', 'DK', 'EE', 'CH'].forEach(code => {
    assert.ok(countryCodes.includes(code), 'Country ' + code + ' is included');
});

// Verify percentage bounds (0-100%)
countries.forEach(c => {
    assert.ok(c.maps.length > 0, c.code + ' has historical maps');
    c.maps.forEach(m => {
        assert.ok(m.pct > 0 && m.pct <= 100, c.code + ' map ' + m.id + ' pct valid: ' + m.pct);
    });
});
console.log('  ✓ 19 European countries and coverage percentages verified');

// 5. Market isolation: the panel renders only on detectlab.eu
function runForHost(hostname) {
    const container = { innerHTML: '' };
    const doc = {
        documentElement: { lang: 'ro' },
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: id => (id === 'histEuSubLayers' ? container : null),
        querySelectorAll: () => []
    };
    const win = {
        location: { hostname },
        localStorage: { getItem: () => 'ro' },
        DetectLabSite: { isEurope: hostname === 'detectlab.eu', market: hostname === 'detectlab.eu' ? 'eu' : 'ro' },
        document: doc,
        L: mockWindow.L
    };
    const box = { window: win, document: doc, L: win.L, console, alert: () => {} };
    vm.createContext(box);
    vm.runInContext(euMapsCode, box);
    return { win, container };
}

const euRun = runForHost('detectlab.eu');
assert.ok(euRun.container.innerHTML.length > 0, 'the European panel populates on detectlab.eu');
assert.ok(euRun.container.innerHTML.includes('wig100k'), 'the CENAGIS rows render on detectlab.eu');
console.log('  ✓ detectlab.eu renders the European historical maps panel');

const roRun = runForHost('detectlab.ro');
assert.strictEqual(roRun.container.innerHTML, '', 'the panel stays empty on detectlab.ro');
assert.strictEqual(typeof roRun.win._leafletLayers, 'undefined');
console.log('  ✓ detectlab.ro never renders the European historical maps panel');

console.log('✅ test-historical-eu-maps.js passed all checks successfully.');
