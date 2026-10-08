// Test suite for the European historical-map catalog inside the single
// Premium Historical Maps group and its country-overlap filtering.
// Usage: node test-historical-eu-maps.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('[Test] European historical-map catalog + country overlap...');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const indexHtml = read('index.html');
const swJs = read('sw.js');
const source = read('js/historical-eu-maps.js');
const subscriptions = read('js/subscriptions.js');

// The catalog is nested in the original premium Historical Maps accordion;
// the obsolete second top-level European group must stay gone.
const parentStart = indexHtml.indexOf('id="histPremiumSubLayers"');
const parentEnd = indexHtml.indexOf('<!-- /histPremiumSubLayers -->', parentStart);
assert(parentStart >= 0 && parentEnd > parentStart, 'single premium Historical Maps accordion exists');
const parentMarkup = indexHtml.slice(parentStart, parentEnd);
assert(parentMarkup.includes('id="histEuMapsSection"'), 'CENAGIS catalog is inside histPremiumSubLayers');
['histEuRow', 'histEuSubLayers', 'histEuToggle', 'histEuExpandBtn'].forEach(id => {
    assert(!indexHtml.includes('id="' + id + '"'), 'obsolete separate group #' + id + ' is removed');
});
assert(indexHtml.includes('js/historical-eu-maps.js?v=20261008-country-overlap'), 'versioned catalog is loaded');
assert(indexHtml.includes('js/map-app.js?v=20261008-premium-historical-roman'), 'versioned country/Roman map app is loaded');
assert(indexHtml.includes('js/subscriptions.js?v=20261008-premium-roman-guard'), 'premium guard is versioned');
assert(subscriptions.includes('toggleCenagisLayer'), 'dynamic CENAGIS toggle is Premium-guarded');
assert(subscriptions.includes("'toggleRomanDareCategories'"), 'DARE All/None is Premium-guarded');
assert(subscriptions.includes("'toggleRomanSub'"), 'Roman sublayers are Premium-guarded');
console.log('  ✓ one premium parent group, versioned scripts and entitlement guards verified');

