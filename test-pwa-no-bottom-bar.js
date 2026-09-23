// Regression test — PWA bottom-right stack restored: 🎯 live-location on top,
// account trigger (AN / Log In) below, both in #pwa-br-stack.
// Run: node test-pwa-no-bottom-bar.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html');
const cssOnly = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n')
    .replace(/<\/?style>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ');
const mapApp = read('js/map-app.js');
const styles = read('css/styles.css');
const tutorial = read('js/tutorial.js');
const sw = read('sw.js');

let passed = 0;
function ok(msg) { passed++; console.log('✓ ' + msg); }

function ruleOf(source, selector, label) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing CSS rule for ' + (label || selector));
    return m[1];
}

function ownRuleOf(source, selector, label) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('(?:^|\\})\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing standalone CSS rule for ' + (label || selector));
    return m[1];
}

/* ── 1. The bottom-right stack is visible in PWA, hidden on website ──── */
const stack = ownRuleOf(cssOnly, '#pwa-br-stack', '#pwa-br-stack base');
assert(/display:\s*none/.test(stack),
    '#pwa-br-stack must be hidden on website (base display:none)');
assert(/position:\s*fixed/.test(stack),
    '#pwa-br-stack base must be position:fixed');
assert(/right:\s*max\(10px, env\(safe-area-inset-right, 0px\)\)/.test(stack),
    '#pwa-br-stack must respect right: max(10px, env(safe-area-inset-right))');
assert(/bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 28px\)/.test(stack),
    '#pwa-br-stack must respect bottom: calc(env(safe-area-inset-bottom)+28px)');
assert(/flex-direction:\s*column/.test(stack),
    '#pwa-br-stack must be column');

const stackPwa = ruleOf(cssOnly, 'body.is-pwa #pwa-br-stack', 'PWA stack visible');
assert(/display:\s*flex\s*!important/.test(stackPwa),
    'body.is-pwa #pwa-br-stack must be display:flex !important');
assert(/visibility:\s*visible/.test(stackPwa) && /pointer-events:\s*auto/.test(stackPwa),
    'PWA stack must be visible and tappable');
ok('bottom-right stack is hidden on website, flex visible in PWA with safe-area offsets');

/* ── 2. Live-location inside stack is relative; fallback fixed ───────── */
const inside = ruleOf(cssOnly, '#pwa-br-stack .pwa-live-location-control', 'inside stack');
assert(/position:\s*relative\s*!important/.test(inside),
    'inside #pwa-br-stack the live-location control must be position:relative !important');
assert(/right:\s*auto/.test(inside) && /bottom:\s*auto/.test(inside),
    'inside stack right/bottom must be auto');

const fallback = ruleOf(cssOnly, 'html.is-pwa .pwa-live-location-control', 'fallback fixed');
assert(/position:\s*fixed\s*!important/.test(fallback)
    && /right:\s*max\(10px, env\(safe-area-inset-right, 0px\)\)\s*!important/.test(fallback)
    && /bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 28px\)\s*!important/.test(fallback),
    'fallback html.is-pwa .pwa-live-location-control must stay fixed bottom-right');
ok('live-location control is relative inside stack, fixed fallback when stack missing');

/* ── 3. Standalone script must NOT remove the stack ──────────────────── */
assert(!/pwaBottomBar\.parentNode\.removeChild\(pwaBottomBar\)/.test(html),
    'standalone script must NOT removeChild #pwa-br-stack');
assert(/getElementById\('pwa-br-stack'\)/.test(html),
    'standalone script must reference #pwa-br-stack');
assert(/setAttribute\('aria-hidden',\s*'false'\)/.test(html) || /aria-hidden.*false/.test(html),
    'standalone script should keep stack aria-hidden=false');
ok('standalone mode keeps #pwa-br-stack in DOM');

/* ── 4. map-app.js mounts 🎯 into #pwa-br-stack as first child ───────── */
assert(/var pwaStack = document\.getElementById\('pwa-br-stack'\)/.test(mapApp),
    'map-app.js must look up #pwa-br-stack');
assert(/pwaStack\.insertBefore\(btn, pwaStack\.firstChild\)/.test(mapApp),
    'map-app.js must prepend live-location as firstChild of stack');
assert(/pwaStack\.appendChild\(btn\)/.test(mapApp),
    'fallback appendChild when firstChild missing');
assert(/else\s*\{\s*var zoomCtrl = document\.querySelector\('#detectlab-map \.leaflet-top\.leaflet-left'\);/.test(mapApp),
    'website still inserts 🎯 below zoom in left stack');
ok('🎯 mounted into #pwa-br-stack first, account below; website keeps left column');

/* ── 5. Panel open hides both controls ───────────────────────────────── */
const hiddenRule = cssOnly.includes('transp-panel-open #pwa-br-stack') || cssOnly.includes('transp-panel-open .pwa-live-location-control');
assert(hiddenRule, 'transp-panel-open must hide #pwa-br-stack / .pwa-live-location-control');
assert(/transp-panel-open #pwa-br-stack/.test(cssOnly) && /visibility:\s*hidden/.test(cssOnly),
    'hidden rule must set visibility:hidden');
ok('transp-panel-open hides the stack (both buttons)');

/* ── 6. Account dropdown still functional ─────────────────────────────── */
assert(/pwaUserDropdown/.test(html) && /togglePwaUserDropdown/.test(html),
    'account dropdown must remain in DOM');
assert(/pwaUserTrigger/.test(html) && /pwaLoginTrigger/.test(html),
    'both logged-in and logged-out triggers must exist');
ok('account trigger + dropdown markup preserved');

/* ── 7. SW cache bump ─────────────────────────────────────────────────── */
const cacheName = (sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 136, 'SW cache must be bumped to v136+ (got v' + cacheName + ')');
assert(/\/\/ v136:/.test(sw), 'v136 description must be in sw.js');
['js/map-app.js', 'css/styles.css'].forEach(function (file) {
    const tag = (html.match(new RegExp('src=\"' + file.replace('/', '\\/').replace('.', '\\.') + '[^\"]*\"|href=\"' + file.replace('/', '\\/').replace('.', '\\.') + '[^\"]*\"')) || [])[0];
    assert(tag, file + ' must be referenced with version');
});
const mapTag = (html.match(/src=\"(js\/map-app\.js\?v=[^\"]+)\"/) || [])[1];
assert(mapTag && sw.includes("'" + mapTag + "'"), 'map-app.js version must be pre-cached');
ok('service worker cache-busts and pre-caches restored stack assets');

console.log('\n' + passed + ' groups passed.');
console.log('OK — PWA bottom-right stack restored: 🎯 on top, account below, safe-area respected, hidden on panel open.');
