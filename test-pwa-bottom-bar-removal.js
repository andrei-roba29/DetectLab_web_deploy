// Functional test (jsdom) — the PWA bottom bar must be GONE from the document,
// not merely hidden, and the website must keep its markup.
//
// test-pwa-no-bottom-bar.js asserts the shipped source; this one runs the real
// inline standalone script from index.html inside a DOM and checks the outcome:
//
//   • ?pwa=1 / standalone  → #pwa-br-stack (geolocation 🎯 + the "AN" account
//     button + Log In pill + account dropdown) is removed from the document,
//     and the 500 ms account sync cannot put it back;
//   • plain website        → nothing is removed (the bar was already
//     display:none there, and the 🎯 button still belongs to the left stack);
//   • the left icon stack, the compass column and the map container are never
//     touched by the removal.
//
// Run: node test-pwa-bottom-bar-removal.js      (npm i --no-save jsdom)

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let JSDOM;
try {
    JSDOM = require('jsdom').JSDOM;
} catch (e) {
    // node_modules/ is gitignored, so a fresh checkout has no DOM. Skip rather
    // than report a false failure — the static contract is covered by
    // test-pwa-no-bottom-bar.js either way.
    console.log('SKIP — jsdom is not installed.');
    console.log('       npm i --no-save jsdom   then re-run to exercise the removal.');
    process.exit(0);
}

const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/* The real standalone script, verbatim: the block that adds .is-pwa and takes
   the bottom bar out of the document. Running anything less would test a copy
   of the fix instead of the fix. */
const SCRIPT = (INDEX.match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, ''))
    .filter(b => b.indexOf('pwaBottomBar') !== -1)[0];
assert(SCRIPT, 'index.html must contain the inline standalone script that removes the bar');

/* The shipped bar markup plus the controls that must survive next to it. */
const BAR = (INDEX.match(/<div id="pwa-br-stack"[\s\S]*?\n    <\/div>/) || [])[0];
assert(BAR, 'the #pwa-br-stack markup must still ship (the website scripts look its ids up)');
['pwaUserItem', 'pwaUserTrigger', 'pwaAvatar', 'pwaUserDropdown', 'pwaLoginTrigger'].forEach(function (id) {
    assert(BAR.indexOf('id="' + id + '"') !== -1, 'the bar markup must contain #' + id);
});

const SHELL = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
  <section id="map-section"><div class="container">
    <div class="map-frame"><div class="map-wrapper">
      <div id="detectlab-map">
        <div class="leaflet-top leaflet-left">
          <div class="leaflet-control leaflet-bar"><button id="btnLiveLocation" class="btn-live-location"></button></div>
          <button id="btnMeasure"></button>
          <button id="btnCoord"></button>
          <button id="btnTrack"></button>
          <button id="savedLocationsBtn"></button>
          <button id="pwaNearbyBtn"></button>
        </div>
        <div class="leaflet-bottom leaflet-left">
          <div class="leaflet-control detectlab-compass"><div class="detectlab-compass-col" id="compassCol">
            <button class="detectlab-compass-btn"></button>
            <button class="detectlab-compass-lock"></button>
            <button id="pwaDetectBtn"></button>
          </div></div>
        </div>
      </div>
    </div></div>
  </div></section>
  ${BAR}
