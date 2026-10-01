#!/usr/bin/env node
'use strict';

// Market isolation regression test.
//
// detectlab.ro must behave exactly as it did BEFORE the European variant was
// merged, while detectlab.eu keeps everything the European variant added:
//   .ro: map locked to the Romanian APM canvas, EN/RO languages only,
//        no CENAGIS / IH PAN European historical maps.
//   .eu: free European panning, 25 pan-European languages, CENAGIS maps.
//
// Usage: node test-ro-market-isolation.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

console.log('[Test] detectlab.ro market isolation (the .ro site stays unchanged)...');

// ── 1. site-config.js: per-market languages + data-market marker ──
function makeDocumentElement() {
    const attributes = {};
    return {
        lang: 'ro',
        setAttribute(name, value) { attributes[name] = String(value); },
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null; },
        _attributes: attributes
    };
}

function loadSiteConfig(hostname) {
    const documentElement = makeDocumentElement();
    const document = {
        documentElement,
        readyState: 'loading',
        addEventListener() {},
        querySelectorAll() { return []; }
    };
    const window = { location: { hostname, pathname: '/' }, localStorage: { getItem() { return null; } } };
    vm.runInContext(read('js/site-config.js'), vm.createContext({ window, document }), { filename: 'js/site-config.js' });
    return { window, document };
}

const roConfig = loadSiteConfig('detectlab.ro');
assert.equal(roConfig.window.DetectLabSite.market, 'ro');
assert.equal(roConfig.window.DetectLabSite.isRomania, true);
assert.equal(roConfig.window.DetectLabSite.isEurope, false);
assert.deepEqual([...roConfig.window.DetectLabSite.languages], ['ro', 'en']);
assert.equal(roConfig.document.documentElement.getAttribute('data-market'), 'ro');

const wwwRoConfig = loadSiteConfig('www.detectlab.ro');
assert.equal(wwwRoConfig.window.DetectLabSite.market, 'ro', 'www.detectlab.ro normalises to the Romanian market');

const euConfig = loadSiteConfig('detectlab.eu');
assert.equal(euConfig.window.DetectLabSite.market, 'eu');
assert.equal(euConfig.window.DetectLabSite.isEurope, true);
assert.equal(euConfig.window.DetectLabSite.defaultLanguage, 'en');
assert.equal(euConfig.window.DetectLabSite.languages.length, 25, 'the European market keeps all 25 languages');
assert.equal(euConfig.document.documentElement.getAttribute('data-market'), 'eu');
console.log('  ✓ site-config.js: languages and data-market follow the origin');

// ── 2. translations.js: language selection is market-scoped ──
function loadTranslations(hostname, storedLanguage, detectLabSite) {
    const documentElement = makeDocumentElement();
    const document = {
        documentElement,
        readyState: 'complete',
        addEventListener() {},
        dispatchEvent() {},
        getElementById() { return null; },
        querySelectorAll() { return []; }
    };
    const window = {
        location: { hostname, pathname: '/' },
        localStorage: {
            getItem() { return storedLanguage; },
            setItem() {}
        },
        DetectLabSite: detectLabSite
    };
    const context = vm.createContext({
        window,
        document,
        localStorage: window.localStorage,
        CustomEvent: function CustomEvent(type) { this.type = type; },
        IntersectionObserver: function IntersectionObserver() {
            this.observe = () => {};
            this.unobserve = () => {};
            this.disconnect = () => {};
        }
    });
    vm.runInContext(read('js/translations.js'), context, { filename: 'js/translations.js' });
    return context;
}

const roTranslations = loadTranslations('detectlab.ro', null, {
    market: 'ro', isEurope: false, isRomania: true,
    defaultLanguage: 'ro', languages: ['ro', 'en']
});
assert.equal(roTranslations.window._currentLang(), 'ro', '.ro starts in Romanian');

// A language stored while the European variant leaked onto .ro is ignored there…
roTranslations.window.setLang('de');
assert.equal(roTranslations.window._currentLang(), 'ro', '.ro refuses German and falls back to Romanian');
roTranslations.window.setLang('en');
assert.equal(roTranslations.window._currentLang(), 'en', '.ro still accepts English, as it always did');

