// Regression test — the installed PWA must show NO bottom bar at all.
//
// What the user reported
// ----------------------
// A horizontal strip at the bottom of the screen in the installed app, holding
// the account button (the one showing the e-mail initials — "AN") and the
// geolocation button. Request: delete the whole bar, every element in it, and
// let the map run to the bottom edge. The LEFT controls (zoom, measure,
// coordinates, trail, offline maps, magnifier, compass / rotation-lock /
// Detect) must stay exactly as they are.
//
// What the bar actually was
// -------------------------
// #pwa-br-stack — position:fixed at the bottom-right, z-index 2000:
//   • #btnLiveLocation  (🎯 geolocation / live location), prepended into the
//     stack by js/map-app.js ~200 ms after initMap;
//   • #pwaUserTrigger   (the "AN" / initials button, 38×38) with #pwaAvatar
//     inside and #pwaUserDropdown expanding upwards (Manage Account / Events /
//     Friends / Language / Storage / Log Out);
//   • #pwaLoginTrigger  (the "Log In" pill shown when signed out).
// The earlier full-width bar (.pwa-bottom-bar) had already been removed; this
// stack was what remained at the bottom of the screen.
//
// The fix, in three layers (any one of them alone could be undone)
// ----------------------------------------------------------------
//   1. CSS  — #pwa-br-stack is display:none !important + visibility:hidden +
//             pointer-events:none, and a body.is-pwa rule hides the container
//             and every button inside it with !important. That !important
//             matters: updatePwaUserStack() writes
//             `userTrigger.style.display = 'flex'` inline every 500 ms, and an
//             inline display beats any stylesheet rule without it.
//   2. DOM  — the standalone script in index.html removes the container with
//             removeChild(), so nothing can re-show it.
//   3. JS   — js/map-app.js no longer inserts the live-location button in PWA
//             mode (it returns before touching the DOM), and the tracking
//             helpers are null-guarded so the headless live location started by
//             the Detect switch / the magnifier / trail recording still works.
//
// Run: node test-pwa-no-bottom-bar.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html');
const flat = html.replace(/\n\s*/g, ' ');
// CSS blocks only, with the (very verbose) comments stripped: the selectors
// below are matched structurally, and a comment between two rules would
// otherwise break the "start of rule" anchor.
const cssOnly = (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n')
    .replace(/<\/?style>/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ');
const mapApp = read('js/map-app.js');
const styles = read('css/styles.css');
const sw = read('sw.js');

let passed = 0;
function ok(msg) { passed++; console.log('✓ ' + msg); }

function ruleOf(source, selector, label) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing CSS rule for ' + (label || selector));
    return m[1];
}

/* Like ruleOf, but the selector must start the rule: `#pwa-br-stack` also
   appears inside the selector list of the touch-action block, and "first match
   wins" would grab that one instead. */
function ownRuleOf(source, selector, label) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp('(?:^|\\})\\s*' + escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing standalone CSS rule for ' + (label || selector));
    return m[1];
}

/* ── 1. The container of the whole bar is hidden, hard ─────────────────── */
const stack = ownRuleOf(cssOnly, '#pwa-br-stack', '#pwa-br-stack (the bottom bar)');
assert(/display:\s*none\s*!important/.test(stack),
    '#pwa-br-stack must be display:none !important — an inline display from '
    + 'updatePwaUserStack() would otherwise win');
assert(/visibility:\s*hidden/.test(stack) && /pointer-events:\s*none/.test(stack),
    'the bar must also be invisible and click-through, so nothing can be tapped '
    + 'where it used to be');

/* The rule that used to put the bar on screen must not exist any more. */
assert(!/body\.is-pwa #pwa-br-stack\s*\{\s*display:\s*flex/.test(cssOnly),
    'body.is-pwa #pwa-br-stack { display: flex } is the rule that showed the bar');
assert(!/body\.is-pwa #pwa-br-stack\s*\{\s*display:\s*(flex|block|grid)/.test(cssOnly),
    'no PWA rule may re-open the bottom bar');

/* Every part of the bar is hidden individually, so a stray inline style on one
   button cannot bring a piece of the bar back. (#pwa-br-stack also heads the
   touch-action rule, so pick the block that actually hides something.) */
const hidden = (cssOnly.match(/body\.is-pwa #pwa-br-stack,[^{]*\{[^}]*display:\s*none !important;[^}]*\}/) || [])[0] || '';
assert(hidden, 'a body.is-pwa rule must list the bar and its buttons');
['#pwa-br-stack', '#pwaUserItem', '#pwaUserTrigger', '#pwaLoginTrigger',
 '#pwaUserDropdown', '#btnLiveLocation', '.btn-live-location'].forEach(function (sel) {
    assert(hidden.indexOf(sel) !== -1, 'the PWA hide rule must cover ' + sel);
});
assert(/display:\s*none\s*!important/.test(hidden),
    'the PWA hide rule must use display:none !important');
ok('CSS hides the bar container and every control inside it (!important)');

/* ── 2. The bar is removed from the DOM in standalone mode ─────────────── */
assert(/getElementById\('pwa-br-stack'\)/.test(html),
    'the standalone script must look the bar up by id');
assert(/pwaBottomBar\.parentNode\.removeChild\(pwaBottomBar\)/.test(html),
    'the bar must be remove()d from the DOM, not only hidden');
const removal = /classList\.add\('is-pwa'\);[\s\S]{0,2200}?removeChild\(pwaBottomBar\)/.test(html);
assert(removal,
    'the removal must happen inside the is-pwa branch (the website keeps its markup)');
assert(/classList\.contains\('is-pwa'\)|classList\.add\('is-pwa'\)/.test(html),
    'the PWA layout class still gates the standalone behaviour');
ok('the standalone script removes the bar from the DOM (inline styles cannot bring it back)');

/* ── 3. The geolocation button is never inserted in PWA mode ───────────── */
assert(/if \(isPwaMode\) \{\s*\/\/ Nothing to insert[\s\S]{0,220}?return;\s*\}/.test(mapApp),
    'js/map-app.js must return before inserting the live-location button in PWA mode');
assert(!/stack\.prepend\(liveBtn\)/.test(mapApp),
    'the 🎯 button must no longer be prepended into the bottom bar');
assert(/var zoomCtrl = document\.querySelector\('#detectlab-map \.leaflet-top\.leaflet-left'\);\s*if \(zoomCtrl\) zoomCtrl\.appendChild\(btn\);/.test(mapApp),
    'the website still gets the 🎯 button in the LEFT icon stack (unchanged)');
ok('js/map-app.js no longer builds the geolocation button in the installed app');

/* The live location itself must keep working headless: the Detect switch, the
   trail recorder and the nearby search all call these, and none of them may
   crash on the missing button. */
assert(/window\._startLiveLocation = startTracking;/.test(mapApp)
    && /window\._stopLiveLocation = stopTracking;/.test(mapApp)
    && /window\._isLiveLocationActive = function/.test(mapApp)
    && /window\._showLiveLocation = showLiveLocation;/.test(mapApp),
    'the headless live-location bridge must stay exposed');
assert(!/document\.getElementById\('btnLiveLocation'\)\.classList/.test(mapApp),
    'startTracking() must null-guard the button: it no longer exists in the PWA, '
    + 'and an exception there would kill GPS tracking for the Detect switch');
const guard = /var liveBtn = document\.getElementById\('btnLiveLocation'\);\s*if \(liveBtn\) \{/.test(mapApp);
assert(guard, 'the "active" state of the 🎯 button must be optional');
ok('live location keeps working with no button (Detect switch / magnifier / trail)');

/* ── 4. The content now reaches the bottom edge ────────────────────────── */
const section = ruleOf(cssOnly, 'body.is-pwa #map-section');
assert(/position:\s*fixed/.test(section) && /top:\s*0/.test(section) && /bottom:\s*0/.test(section),
    'the map section must stay stretched to both viewport edges');
assert(/min-height:\s*100vh/.test(section),
    'the 100vh floor must stay — without it iOS leaves the navy band under the map');
assert(!/padding-bottom/.test(section),
    'no bottom padding may shorten the map again');
const leafletBottom = ruleOf(cssOnly, 'body.is-pwa .leaflet-bottom');
assert(/bottom:\s*env\(safe-area-inset-bottom, 0px\) !important/.test(leafletBottom),
    'the Leaflet bottom corners keep anchoring to the real bottom edge');
ok('the map runs to the bottom edge (stretch + 100vh floor, no padding)');

/* ── 5. The LEFT controls are untouched ────────────────────────────────── */
['#btnMeasure', '#btnCoord', '#btnTrack', '#btnOfflineMaps', '#savedLocationsBtn',
 '#pwaNearbyBtn', 'pwaDetectBtn'].forEach(function (id) {
    assert(html.indexOf(id.replace('#', '')) !== -1 || mapApp.indexOf(id.replace('#', '')) !== -1,
        id + ' must still exist in the shipped UI');
});
assert(!/body\.is-pwa #btnMeasure|body\.is-pwa #btnCoord|body\.is-pwa #btnTrack|body\.is-pwa #pwaNearbyBtn/.test(cssOnly),
    'no left-stack button may be hidden by the bottom-bar removal');
const compass = ruleOf(styles.replace(/\n\s*/g, ' '), '#detectlab-map .detectlab-compass');
assert(/margin:\s*0 0 10px 10px !important/.test(compass),
    'the compass / rotation-lock / Detect column keeps its bottom-left position');
const leafletTop = (cssOnly.match(/body\.is-pwa \.leaflet-top\s*\{[^}]*\}/g) || []).pop() || '';
assert(/top:\s*calc\(14px \+ env\(safe-area-inset-top, 0px\)\) !important/.test(leafletTop),
    'the left icon stack keeps its top offset');
const tag = ruleOf(styles.replace(/\n\s*/g, ' '), '.leaflet-container::after');
assert(/bottom:\s*4px/.test(tag) && /right:\s*6px/.test(tag),
    'the "© Leafleet" tag keeps its offset (it is the reference point of PWA_BOTTOM_BAND.md)');
ok('left stack, compass column and the © Leafleet tag did not move');

/* ── 6. Nothing else paints a bar along the bottom ─────────────────────── */
/* (The removal code in index.html deliberately uses a local `pwaBottomBar`
   variable for the node it deletes — that is not a stranded reference to the
   old `.pwa-bottom-bar` markup, which is long gone.) */
['.pwa-bottom-bar', 'bottom-tab-bar', '#bottomBar', 'pwa-bottom-bar"'].forEach(function (stale) {
    assert(html.indexOf(stale) === -1, 'stranded reference to ' + stale);
});
assert(/body\.is-pwa \.map-controls\s*\{[^}]*display:\s*none/.test(cssOnly),
    'the .map-controls row under the map frame stays hidden in the PWA');
assert(/body\.is-pwa \.map-header\s*\{[^}]*display:\s*none/.test(cssOnly),
    'the bottom tab pill (map-header) stays hidden in the PWA');
assert(/body\.is-pwa footer,\s*body\.is-pwa #get-mobile/.test(cssOnly),
    'the page footer stays hidden in the PWA');
ok('no other element paints a strip along the bottom edge');

/* ── 7. Installed PWAs must actually receive it ────────────────────────── */
const cacheName = (sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 123, 'the SW cache must be bumped to v123+ (got v' + cacheName + ')');
assert(/\/\/ v123:/.test(sw), 'the v123 change must be described in the sw.js changelog');
['js/map-app.js', 'js/tutorial.js'].forEach(function (file) {
    const tag = (html.match(new RegExp('src="(' + file.replace('/', '\\/') + '\\?v=[^"]+)"')) || [])[1];
    assert(tag, file + ' must be cache-busted on the page');
    assert(sw.indexOf("'" + tag + "'") !== -1, file + ' must be pre-cached under that exact URL');
});
ok('the service worker is bumped and pre-caches the changed scripts');

console.log('\n' + passed + ' groups passed.');
console.log('OK — the installed PWA has no bottom bar: no "AN" account button, '
    + 'no geolocation button, nothing under the map.');
