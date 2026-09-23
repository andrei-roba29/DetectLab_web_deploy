// Regression test — the dark band under the map in the installed PWA, and the
// control-offset contract that must survive its removal.
//
// Root cause (see PWA_BOTTOM_BAND.md)
// -----------------------------------
// #map-section is position:fixed, so top:0 / bottom:0 resolve against the
// initial containing block. This page asks iOS for the one viewport documented
// to come up short there:
//
//     viewport-fit=cover
//   + apple-mobile-web-app-status-bar-style: black-translucent
//   + a document sized in % / svh / dvh
//
// WebKit then hands the page an ICB that is safe-area-inset-top (~59px on a
// Face-ID iPhone) shorter than the physical screen: content is laid out from
// y=0 behind the translucent status bar, but the box height is never
// compensated. bottom:0 therefore stops ~59px above the bottom edge, the map
// container ends there, the "© Leafleet" tag (anchored 4px above that
// container's bottom) sits on top of the gap, and the empty #060E1E page
// background shows through underneath it — the "bottom padding / bottom bar".
//
// Every reading of the ICB is short by the same amount (%, svh, dvh and
// bottom:0 alike), which is why v109's ladder → stretch rewrite did not remove
// it. 100vh is the one unit WebKit resolves to the FULL screen in this mode,
// so the stretched boxes carry min-height:100vh as a floor.
//
// Run: node test-pwa-bottom-band.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const flat = (s) => s.replace(/\n\s*/g, ' ');
const html = flat(read('index.html'));
const styles = flat(read('css/styles.css'));
const offlineCss = flat(read('css/offline-maps.css'));
const sw = read('sw.js');
const probe = read('js/pwa-debug.js');

function ruleOf(source, selector, label) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing CSS rule for ' + (label || selector));
    return m[1];
}

/* ── 1. The floor that closes the band ─────────────────────────────────── */
const section = ruleOf(html, 'body.is-pwa #map-section');
assert(/min-height:\s*100vh/.test(section),
    '#map-section needs the 100vh floor: bottom:0 resolves against an ICB that '
    + 'viewport-fit=cover + black-translucent leave ~safe-area-inset-top short');
assert(/position:\s*fixed/.test(section) && /top:\s*0/.test(section) && /bottom:\s*0/.test(section),
    'the section stays stretched between the viewport edges');
assert(/height:\s*auto\s*!important/.test(section),
    'the floor must clamp the stretched box, not replace it with a computed height');