assert(swJs.includes('js/historical-eu-maps.js?v=20261008-country-overlap'), 'service worker precaches the versioned catalog');
assert(swJs.includes('js/map-app.js?v=20261008-premium-historical-roman'), 'service worker precaches the versioned map app');
assert(swJs.includes('js/subscriptions.js?v=20261008-premium-roman-guard'), 'service worker precaches the versioned subscription guard');
const shellVersion = Number((swJs.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
assert(shellVersion >= 171, 'service-worker cache bumped for the merged catalog (got v' + shellVersion + ')');
console.log('  ✓ service-worker precache and cache version v' + shellVersion + ' verified');

function makeClassList() {
    const values = new Set();
    return {
        add(name) { values.add(name); },
        remove(name) { values.delete(name); },
        contains(name) { return values.has(name); },
        toggle(name, force) {
            const on = force === undefined ? !values.has(name) : !!force;
            if (on) values.add(name); else values.delete(name);
            return on;
        }
    };
}
function makeRow(mapId) {
    const attrs = { 'data-map-id': mapId };
    return {
        classList: makeClassList(),
        style: {},
        attrs,
        getAttribute(name) { return attrs[name] || null; },
        setAttribute(name, value) { attrs[name] = String(value); }
    };
}

const rows = ['wig300k', 'wig500k_1947', 'gaul', 'kdr', 'reymann'].map(makeRow);
const section = {
    classList: makeClassList(),
    attrs: {},
    innerHTML: '',
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] || null; }
};
const status = { textContent: '' };
const noMaps = { style: { display: 'none' } };
const listeners = {};
const document = {
    readyState: 'loading',
    documentElement: { lang: 'en' },
    addEventListener(type, callback) { listeners[type] = callback; },
    getElementById(id) {
        if (id === 'histEuMapsSection') return section;
        if (id === 'histEuFilterStatus') return status;
        if (id === 'cenagisNoMaps') return noMaps;
        return null;
    },
    querySelectorAll(selector) {
        return selector === '.cenagis-map-row' ? rows : [];
    }
};
const mockWindow = {
    localStorage: { getItem: () => 'en' },
    document,
    L: {
        CRS: { EPSG3857: {} },
        tileLayer: { wms: () => ({ setOpacity() {}, addTo() {} }) }
    }
};
const sandbox = { window: mockWindow, document, L: mockWindow.L, console, alert() {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const api = mockWindow.DetectLabEuMaps;
assert(api, 'DetectLabEuMaps API is exported');

// Catalog and duplicate behavior: maps already offered by legacy premium rows
// stay in that part of the same parent and are not repeated in the CENAGIS list.
const catalog = api.catalog;
assert(Object.keys(catalog).length >= 40, 'catalog contains regional/national maps and city plans');
['wig300k', 'wig500k_1947', 'gaul', 'm25k', 'ahp_ziemie_polskie'].forEach(id => {
    assert(catalog[id], 'catalog contains ' + id);
});
['ukvme', 'chrzanowski', 'reymann', 'kdr', 'kdr_gb', 'wig100k', 'kummersberg'].forEach(id => {
    assert(api.sharedPremiumMapKeys[id], id + ' is marked as already present in the legacy premium list');
});
const italyOverlap = api.getMapsOverlappingBounds([6.62, 35.49, 18.52, 47.09], true);
assert(italyOverlap.includes('reymann'), 'partial bounds overlap is recognized at the north of Italy');
assert(!api.getMapsOverlappingBounds([6.62, 35.49, 18.52, 47.09], false).includes('reymann'),
    'a shared legacy map is not duplicated in the dynamic catalog');
console.log('  ✓ catalog metadata, partial-overlap logic and legacy de-duplication verified');

// The dynamic section includes only sheets whose extent overlaps the selected
// country (including a small/partial intersection). Non-overlap rows and rows
// duplicated by the legacy controls remain hidden.
const denmark = [8.08, 54.56, 15.19, 57.75];
const availableCount = api.filterForCountry('DK', denmark);
assert.strictEqual(availableCount, 2, 'two non-duplicate catalog sheets overlap Denmark in this row fixture');
const byId = Object.fromEntries(rows.map(row => [row.getAttribute('data-map-id'), row]));
assert.strictEqual(byId.wig300k.classList.contains('country-layer-unavailable'), false,
    'WIG 300k remains available on a partial Denmark overlap');
assert.strictEqual(byId.wig500k_1947.classList.contains('country-layer-unavailable'), false,
    'WIG 500k remains available on a partial Denmark overlap');
assert.strictEqual(byId.gaul.classList.contains('country-layer-unavailable'), true, 'non-overlapping Gaul sheet is hidden');
assert.strictEqual(byId.kdr.classList.contains('country-layer-unavailable'), true, 'shared KDR sheet is not duplicated in the catalog');
assert.strictEqual(byId.reymann.classList.contains('country-layer-unavailable'), true, 'shared Reymann sheet is not duplicated in the catalog');
assert.strictEqual(api.hasAvailableMaps(), true, 'combined parent can query available dynamic maps');
assert.strictEqual(noMaps.style.display, 'none', 'empty catalog message stays hidden when sheets overlap');
assert(status.textContent.includes('Denmark'), 'status announces the matching country and overlap count');

api.filterForCountry(null, null);
assert(rows.every(row => !row.classList.contains('country-layer-unavailable')), 'clearing country filter restores all catalog rows');
assert.strictEqual(api.hasAvailableMaps(), true, 'unfiltered catalog remains available');
console.log('  ✓ country selection keeps partial overlaps, hides non-overlaps and restores the full catalog');

// Curated coverage remains available as a fallback when no country polygon is
// supplied (e.g. a country selection with only an ISO code).
assert.strictEqual(api.countries.length, 19, 'curated ISO fallback list is retained');
assert.strictEqual(api.filterForCountry('ZZ', null), 0, 'unknown ISO without bounds does not expose every European map');
assert.strictEqual(noMaps.style.display, 'block', 'empty catalog message appears when no CENAGIS map overlaps');
['PL', 'DE', 'UA', 'BY', 'LT', 'LV', 'CZ', 'SK', 'AT', 'HU', 'RU', 'MD', 'RO', 'FR', 'BE-LU', 'NL', 'DK', 'EE', 'CH'].forEach(code => {
    assert(api.countries.some(country => country.code === code), 'fallback coverage includes ' + code);
});
console.log('  ✓ country-ISO fallback catalog retained');

console.log('✅ test-historical-eu-maps.js passed all checks successfully.');