</body></html>`;

const LEFT_STACK = ['btnMeasure', 'btnCoord', 'btnTrack', 'savedLocationsBtn', 'pwaNearbyBtn'];
const BAR_IDS = ['pwa-br-stack', 'pwaUserItem', 'pwaUserTrigger', 'pwaAvatar',
    'pwaUserDropdown', 'pwaLoginTrigger', 'pwaLangRow', 'pwaStorageItem'];

function boot(search, opts) {
    opts = opts || {};
    const dom = new JSDOM(SHELL, {
        url: 'https://detectlab.ro/' + (search || ''),
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const win = dom.window;

    // jsdom has no matchMedia; the installed app reports standalone.
    win.matchMedia = function (q) {
        return {
            matches: !!(opts.standalone && /display-mode:\s*standalone/.test(q)),
            media: q, addListener: function () {}, removeListener: function () {},
            addEventListener: function () {}, removeEventListener: function () {}
        };
    };
    if (opts.standalone) win.navigator.standalone = true;
    if (opts.iosAuthUser) win._authUser = function () { return { email: 'andrei.n@example.com' }; };

    const errors = [];
    win.addEventListener('error', function (e) { errors.push(String(e.error || e.message)); });
    win.__errors = errors;

    win.eval(SCRIPT);
    return win;
}

const settle = ms => new Promise(r => setTimeout(r, ms));
const $ = (win, id) => win.document.getElementById(id);

(async function run() {
    /* ── 1. Installed app (?pwa=1): the bar leaves the document ─────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        assert.ok(win.document.body.classList.contains('is-pwa'),
            '?pwa=1 must switch the standalone layout on');
        BAR_IDS.forEach(function (id) {
            assert.strictEqual($(win, id), null,
                '#' + id + ' must be removed from the DOM in the installed app');
        });
        assert.strictEqual(win.document.querySelectorAll('#pwa-br-stack *').length, 0,
            'no descendant of the bottom bar may survive');
        assert.deepStrictEqual(win.__errors, [], 'the removal must not throw');
        console.log('✓ ?pwa=1: the whole bottom bar (account "AN" button, Log In pill, '
            + 'dropdown, avatar) is removed from the document');
    }

    /* ── 2. display-mode: standalone behaves the same ───────────────────── */
    {
        const win = boot('', { standalone: true });
        await settle(60);
        assert.strictEqual($(win, 'pwa-br-stack'), null,
            'standalone display-mode must remove the bar too');
        assert.ok(win.document.documentElement.classList.contains('is-pwa'),
            '<html> carries .is-pwa so js/map-app.js sees the mode before <body> does');
        console.log('✓ display-mode: standalone removes the bar as well');
    }

    /* ── 3. The geolocation button goes with it ─────────────────────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        assert.strictEqual($(win, 'btnLiveLocation'), null,
            'the 🎯 geolocation button must not remain anywhere in the installed app');
        assert.strictEqual(win.document.querySelector('.btn-live-location'), null,
            'nor may its styled wrapper survive');
        console.log('✓ the geolocation button is gone from the installed app');
    }

    /* ── 4. The 500 ms account sync cannot bring the bar back ───────────── */
    {
        // updatePwaUserStack() writes `userTrigger.style.display = 'flex'` on a
        // timer — that inline style is exactly why hiding alone was not enough.
        const win = boot('?pwa=1', { iosAuthUser: true });
        await settle(700);            // past the 200 ms + 500 ms passes
        assert.strictEqual($(win, 'pwaUserTrigger'), null,
            'the account sync must not resurrect the removed trigger');
        assert.strictEqual($(win, 'pwa-br-stack'), null,
            'the container must still be gone after the sync passes ran');
        assert.deepStrictEqual(win.__errors, [],
            'the account sync must be null-safe with the bar removed');
        // The initials logic itself still works when the node exists (website).
        console.log('✓ the account sync (updatePwaUserStack) runs harmlessly with the bar removed');
    }

    /* ── 5. Everything that must stay, stays ────────────────────────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        LEFT_STACK.forEach(function (id) {
            assert.ok($(win, id), 'the left icon stack must keep #' + id);
        });
        ['compassCol', 'pwaDetectBtn', 'detectlab-map', 'map-section'].forEach(function (id) {
            assert.ok($(win, id), '#' + id + ' must not be touched by the removal');
        });
        assert.ok(win.document.querySelector('.leaflet-top.leaflet-left'),
            'the left Leaflet column must survive');
        assert.ok(win.document.querySelector('.leaflet-bottom.leaflet-left'),
            'the compass / Detect column must survive');
        console.log('✓ left icon stack, compass column, Detect toggle and the map are untouched');
    }

    /* ── 6. The website keeps its markup ────────────────────────────────── */
    {
        const win = boot('');
        await settle(60);
        assert.ok(!win.document.body.classList.contains('is-pwa'),
            'a plain browser tab is not the installed app');
        assert.ok($(win, 'pwa-br-stack'), 'the website keeps the (hidden) bar markup');
        assert.ok($(win, 'pwaUserTrigger') && $(win, 'pwaUserDropdown'),
            'the website keeps the account trigger + dropdown nodes for the badge scripts');
        assert.ok($(win, 'btnLiveLocation'),
            'the website keeps the 🎯 button in the LEFT icon stack');
        assert.ok($(win, 'btnLiveLocation').closest('.leaflet-top.leaflet-left'),
            'and it stays in the left column, not at the bottom');
        console.log('✓ the website is unchanged: markup kept, 🎯 still in the left stack');
    }

    /* ── 7. The dropdown toggle is callable with the bar removed ────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        assert.strictEqual(typeof win.togglePwaUserDropdown, 'function',
            'the toggle stays defined (other code paths call it)');
        win.togglePwaUserDropdown();          // must not throw on a removed node
        win.togglePwaLangSubmenu();
        assert.deepStrictEqual(win.__errors, [], 'no exception with the bar removed');
        console.log('✓ togglePwaUserDropdown / togglePwaLangSubmenu are safe with no bar');
    }

    console.log('\nOK — in the installed app the bottom bar is removed from the DOM; '
        + 'the website and the left controls are untouched.');
    process.exit(0);
})().catch(function (e) {
    console.error('\n✗ ' + (e && e.message ? e.message : e));
    process.exit(1);
});
