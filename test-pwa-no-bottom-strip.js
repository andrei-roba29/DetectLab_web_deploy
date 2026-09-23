// Regression test — the installed PWA must not show a dark strip below the map.
//
// What was broken
// ---------------
// In the installed app (iPhone, and Android with the same symptom) an empty,
// dark navy band was visible at the very bottom of the screen: the map tiles
// stopped above it and nothing was painted inside it. #map-section got its
// height from the vh → --vh → svh → dvh ladder; iOS standalone settles those
// numbers one frame late (and on some versions the dynamic viewport excludes
// the home-indicator band), so the section could stay shorter than the real
// screen while Leaflet kept the stale size — the page background (#060E1E)
// then showed through as the "bottom padding / bottom bar".
//
// The fix stretches #map-section between the viewport edges (position:fixed +
// top:0 + bottom:0, height:auto) — exact on every engine, no fallback ladder —
// and re-measures Leaflet the frame the container reaches its true size
// (delayed passes + ResizeObserver + load/pageshow). The separate live-location
// button and compass column keep their safe-area offsets.
//
// Run: node test-pwa-no-bottom-strip.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html').replace(/\n\s*/g, ' ');
const sw = read('sw.js');

function ruleOf(source, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(source);
    assert(m, 'missing CSS rule for ' + selector);
    return m[1];
}

/* 1. The map section is stretched, not sized. */
const section = ruleOf(html, 'body.is-pwa #map-section');
assert(/position:\s*fixed/.test(section),
    'the PWA map section must stay fixed so it escapes the page flow');
assert(/top:\s*0/.test(section) && /bottom:\s*0/.test(section),
    'the section must be anchored to BOTH viewport edges (stretch, not compute)');
assert(/height:\s*auto\s*!important/.test(section),
    'a computed height is what left the strip — the stretched box must win');
assert(!/height:\s*100dvh/.test(section) && !/height:\s*100svh/.test(section)
    && !/height:\s*calc\(var\(--vh/.test(section),
    'the vh/svh/dvh ladder is the bug: iOS settles it one frame late');
assert(!/bottom:\s*env\(safe-area-inset-bottom/.test(section),
    'the section must reach the true bottom, not stop above an inset');

/* 2. Leaflet is re-measured when the container reaches its real height. */
assert(/setTimeout\(updatePwaMapLayout, 800\)/.test(html)
    && /setTimeout\(updatePwaMapLayout, 1600\)/.test(html),
    'delayed passes must cover the iOS settle window after first paint');
assert(/new window\.ResizeObserver/.test(html),
    'a ResizeObserver must catch the frame the container grows');
assert(/getElementById\('map-section'\)/.test(html)
    && /querySelector\('#map-section \.map-frame'\)/.test(html)
    && /getElementById\('detectlab-map'\)/.test(html),
    'the observer must watch the section, the frame and the map itself');
assert(/addEventListener\('load', updatePwaMapLayout\)/.test(html)
    && /addEventListener\('pageshow', updatePwaMapLayout\)/.test(html),
    'load and pageshow (back/forward cache) must re-sync the layout too');

/* 3. The live-location button and the other bottom controls keep their
   published offsets. The account menu remains removed; the GPS button now
   uses its own fixed wrapper at the same right-bottom position. */
const liveControl = ruleOf(html, 'html.is-pwa .pwa-live-location-control');
assert(/position:\s*fixed\s*!important/.test(liveControl),
    'the PWA live-location button must stay independently fixed');
assert(/right:\s*max\(10px, env\(safe-area-inset-right, 0px\)\)\s*!important/.test(liveControl),
    'the bottom-right control must keep its right-side safe-area offset');
assert(/bottom:\s*calc\(env\(safe-area-inset-bottom, 0px\) \+ 28px\)\s*!important/.test(liveControl),
    'the live-location button must keep its bottom offset');
const pwaVars = (html.match(/(?:^|\})\s*body\.is-pwa\s*\{[^}]*\}/) || [])[0] || '';
assert(/--pwa-bottom-controls-clearance:\s*44px/.test(pwaVars),
    'the published bottom clearance must stay untouched for the overlays');
const leafletBottom = (html.match(/body\.is-pwa \.leaflet-bottom\s*\{[^}]*\}/) || [])[0] || '';
assert(/bottom:\s*env\(safe-area-inset-bottom, 0px\) !important/.test(leafletBottom),
    'the compass column keeps anchoring to the (now real) map bottom');

/* 4. Installed PWAs must actually receive the fix. */
const cacheName = (sw.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1];
assert(Number(cacheName) >= 109, 'the SW cache must be bumped to v109+ (got v' + cacheName + ')');

console.log('✓ the PWA map section stretches between the viewport edges (no computed height)');
console.log('✓ Leaflet re-measures on load / pageshow / settle passes / ResizeObserver');
console.log('✓ every floating control keeps its exact offset — nothing moved');
console.log('OK — no dark strip can remain below the map in the installed PWA.');