const roWithGermanStored = loadTranslations('detectlab.ro', 'de', {
    market: 'ro', isEurope: false, isRomania: true,
    defaultLanguage: 'ro', languages: ['ro', 'en']
});
assert.equal(roWithGermanStored.window._currentLang(), 'ro', 'a stored German choice does not leak onto .ro');

// …while .eu keeps the full pan-European set.
const euTranslations = loadTranslations('detectlab.eu', null, {
    market: 'eu', isEurope: true, isRomania: false,
    defaultLanguage: 'en', languages: ['en', 'ro', 'de', 'fr', 'it', 'es', 'pl', 'uk', 'hu', 'cs', 'sk', 'nl', 'bg', 'el', 'pt', 'da', 'sv', 'no', 'fi', 'et', 'lv', 'lt', 'hr', 'sr', 'sl']
});
assert.equal(euTranslations.window._currentLang(), 'en', '.eu starts in English');
euTranslations.window.setLang('de');
assert.equal(euTranslations.window._currentLang(), 'de', '.eu still accepts German');
console.log('  ✓ translations.js: .ro accepts only ro/en; .eu keeps every language');

// ── 3. index.html: European-variant options are flagged data-eu-only ──
const html = read('index.html');

const desktopOptions = html.match(/<div class="lang-option[^"]*"[^>]*id="langOpt[A-Za-z]{2}"/g) || [];
assert.equal(desktopOptions.length, 25, 'the desktop language menu ships all 25 options for .eu');
const desktopGated = desktopOptions.filter(o => o.includes('data-eu-only'));
assert.equal(desktopGated.length, 23, '23 of them are European-variant-only');
assert.ok(desktopOptions.some(o => o.includes('id="langOptEn"') && !o.includes('data-eu-only')), 'EN stays on .ro');
assert.ok(desktopOptions.some(o => o.includes('id="langOptRo"') && !o.includes('data-eu-only')), 'RO stays on .ro');

const pwaOptions = html.match(/<button class="pwa-drop-item pwa-drop-subitem[^"]*"[^>]*id="pwaLangOpt[A-Za-z]{2}"/g) || [];
assert.equal(pwaOptions.length, 25, 'the PWA language submenu ships all 25 options for .eu');
assert.equal(pwaOptions.filter(o => o.includes('data-eu-only')).length, 23, '23 of them are European-variant-only');
assert.ok(pwaOptions.some(o => o.includes('id="pwaLangOptEn"') && !o.includes('data-eu-only')), 'EN stays on .ro (PWA)');
assert.ok(pwaOptions.some(o => o.includes('id="pwaLangOptRo"') && !o.includes('data-eu-only')), 'RO stays on .ro (PWA)');

for (const row of ['mitteleuropaRow', 'chrzanowskiRow', 'reymannRow', 'kdr100kRow', 'kdrGbRow', 'wig100kRow', 'histEuRow']) {
    const pattern = new RegExp('id="' + row + '"[^>]*data-eu-only|data-eu-only[^>]*id="' + row + '"');
    assert.ok(pattern.test(html), row + ' is flagged data-eu-only');
}

// The long scrollable language menus are scoped to the European market.
assert.match(html, /html\[data-market='eu'\] \.pwa-drop-sub/, 'the scrollable PWA language list is .eu-only');
console.log('  ✓ index.html: 46 language options and 7 layer rows are European-only');

