// Regression test — the PWA account bar stays removed, while the live-location
// button is available as a separate control at the bottom-right.
//
// The old #pwa-br-stack combined the 🎯 location button with the account
// initials / Log In menu. Removing that whole stack also removed the user's
// direct way to toggle live location. The current contract is narrower:
//   • remove the account stack from standalone mode;
//   • keep the 🎯 button, fixed at the bottom-right with safe-area clearance;
//   • keep the website button in the left Leaflet control column.
//
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

/* ── 1. The account stack is hidden/removed, but not confused with GPS ──── */
const stack = ownRuleOf(cssOnly, '#pwa-br-stack', '#pwa-br-stack (account menu)');
assert(/display:\s*none\s*!important/.test(stack),
    'the legacy account stack stays hidden in the base layout');
assert(/visibility:\s*hidden/.test(stack) && /pointer-events:\s*none/.test(stack),
    'the legacy account stack must remain invisible and click-through');
const accountHide = (cssOnly.match(/body\.is-pwa #pwa-br-stack,[^{]*\{[^}]*display:\s*none !important;[^}]*\}/) || [])[0] || '';
assert(accountHide, 'standalone CSS must hard-hide the account stack');
['#pwa-br-stack', '#pwaUserItem', '#pwaUserTrigger', '#pwaLoginTrigger', '#pwaUserDropdown']
    .forEach(sel => assert(accountHide.includes(sel), 'the PWA account hide rule must cover ' + sel));
assert(!accountHide.includes('#btnLiveLocation') && !accountHide.includes('.btn-live-location'),
    'the PWA account hide rule must not hide the live-location button');
assert(!/body\.is-pwa \.btn-live-location\s*\{[^}]*display:\s*none/.test(cssOnly),
    'no standalone rule may hide the 🎯 button');
ok('the account/menu stack is hidden, independently of the live-location control');

/* ── 2. The standalone script removes the account menu only ────────────── */
assert(/getElementById\('pwa-br-stack'\)/.test(html)
    && /pwaBottomBar\.parentNode\.removeChild\(pwaBottomBar\)/.test(html),
    'standalone mode must remove the account stack from the DOM');
assert(!/removeChild\([^)]*btnLiveLocation/.test(html)
    && !/\['btnLiveLocation'\]/.test(html),
    'the standalone script must not remove the live-location button');
assert(/classList\.add\('is-pwa'\);[\s\S]{0,1800}?removeChild\(pwaBottomBar\)/.test(html),
    'account-stack removal must stay scoped to standalone mode');
ok('standalone mode removes the account menu without deleting the GPS button');

/* ── 3. The live-location control is restored at bottom-right in PWA ───── */
assert(/if \(isPwaMode\) \{[\s\S]{0,280}?btn\.classList\.add\('pwa-live-location-control'\);[\s\S]{0,150}?document\.body\.appendChild\(btn\);/.test(mapApp),
    'js/map-app.js must insert the PWA location control into the document body');
assert(/else\s*\{\s*var zoomCtrl = document\.querySelector\('#detectlab-map \.leaflet-top\.leaflet-left'\);\s*if \(zoomCtrl\) zoomCtrl\.appendChild\(btn\);/.test(mapApp),
    'the website still inserts the 🎯 button below zoom in the left stack');
const pwaControl = ruleOf(cssOnly, 'html.is-pwa .pwa-live-location-control');
assert(/position:\s*fixed\s*!important/.test(pwaControl)
    && /right:\s*max\(10px, env\(safe-area-inset-right, 0px\)\)\s*!important/.test(pwaControl)
    && /bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 28px\)\s*!important/.test(pwaControl),
    'the PWA location button must sit at the former bottom-right offset and clear safe areas');
assert(/z-index:\s*2000\s*!important/.test(pwaControl)
    && /pointer-events:\s*auto\s*!important/.test(pwaControl),
    'the fixed PWA button must stay tappable above the map');
assert(/btnLiveLocation/.test(mapApp) && /L\.DomEvent\.on\(btnEl, 'click'/.test(mapApp),
    'the restored button must keep its existing live-location click handler');
ok('the 🎯 button is fixed at bottom-right in PWA and remains left-side on the website');

/* Programmatic location starts remain safe before the control is mounted. */
assert(/window\._startLiveLocation = startTracking;/.test(mapApp)
    && /window\._stopLiveLocation = stopTracking;/.test(mapApp)
    && /window\._isLiveLocationActive = function/.test(mapApp)
    && /window\._showLiveLocation = showLiveLocation;/.test(mapApp),
    'the shared live-location bridge must stay exposed');
assert(/var liveBtn = document\.getElementById\('btnLiveLocation'\);\s*if \(liveBtn\) \{/.test(mapApp),
    'programmatic GPS starts must be safe if the button is not mounted yet');
ok('the Detect switch / nearby search / trail recorder can still use live-location APIs');

/* ── 4. The map still reaches the bottom edge ──────────────────────────── */
const section = ruleOf(cssOnly, 'body.is-pwa #map-section');
assert(/position:\s*fixed/.test(section) && /top:\s*0/.test(section) && /bottom:\s*0/.test(section)
    && /min-height:\s*100vh/.test(section) && !/padding-bottom/.test(section),
    'the map section stays stretched to the bottom edge with no shortening padding');
const leafletBottom = ruleOf(cssOnly, 'body.is-pwa .leaflet-bottom');
assert(/bottom:\s*env\(safe-area-inset-bottom, 0px\) !important/.test(leafletBottom),
    'the compass column still clears the home indicator');
ok('the map edge and bottom-left compass geometry remain unchanged');

/* ── 5. Installed PWAs receive fresh, matching assets ──────────────────── */
const cacheName = (sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 133, 'the SW cache must be bumped to v133+ (got v' + cacheName + ')');
assert(/\/\/ v133:/.test(sw), 'the live-location restoration must be described in sw.js');
['js/map-app.js', 'js/tutorial.js'].forEach(function (file) {
    const tag = (html.match(new RegExp('src="(' + file.replace('/', '\\/') + '\\?v=[^"]+)"')) || [])[1];
    assert(tag, file + ' must be cache-busted on the page');
    assert(sw.includes("'" + tag + "'"), file + ' must be pre-cached under that exact URL');
});
assert(tutorial.includes('dreapta-jos') && tutorial.includes('bottom-right'),
    'the tutorial must document the restored PWA button position in both languages');
ok('the service worker cache-busts and pre-caches the restored PWA control');

console.log('\n' + passed + ' groups passed.');
console.log('OK — the PWA account bar is still gone, and the live-location button is back at bottom-right.');
