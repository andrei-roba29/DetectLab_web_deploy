// Regression test — the layers window in the installed PWA must fill the screen.
//
// What was broken
// ---------------
// · .transp-panel carried a hardcoded `height: 560px; max-height: 560px`. On the
//   website that is exactly the height of the map frame, so nothing looked wrong
//   — but the installed PWA paints the map edge to edge (100dvh), and 560px on a
//   ~900px phone is "the window stops after the lower half of the screen".
//   The PWA override that did exist (`body.is-pwa .transp-panel`, in a <style>
//   block of index.html) recomputed 100% of the frame minus a bottom clearance,
//   which an installed app with an older cached index.html never picked up at all.
// · The panel also padded its own background below the last row (22px of dark
//   blue), which in the tall PWA layout is pure dead space.
// · Stretching the panel to the bottom puts the floating PWA stack (live location
//   + account) over the panel's bottom-right corner, where every row keeps its
//   switch — so the stack has to step aside while the window is open.
//
// The fix anchors the panel top→bottom of its container instead of giving it a
// length, so the geometry can no longer depend on a percentage resolving (or on
// which markup version the service worker served).
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

/* 2. The PWA override must not reintroduce a length or a clearance gap. */
const pwa = ruleOf(html.replace(/\n\s*/g, ' '), 'body.is-pwa .transp-panel');
assert(/bottom:\s*env\(safe-area-inset-bottom/.test(pwa),
    'in the installed app the panel stops at the safe-area inset, not 44px above the bottom');
assert(/height:\s*auto\s*!important/.test(pwa) && /max-height:\s*none\s*!important/.test(pwa),
    'the PWA rule keeps the anchor-driven height instead of a computed one');
assert(/padding-bottom:\s*0\s*!important/.test(pwa),
    'and it carries no bottom padding either');
assert(!/100% - var\(--pwa-bottom-controls-clearance/.test(pwa),
    'the panel must no longer be shortened by the bottom-controls clearance');

/* 3. Fullscreen still owns its own geometry. */
const full = ruleOf(css, '.map-frame.is-fullscreen .transp-panel');
assert(/bottom:\s*0/.test(full), 'browser fullscreen still pins the window to the bottom');

/* 4. The floating PWA stack steps aside while the window is open. */
assert(/function markTranspPanelOpen\(on\)/.test(mapApp),
    'one helper owns the open state so every path stays in sync');
assert(/classList\.toggle\('transp-panel-open', transpPanelOpen\)/.test(mapApp),
    'the open state is published on <body>');
const openClose = /if \(!panel\.contains\(e\.target\) && !tab\.contains\(e\.target\)\)\s*\{\s*markTranspPanelOpen\(false\);/.test(mapApp);
assert(openClose, 'the click-outside close must go through the same helper');
const stack = ruleOf(html.replace(/\n\s*/g, ' '), 'body.is-pwa.transp-panel-open #pwa-br-stack');
assert(/left:\s*max\(10px/.test(stack) && /right:\s*auto/.test(stack),
    'with the panel open the bottom-right stack moves to the left edge so it never covers a layer switch');

/* 5. Installed PWAs must actually receive it. */
const cacheName = (read('sw.js').match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 98, 'the SW cache must be bumped (got v' + cacheName + ')');
['css/styles.css', 'js/map-app.js'].forEach(function (file) {
    const tag = (html.match(new RegExp('(?:src|href)="(' + file + '\\?v=[^"]+)"')) || [])[1];
    assert(tag, file + ' must be cache-busted on the page');
    assert(read('sw.js').includes("'" + tag + "'"), file + ' must be pre-cached under that exact URL');
});

console.log('✓ the layers window is anchored top→bottom (no 560px cap, no bottom padding)');
console.log('✓ the PWA keeps only the safe-area inset and moves the floating stack aside');
console.log('✓ the fullscreen geometry and the service-worker rollout are intact');
console.log('OK — the layers window reaches the bottom of the screen in the installed PWA.');