assert(!/height:\s*100dvh/.test(section) && !/height:\s*100svh/.test(section)
    && !/height:\s*calc\(var\(--vh/.test(section),
    'no vh/svh/dvh size ladder — iOS settles those one frame late');

const panel = ruleOf(html, 'body.is-pwa .transp-panel');
assert(/min-height:\s*100vh\s*!important/.test(panel),
    'the layers window is position:fixed too, so it needs the same floor or it '
    + 'shows the very band it was made flush to avoid');
assert(/bottom:\s*0\s*!important/.test(panel) && /height:\s*auto\s*!important/.test(panel),
    'the layers window keeps its anchor-driven geometry');

/* The trio is the cause, but removing black-translucent would trade the bottom
   band for an iOS-painted status-bar strip at the top and shift every
   env(safe-area-inset-top) consumer. The floor fixes the bottom without
   touching the top, so the meta tags are asserted UNCHANGED on purpose. */
assert(/name="viewport"[^>]*viewport-fit=cover/.test(html),
    'viewport-fit=cover must stay (the top safe-area handling depends on it)');
assert(/name="apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/.test(html),
    'black-translucent must stay: dropping it would move the top controls and '
    + 'hand the status-bar strip to iOS');

/* ── 2. THE CONTRACT — no account bar; live location stays bottom-right ─ */
/* The account stack is removed from the standalone PWA, but its former GPS
   control is now an independent fixed button in the same right-bottom position.
   The home-indicator and compass/action-dock offsets stay unchanged. */
const stack = (html.match(/#pwa-br-stack\s*\{\s*display:\s*none !important;\s*position:\s*fixed;[^}]*\}/) || [])[0] || '';
assert(stack, 'the #pwa-br-stack account menu stays display:none !important');
assert(/visibility:\s*hidden/.test(stack) && /pointer-events:\s*none/.test(stack),
    'the account stack must remain invisible and click-through');
assert(/body\.is-pwa #pwa-br-stack,[\s\S]{0,400}?display:\s*none !important;/.test(html),
    'standalone CSS must hard-hide the account stack against inline auth styles');
assert(/getElementById\('pwa-br-stack'\)/.test(html) && /removeChild\(pwaBottomBar\)/.test(html),
    'the standalone script must remove the account stack from the DOM');

const liveControl = ruleOf(html, 'html.is-pwa .pwa-live-location-control');
assert(/position:\s*fixed\s*!important/.test(liveControl),
    'the live-location button must be positioned independently of Leaflet');
assert(/right:\s*max\(10px, env\(safe-area-inset-right, 0px\)\)\s*!important/.test(liveControl),
    'the live-location button must keep its right edge offset');
assert(/bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 28px\)\s*!important/.test(liveControl),
    'the live-location button must clear the home indicator and © Leafleet tag');
assert(/z-index:\s*2000\s*!important/.test(liveControl)
    && /pointer-events:\s*auto\s*!important/.test(liveControl),
    'the location button must stay tappable above the map');
assert(!/body\.is-pwa #btnLiveLocation|body\.is-pwa \.btn-live-location/.test(html),
    'no PWA rule may hide the restored 🎯 control');

const leafletBottom = ruleOf(html, 'body.is-pwa .leaflet-bottom');
assert(/bottom:\s*env\(safe-area-inset-bottom, 0px\) !important/.test(leafletBottom),
    'compass / rotation-lock / Detect column: bottom offset changed');

const pwaVars = (html.match(/(?:^|\})\s*body\.is-pwa\s*\{[^}]*\}/) || [])[0] || '';
assert(/--pwa-bottom-controls-clearance:\s*44px/.test(pwaVars),
    'published bottom clearance changed (overlay lifts depend on it)');
assert(/--pwa-bottom-controls-half-clearance:\s*0px/.test(pwaVars),
    'published half clearance changed (vertically-centred controls depend on it)');

const dock = ruleOf(styles, 'body.is-pwa .layer-action-dock');
assert(/bottom:\s*calc\(20px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(dock),
    'layer action dock: bottom offset changed');

const offPanel = ruleOf(offlineCss, 'body.is-pwa .offline-map-panel');
assert(/bottom:\s*calc\(8px \+ var\(--pwa-bottom-controls-clearance, 44px\)\)/.test(offPanel),
    'offline-map panel: bottom offset changed');

const tag = ruleOf(styles, '.leaflet-container::after');
assert(/bottom:\s*4px/.test(tag) && /right:\s*6px/.test(tag),
    'the © Leafleet tag moved — it is the reference point of the whole report');

/* ── 3. The on-device probe is gated and reachable offline ─────────────── */
const probeTag = (html.match(/<script src="(js\/pwa-debug\.js\?v=[^"]+)"/) || [])[1];
assert(probeTag, 'index.html must load js/pwa-debug.js with a cache-busted URL');
assert(sw.indexOf("'" + probeTag + "'") !== -1,
    'sw.js must pre-cache the exact probe URL the page requests (' + probeTag + ')');

assert(/\?pwaDebug=/.test(probe) && /dlPwaDebug/.test(probe),
    'the probe is switched by ?pwaDebug= and remembers the choice');
assert(/if \(initial === 'off'\) return;/.test(probe),
    'the probe must do nothing at all unless it was explicitly enabled');
assert(/TAP_COUNT = 5/.test(probe) && /inTagHotspot/.test(probe),
    'the five-tap gesture is the only way in from the installed app: iOS gives '
    + 'an Add-to-Home-Screen web app its own storage container, so a flag set '
    + 'in Safari never reaches it');
assert(/fixedBottom0/.test(probe) && /vh100/.test(probe)
    && /dvh100/.test(probe) && /svh100/.test(probe),
    'the probe must measure the ICB edge and every candidate unit');
assert(/safe-area-inset-top/.test(probe) && /safe-area-inset-bottom/.test(probe),
    'the probe must resolve env(safe-area-inset-*) to px');
assert(/#map-section/.test(probe) && /#detectlab-map/.test(probe)
    && /dlPwaDebugTagProbe/.test(probe),
    'the probe must report the section, the map container and the tag');
assert(/dl-pwa-debug-colors/.test(probe) && /#ff0000/i.test(probe),
    'the colour-band mode must stay available to name the painter');

/* ── 4. Installed PWAs must actually receive it ────────────────────────── */
const cacheName = (sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 112, 'the SW cache must be bumped to v112+ (got v' + cacheName + ')');
assert(/\/\/ v112:/.test(sw), 'the v112 change must be described in the sw.js changelog');

console.log('✓ #map-section + .transp-panel carry the min-height:100vh floor '
    + '(the ICB is safe-area-inset-top short under viewport-fit=cover + black-translucent)');
console.log('✓ the meta tags stay untouched — the top controls keep their clearance');
console.log('✓ account stack removed; live-location button fixed at bottom-right; compass, clearances, '
    + 'action dock, offline panel and © Leafleet tag remain intact');
console.log('✓ the on-device probe is gated, pre-cached and measures ICB / vh / dvh / svh / env()');
console.log('OK — the band under the map is closed at the source, and nothing moved.');
