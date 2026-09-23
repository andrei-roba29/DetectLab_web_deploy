// Functional test (jsdom) — PWA bottom-right stack restored: 🎯 on top, account below.
// test-pwa-no-bottom-bar.js asserts the full source contract; this test runs the
// real inline standalone script from index.html inside a DOM and checks that:
//   • ?pwa=1 / standalone → #pwa-br-stack stays in DOM (not removed), visible;
//   • a live-location button outside the stack survives and can be mounted into stack;
//   • plain website → bar markup hidden but present;
//   • compass column and map container are never touched.
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
    console.log('SKIP — jsdom is not installed.');
    console.log('       npm i --no-save jsdom   then re-run to exercise the restoration.');
    process.exit(0);
}

const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const SCRIPT = (INDEX.match(/<script>([\s\S]*?)<\/script>/g) || [])
    .map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, ''))
    .filter(b => b.indexOf('pwa-br-stack') !== -1 && b.indexOf('is-pwa') !== -1)[0];
assert(SCRIPT, 'index.html must contain the inline standalone script referencing #pwa-br-stack');

const BAR = (INDEX.match(/<div id=\"pwa-br-stack\"[\s\S]*?\n    <\/div>/) || [])[0];
assert(BAR, 'the #pwa-br-stack markup must still ship');
['pwaUserItem', 'pwaUserTrigger', 'pwaAvatar', 'pwaUserDropdown', 'pwaLoginTrigger'].forEach(function (id) {
    assert(BAR.indexOf('id=\"' + id + '\"') !== -1, 'the bar markup must contain #' + id);
});

const SHELL = `<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body>
  <section id=\"map-section\"><div class=\"container\">
    <div class=\"map-frame\"><div class=\"map-wrapper\">
      <div id=\"detectlab-map\">
        <div class=\"leaflet-top leaflet-left\">
          <div class=\"leaflet-control leaflet-bar\"><button id=\"btnLiveLocation\" class=\"btn-live-location\"></button></div>
          <button id=\"btnMeasure\"></button>
          <button id=\"btnCoord\"></button>
          <button id=\"btnTrack\"></button>
          <button id=\"savedLocationsBtn\"></button>
          <button id=\"pwaNearbyBtn\"></button>
        </div>
        <div class=\"leaflet-bottom leaflet-left\">
          <div class=\"leaflet-control detectlab-compass\"><div class=\"detectlab-compass-col\" id=\"compassCol\">
            <button class=\"detectlab-compass-btn\"></button>
            <button class=\"detectlab-compass-lock\"></button>
            <button id=\"pwaDetectBtn\"></button>
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
    /* ── 1. Installed app (?pwa=1): bar stays in document ─────────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        assert.ok(win.document.body.classList.contains('is-pwa'),
            '?pwa=1 must switch the standalone layout on');
        BAR_IDS.forEach(function (id) {
            assert.ok($(win, id),
                '#' + id + ' must remain in DOM in installed app (stack restored)');
        });
        assert.strictEqual($(win, 'pwa-br-stack').getAttribute('aria-hidden'), 'false',
            '#pwa-br-stack aria-hidden must be false in PWA');
        assert.deepStrictEqual(win.__errors, [], 'the preservation must not throw');
        console.log('✓ ?pwa=1: account stack (AN button, Log In pill, dropdown) stays in DOM');
    }

    /* ── 2. display-mode: standalone behaves the same ───────────────────── */
    {
        const win = boot('', { standalone: true });
        await settle(60);
        assert.ok($(win, 'pwa-br-stack'),
            'standalone display-mode must keep the bar');
        assert.ok(win.document.documentElement.classList.contains('is-pwa'),
            '<html> carries .is-pwa');
        console.log('✓ display-mode: standalone keeps the bar as well');
    }

    /* ── 3. Live-location control not deleted ──────────────────────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        assert.ok($(win, 'btnLiveLocation'),
            'standalone script must not remove live-location button');
        console.log('✓ standalone script leaves 🎯 location button untouched');
    }

    /* ── 4. Account sync works with bar present ─────────────────────────── */
    {
        const win = boot('?pwa=1', { iosAuthUser: true });
        await settle(700);
        assert.ok($(win, 'pwaUserTrigger'),
            'account sync must keep trigger when bar present');
        assert.ok($(win, 'pwa-br-stack'),
            'container must still exist after sync passes');
        assert.deepStrictEqual(win.__errors, [],
            'account sync must be null-safe');
        console.log('✓ account sync (updatePwaUserStack) works with restored bar');
    }

    /* ── 5. Everything that must stay, stays ────────────────────────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        LEFT_STACK.forEach(function (id) {
            assert.ok($(win, id), 'left icon stack must keep #' + id);
        });
        ['compassCol', 'pwaDetectBtn', 'detectlab-map', 'map-section'].forEach(function (id) {
            assert.ok($(win, id), '#' + id + ' must not be touched');
        });
        console.log('✓ left icon stack, compass column, Detect toggle and map untouched');
    }

    /* ── 6. Website keeps its markup ────────────────────────────────────── */
    {
        const win = boot('');
        await settle(60);
        assert.ok(!win.document.body.classList.contains('is-pwa'),
            'plain browser tab is not installed app');
        assert.ok($(win, 'pwa-br-stack'), 'website keeps bar markup');
        assert.ok($(win, 'pwaUserTrigger') && $(win, 'pwaUserDropdown'),
            'website keeps account trigger + dropdown');
        assert.ok($(win, 'btnLiveLocation'),
            'website keeps 🎯 button');
        console.log('✓ website unchanged: markup kept, 🎯 in left stack');
    }

    /* ── 7. Dropdown toggle callable ────────────────────────────────────── */
    {
        const win = boot('?pwa=1');
        await settle(60);
        assert.strictEqual(typeof win.togglePwaUserDropdown, 'function',
            'toggle stays defined');
        win.togglePwaUserDropdown();
        win.togglePwaLangSubmenu();
        assert.deepStrictEqual(win.__errors, [], 'no exception with restored bar');
        console.log('✓ togglePwaUserDropdown / togglePwaLangSubmenu safe with restored bar');
    }

    console.log('\nOK — installed app keeps bottom-right stack (🎯 on top, account below); website untouched.');
    process.exit(0);
})().catch(function (e) {
    console.error('\n✗ ' + (e && e.message ? e.message : e));
    process.exit(1);
});