// ── 4. css: market gating rules ──
const css = read('css/styles.css');
assert.match(css, /html\[data-market='ro'\] \[data-eu-only\]\s*\{\s*display:\s*none\s*!important;/, '.ro hides European-variant elements');
assert.match(css, /html\[data-market='eu'\] \[data-ro-only\]\s*\{\s*display:\s*none\s*!important;/, '.eu hides Romania-only elements');
assert.match(css, /html\[data-market='eu'\] \.lang-menu/, 'the wide scrollable language menu is scoped to .eu');
const baseLangMenu = css.match(/^ {8}\.lang-menu \{[^}]*/m) || [];
assert.ok(baseLangMenu.length > 0, 'the base .lang-menu rule exists');
assert.doesNotMatch(baseLangMenu[0], /max-height|overflow-y/, 'the base .lang-menu keeps its compact pre-EU size');
assert.match(baseLangMenu[0], /min-width:\s*110px/, 'the base .lang-menu keeps its original 110px width');
console.log('  ✓ css/styles.css: market gating rules in place');

// ── 5. map-app.js: the Romanian APM canvas lock is restored on .ro ──
const mapApp = read('js/map-app.js');
assert.match(mapApp, /var MAP_PAN_BOUNDS = L\.latLngBounds\(APM_BOUNDS\)/, 'MAP_PAN_BOUNDS exists again');
assert.match(mapApp, /maxBounds:\s*EU_MARKET\s*\?\s*null\s*:\s*MAP_PAN_BOUNDS/, 'maxBounds applies only on .ro');
assert.match(mapApp, /maxBoundsViscosity:\s*EU_MARKET\s*\?\s*0\s*:\s*1\.0/, 'rigid bounds only on .ro');
assert.match(mapApp, /if \(!EU_MARKET\) \{[\s\S]*?enforceMapCanvasBounds[\s\S]*?map\.on\('dragend zoomend', enforceMapCanvasBounds\);/, 'the canvas snap runs only on .ro');
assert.match(mapApp, /map\.panInsideBounds\(MAP_PAN_BOUNDS/, 'panInsideBounds snapping restored');
assert.match(mapApp, /\.fitBounds\(APM_BOUNDS\)/, 'both markets still open on Romania');
// CENAGIS layers, coverages and highlights exist only on .eu:
assert.match(mapApp, /if \(typeof _isEuropeMarket === 'function' && _isEuropeMarket\(\)\) \{\s*\n\s*var CENAGIS_WMS_URL/, 'the CENAGIS WMS layers are created only on .eu');
assert.match(mapApp, /premiumMapCoverageBounds\.mitteleuropa = \{/, 'CENAGIS coverages register dynamically');
assert.match(mapApp, /if \(_isEuropeMarket\(\)\) \{\s*\n\s*premiumKeys = premiumKeys\.concat\(/, 'CENAGIS highlight rows register only on .eu');
assert.match(mapApp, /if \(_isEuropeMarket\(\)\) \{\s*\n\s*groups\.histEu = /, 'the histEu group registers only on .eu');
console.log('  ✓ map-app.js: .ro map lock restored, CENAGIS layers gated to .eu');

// ── 6. historical-eu-maps.js: no panel on .ro ──
const euMaps = read('js/historical-eu-maps.js');
assert.match(euMaps, /function _isEuMarket\(\)/, 'market check exists');
assert.match(euMaps, /function renderUi\(\) \{\s*\n\s*if \(!_isEuMarket\(\)\) return;/, 'renderUi refuses the Romanian market');
assert.match(euMaps, /init: function \(leafletMap\) \{[\s\S]{0,300}?if \(!_isEuMarket\(\)\) return;/, 'init refuses the Romanian market');
console.log('  ✓ historical-eu-maps.js: the panel never renders on .ro');

// ── 7. sw.js: the shell refreshes and skips European assets on .ro ──
const sw = read('sw.js');
const shellVersion = Number((sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1]);
assert.ok(shellVersion >= 149, 'sw.js cache must be v149+ so installed PWAs drop the leaked European variant');
assert.match(sw, /precacheUrlsForOrigin/, 'the install handler filters precache by origin');
assert.match(sw, /SW_EU_ORIGIN/, 'the service worker knows its market');
assert.match(sw, /url\.indexOf\('historical-eu-maps\.js'\) === -1/, 'historical-eu-maps.js is not precached on .ro');
assert.match(sw, /js\/site-config\.js\?v=20261001-market-isolation/, 'site-config precache URL is re-versioned');
assert.match(sw, /js\/translations\.js\?v=20261001-market-isolation/, 'translations precache URL is re-versioned');
assert.match(sw, /js\/historical-eu-maps\.js\?v=20261001-market-isolation/, 'historical-eu-maps precache URL is re-versioned');
console.log('  ✓ sw.js: v%d shell, market-filtered precache', shellVersion);

console.log('✅ detectlab.ro is fully restored; the European variant lives only on detectlab.eu.');
