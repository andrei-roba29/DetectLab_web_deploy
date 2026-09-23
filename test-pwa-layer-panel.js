// Regression test — the layers window in the installed PWA must fill the screen.
//
// What was broken
// ---------------
// · .transp-panel carried a hardcoded `height: 560px; max-height: 560px`. On the
//   website that is exactly the height of the map frame, so nothing looked wrong
//   — but the installed PWA paints the map edge to edge (100dvh), and 560px on a
//   ~900px phone is "the window stops after the lower half of the screen".
// · A later PWA override stopped the panel at `env(safe-area-inset-bottom)`,
//   which left a navy strip of padding under the window and made it look cropped.
// · Stretching the panel to the bottom could put floating controls over the
//   last rows. Keep the live-location button at its bottom-right anchor, but
//   hide it in place while the layers window is open; never teleport it over
//   compass / Detect / nearby. The account stack itself stays removed.
//
// The fix pins the panel with position:fixed to the true viewport edges
// (bottom: 0, no padding, no radius crop) and hides the controls in place.
//
// Run: node test-pwa-layer-panel.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const css = read('css/styles.css');
const html = read('index.html');
const mapApp = read('js/map-app.js');

function ruleOf(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing CSS rule for ' + selector);
    return m[1];
}

/* 1. The panel is anchored, not sized. */
const panel = ruleOf(css, '.transp-panel');
assert(/top:\s*0/.test(panel) && /bottom:\s*0/.test(panel),
    'the layers window must be anchored to BOTH edges of the map frame');
assert(/height:\s*auto/.test(panel) && /max-height:\s*none/.test(panel),
    'no hardcoded 560px length any more — the frame decides the height');
assert(!/height:\s*560px/.test(panel), 'the old 560px cap must be gone');
assert(/padding:\s*22px 16px 0/.test(panel),
    'the bottom padding (the dark blue strip under the last row) must be removed');

/* 2. The PWA override pins the window to the true bottom — no safe-area gap. */
const pwa = ruleOf(html.replace(/\n\s*/g, ' '), 'body.is-pwa .transp-panel');
assert(/position:\s*fixed\s*!important/.test(pwa),
    'the PWA panel is fixed to the viewport so a 560px map-frame cannot crop it');
assert(/bottom:\s*0\s*!important/.test(pwa),
    'in the installed app the panel reaches the true bottom, not a safe-area gap');
assert(!/bottom:\s*env\(safe-area-inset-bottom/.test(pwa),
    'the leftover safe-area inset under the window is the padding the user still saw');
assert(/height:\s*auto\s*!important/.test(pwa) && /max-height:\s*none\s*!important/.test(pwa),
    'the PWA rule keeps the anchor-driven height instead of a computed one');
assert(/padding-bottom:\s*0\s*!important/.test(pwa),
    'and it carries no bottom padding either');
assert(!/100% - var\(--pwa-bottom-controls-clearance/.test(pwa),
    'the panel must no longer be shortened by the bottom-controls clearance');

/* 3. Fullscreen still owns its own geometry. */
const full = ruleOf(css, '.map-frame.is-fullscreen .transp-panel');
assert(/bottom:\s*0/.test(full), 'browser fullscreen still pins the window to the bottom');

/* 4. The floating PWA stack stays put (hidden in place) while the window is open. */
assert(/function markTranspPanelOpen\(on\)/.test(mapApp),
    'one helper owns the open state so every path stays in sync');
assert(/classList\.toggle\('transp-panel-open', transpPanelOpen\)/.test(mapApp),
    'the open state is published on <body>');
const openClose = /if \(!panel\.contains\(e\.target\) && !tab\.contains\(e\.target\)\)\s*\{\s*markTranspPanelOpen\(false\);/.test(mapApp);
assert(openClose, 'the click-outside close must go through the same helper');
const flatHtml = html.replace(/\n\s*/g, ' ');
const hideRule = (flatHtml.match(/body\.is-pwa\.transp-panel-open #pwa-br-stack,[^{]*\{([^}]*)\}/) || [])[1] || '';
assert(/body\.is-pwa\.transp-panel-open #pwa-br-stack,\s*body\.is-pwa\.transp-panel-open \.pwa-live-location-control\s*\{/.test(flatHtml),
    'the separate live-location button must be included in the in-place hide rule');
assert(/visibility:\s*hidden/.test(hideRule),
    'with the panel open the account stack and location button are hidden, not moved');
assert(/pointer-events:\s*none/.test(hideRule),
    'hidden controls must not intercept taps on the open layer panel');
assert(!/left:\s*max\(10px/.test(hideRule) && !/right:\s*auto/.test(hideRule),
    'no right-side control may teleport left over compass / Detect / nearby');

/* 5. Installed PWAs must actually receive it. */
const cacheName = (read('sw.js').match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 101, 'the SW cache must be bumped (got v' + cacheName + ')');
['css/styles.css', 'js/map-app.js'].forEach(function (file) {
    const tag = (html.match(new RegExp('(?:src|href)="(' + file + '\\?v=[^"]+)"')) || [])[1];
    assert(tag, file + ' must be cache-busted on the page');
    assert(read('sw.js').includes("'" + tag + "'"), file + ' must be pre-cached under that exact URL');
});

console.log('✓ the layers window is anchored top→bottom (no 560px cap, no bottom padding)');
console.log('✓ the PWA panel is flush to the screen bottom and hides right-side controls in place');
console.log('✓ the fullscreen geometry and the service-worker rollout are intact');
console.log('OK — the layers window reaches the bottom of the screen in the installed PWA.');
