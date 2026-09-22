// Regression test — v125: the installed PWA must pick up the latest app shell.
//
// What was broken
// ---------------
// In the installed PWA the user could not keep two layer sliders on the map
// and the mirror showed no layer title on its side — even though both
// features had already shipped (v121's rotated side-title fallback for
// standalone WebViews, v122's second mirror slot). The website itself was
// fine. An installed app keeps running the shell it opened with: the WebView
// snapshot survives ordinary "restarts" on phones, the client never asked
// the browser to re-check sw.js, and nothing reloaded the page once a new
// service worker actually activated (sw.js does skipWaiting + clients.claim,
// but the OLD page DOM stays in charge until a full reload). Net effect: the
// PWA ran the pre-v121/pre-v122 shell indefinitely.
//
// The fix is in index.html's service-worker registration block:
//   1. reg.update() runs right after load, on pageshow, on visibilitychange
//      (returning to the foreground) and once a minute while the app is open;
//   2. when a NEW service worker takes control (controllerchange) AND an old
//      one was already in charge, the page reloads exactly once — guarded by
//      a sessionStorage timestamp against reload loops;
//   3. the corrupt trailing bytes after </html> (a duplicated script fragment
//      and stray text) are gone, so the document parses as one clean unit.
//
// Run: node test-pwa-shell-refresh.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html');
const sw = read('sw.js');
const css = read('css/styles.css');

/* 1. The cache version is bumped so the byte-difference triggers an update
      and old caches are purged on activate. */
assert(
    sw.includes("const CACHE_NAME = 'detectlab-v125-pwa-shell-refresh';"),
    'sw.js must carry the v125 cache name'
);
assert(sw.includes('skipWaiting()'), 'sw.js must skipWaiting on install');
assert(sw.includes('clients.claim()'), 'sw.js must claim clients on activate');

/* 2. The registration block re-checks for updates on the realistic triggers:
      after load (registration), on pageshow, on foregrounding and on a
      one-minute interval while the app stays open. */
assert(sw.length > 0);
assert(html.includes("navigator.serviceWorker.register('sw.js')"), 'sw.js registration is missing');
assert(html.includes('typeof reg.update'), 'the registration must call reg.update()');
assert(html.includes("window.addEventListener('pageshow', dlSwCheckForUpdate)"),
    'reg.update() must also run on pageshow');
assert(html.includes("document.visibilityState === 'visible'"),
    'reg.update() must also run when the app returns to the foreground');
assert(html.includes('window.setInterval(dlSwCheckForUpdate, 60 * 1000)'),
    'reg.update() must also run once a minute while open');

/* 3. Controller swap → single reload, only over a previous controller. */
assert(html.includes("addEventListener('controllerchange'"),
    'a controllerchange listener is required');
assert(html.includes('dlSwHadController'), 'reload must only fire when an old controller existed');
assert(html.includes('dl-sw-reload-at'), 'the reload loop guard (sessionStorage timestamp) is required');
assert(html.includes('window.location.reload()'), 'controllerchange must reload the page');

/* 4. The document tail is clean: one </body> before one </html>, nothing
      (but whitespace) after </html>. */
const trimmed = html.trimEnd();
assert(trimmed.endsWith('</html>'), 'index.html must end with </html>');
const afterHtml = trimmed.slice(trimmed.indexOf('</html>') + '</html>'.length);
assert.strictEqual(afterHtml, '', 'nothing may follow </html> (corrupt tail regression)');
assert.strictEqual((html.match(/<\/body>/g) || []).length, 1, 'exactly one </body>');
assert(trimmed.indexOf('</body>') < trimmed.indexOf('</html>'), '</body> must precede </html>');
// Every script element — including the SW registration — lives inside <body>.
const bodyEnd = trimmed.indexOf('</body>');
assert(trimmed.lastIndexOf('<script') < bodyEnd, 'no script element may sit outside <body>');

/* 5. The features the refresh delivers are still wired: the second mirror
      slot markup, the side-title fallback for standalone WebViews and the
      precache entries of the current versioned shell. */
assert(html.includes('id="verticalOpacityControlSecondary"'), 'second mirror slot is missing from index.html');
assert(html.includes('id="verticalOpacitySliderSecondary"'), 'second mirror slider is missing');
assert(css.includes('body.is-pwa .vertical-opacity-layer'),
    'the standalone-PWA rotated layer title fallback is missing from styles.css');
assert(css.includes('.vertical-opacity-control.vertical-opacity-secondary'),
    'the second mirror anchor is missing from styles.css');
assert(sw.includes('css/styles.css?v=20260922-mirrored-light-shade'),
    'sw.js must precache the current styles.css');
assert(sw.includes('js/vertical-opacity-control.js?v=20260922-mirrored-light-shade'),
    'sw.js must precache the current vertical-opacity-control.js');

console.log('OK — the installed PWA re-checks sw.js, reloads onto the newest shell once,');
console.log('    and the document tail is clean; the two-slider + side-title shell ships intact.');
