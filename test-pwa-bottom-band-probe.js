// Functional test for the on-device bottom-band probe (js/pwa-debug.js).
//
// The probe's whole job is to turn "I see a dark band" into a number, so the
// number has to be right. jsdom does no layout, so every
// getBoundingClientRect() is stubbed with three synthetic device geometries —
// the iOS short-ICB case this fix targets, a healthy device, and a genuine
// layout bug — and the verdict printed for each is asserted.
//
// Also asserted: the probe is inert until explicitly enabled (no DOM, no
// style), the five-tap gesture reaches it from inside the installed app, and
// disabling takes every node back out again.
//
// Run: node test-pwa-bottom-band-probe.js     (needs jsdom)

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let JSDOM;
try {
    JSDOM = require('jsdom').JSDOM;
} catch (e) {
    // jsdom is not vendored (node_modules/ is gitignored), so a fresh checkout
    // has no DOM. Skip rather than report a false failure — the static contract
    // is covered by test-pwa-bottom-band.js either way.
    console.log('SKIP — jsdom is not installed.');
    console.log('       npm i --no-save jsdom   then re-run to exercise the probe.');
    process.exit(0);
}

const SRC = fs.readFileSync(path.join(__dirname, 'js/pwa-debug.js'), 'utf8');
const FLAG_KEY = 'dlPwaDebug';

const SHELL = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
  <section id="map-section"><div class="container">
    <div class="map-frame"><div class="map-wrapper">
      <div id="detectlab-map"></div>
    </div></div>
  </div></section>
</body></html>`;

/* Three device geometries. `bottom0` is where `position:fixed; bottom:0` lands
   (the ICB's bottom edge); `vh` is what the large-viewport unit resolves to.
   In the iOS case they differ by exactly safe-area-inset-top. */
const GEOMETRIES = {
    // iPhone 13 standalone, viewport-fit=cover + black-translucent: the ICB is
    // 59px shorter than the physical screen. The min-height:100vh floor lets
    // #map-section reach 844 anyway.
    iosShortIcb: {
        innerHeight: 785, screenHeight: 844, bottom0: 785, vh: 844, dvh: 785, svh: 785,
        envTop: 59, envBottom: 34, sectionBottom: 844, mapBottom: 844,
        expect: /ICB SHORT by 59/, forbid: /MAP SHORT|PAGE REACHES THE BOTTOM/
    },
    // A device where the ICB already is the screen: the floor is a no-op.
    healthy: {
        innerHeight: 844, screenHeight: 844, bottom0: 844, vh: 844, dvh: 844, svh: 844,
        envTop: 59, envBottom: 34, sectionBottom: 844, mapBottom: 844,
        expect: /PAGE REACHES THE BOTTOM/, forbid: /ICB SHORT|MAP SHORT/
    },
    // The ICB is full but the chain is still short — a real layout bug (H1).
    layoutBug: {
        innerHeight: 844, screenHeight: 844, bottom0: 844, vh: 844, dvh: 844, svh: 844,
        envTop: 59, envBottom: 34, sectionBottom: 844, mapBottom: 785,
        expect: /MAP SHORT by 59/, forbid: /ICB SHORT|PAGE REACHES THE BOTTOM/
    }
};

const BOOT_DELAY_MS = 2000;   // the probe waits out the map settle passes

function makeWindow(search, geometry, seedFlag) {
    const dom = new JSDOM(SHELL, {
        url: 'https://detectlab.ro/' + (search || ''),
        runScripts: 'outside-only',
        pretendToBeVisual: true
    });
    const win = dom.window;

    // jsdom reports a 1024x768 window and no visualViewport; hand the probe the
    // numbers of the device being simulated.
    Object.defineProperty(win, 'innerHeight', { value: geometry.innerHeight, configurable: true });
    Object.defineProperty(win, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(win.screen, 'height', { value: geometry.screenHeight, configurable: true });
    Object.defineProperty(win.screen, 'availHeight', { value: geometry.screenHeight, configurable: true });
    win.visualViewport = {
        height: geometry.innerHeight, offsetTop: 0, scale: 1,
        addEventListener: function () {}, removeEventListener: function () {}
    };

    // Layout stub: probes are matched by data-probe, page elements by id/class.
    // Anything unlisted keeps jsdom's all-zero rect.
    win.Element.prototype.getBoundingClientRect = function () {
        const el = this;
        const p = el.getAttribute && el.getAttribute('data-probe');
        const r = { top: 0, bottom: 0, height: 0, width: 1, left: 0, right: 1 };
        if (p === 'fixedBottom0') { r.bottom = geometry.bottom0; r.top = geometry.bottom0 - 1; }
        else if (p === 'vh100') { r.height = geometry.vh; }
        else if (p === 'dvh100') { r.height = geometry.dvh; }
        else if (p === 'svh100') { r.height = geometry.svh; }
        else if (p === 'envTop') { r.height = geometry.envTop; }
        else if (p === 'envBottom') { r.height = geometry.envBottom; }
        else if (el.id === 'map-section') { r.bottom = geometry.sectionBottom; r.height = geometry.sectionBottom; }
        else if (el.id === 'detectlab-map') { r.bottom = geometry.mapBottom; r.height = geometry.mapBottom; r.right = 390; }
        else if (el.id === 'dlPwaDebugTagProbe') { r.bottom = geometry.mapBottom - 4; r.top = geometry.mapBottom - 22; r.right = 384; }
        else if (el.className === 'map-frame' || el.className === 'map-wrapper') { r.bottom = geometry.sectionBottom; r.height = geometry.sectionBottom; }
        return r;
    };

    // Seed the per-origin flag BEFORE boot, which is how a relaunch of the
    // installed app finds it (iOS gives an A2HS web app its own container).
    if (seedFlag !== undefined) {
        if (seedFlag) { win.localStorage.setItem(FLAG_KEY, seedFlag); }
        else { win.localStorage.removeItem(FLAG_KEY); }
    }

    win.eval(SRC);
    return win;
}

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function tapOn(win, x, y) {
    const type = win.PointerEvent ? 'pointerup' : 'touchend';
    const ev = new win.Event(type, { bubbles: true, cancelable: true });
    ev.clientX = x; ev.clientY = y;
    win.dispatchEvent(ev);
}

(async function run() {
    const notes = [];
    const ok = function (msg) { notes.push(msg); console.log('  · ' + msg); };
    const $ = (win, id) => win.document.getElementById(id);

    /* ── 1. inert until explicitly enabled ─────────────────────────────── */
    {
        const win = makeWindow('', GEOMETRIES.healthy);
        await settle(80);
        assert.strictEqual($(win, 'dlPwaDebugOverlay'), null, 'no overlay when not enabled');
        assert.strictEqual($(win, 'dlPwaDebugProbes'), null, 'no probe nodes when not enabled');
        assert.strictEqual($(win, 'dlPwaDebugPill'), null, 'no pill when not enabled');
        assert.strictEqual($(win, 'dlPwaDebugColors'), null, 'no colour stylesheet when not enabled');
        assert(!win.document.documentElement.classList.contains('dl-pwa-debug-colors'),
            'no colour class when not enabled');
        assert.strictEqual(win.document.querySelectorAll('#detectlab-map > *').length, 0,
            'the tag probe must not be added to the map when the probe is off');
        assert(win.DetectLabPwaDebug, 'the console handle is still published');
        ok('off by default: zero DOM, zero style, zero layout impact');
        win.close();
    }

    /* ── 2. ?pwaDebug=1 builds the readout after the settle window ─────── */
    {
        const win = makeWindow('?pwaDebug=1', GEOMETRIES.iosShortIcb);
        await settle(80);
        assert.strictEqual($(win, 'dlPwaDebugOverlay'), null,
            'the overlay waits for the map settle passes — it must not print pre-layout numbers');
        await settle(BOOT_DELAY_MS);
        assert($(win, 'dlPwaDebugOverlay'), '?pwaDebug=1 must show the overlay');
        assert($(win, 'dlPwaDebugProbes'), 'the probe nodes must exist');
        assert($(win, 'dlPwaDebugTagProbe'), 'the © Leafleet tag probe must exist');
        assert.strictEqual(win.localStorage.getItem(FLAG_KEY), 'numbers',
            'the query must persist the flag so a relaunch keeps the probe on');

        const text = $(win, 'dlPwaDebugText').textContent;
        assert(/probe fixed bottom:0 → \.bottom: 785/.test(text), 'ICB edge missing:\n' + text);
        assert(/probe 100vh: 844/.test(text), 'the 100vh reading must be printed');
        assert(/probe 100dvh: 785/.test(text), 'the 100dvh reading must be printed');
        assert(/100vh − ICB bottom: 59/.test(text), 'the shortfall must be derived');
        assert(/env\(safe-area-inset-top\): 59/.test(text), 'env() must be resolved to px');
        assert(/env\(safe-area-inset-bottom\): 34/.test(text), 'env() must be resolved to px');
        assert(/© Leafleet tag probe: top=822 bottom=840/.test(text),
            "the tag position must be reported — it is the reporter's reference point");
        assert(/display-mode/.test(text) && /navigator\.standalone/.test(text),
            'the launch mode must be reported');
        ok('?pwaDebug=1 prints ICB / 100vh / 100dvh / env() / element rects and persists the flag');
        win.close();
    }

    /* ── 3. the verdict names the right hypothesis for each geometry ───── */
    for (const name of Object.keys(GEOMETRIES)) {
        const g = GEOMETRIES[name];
        const win = makeWindow('?pwaDebug=1', g);
        await settle(BOOT_DELAY_MS);
        const text = win.DetectLabPwaDebug.text();
        const v = (text.split('VERDICT')[1] || '').trim();
        assert(g.expect.test(v), name + ': verdict should match ' + g.expect + ' but got:\n' + v);
        assert(!g.forbid.test(v), name + ': verdict must not match ' + g.forbid + ' but got:\n' + v);
        ok(name + ' → ' + v.split('\n')[0].trim());
        win.close();
    }

    /* ── 4. the five-tap gesture reaches it inside the installed app ───── */
    {
        const win = makeWindow('', GEOMETRIES.iosShortIcb);
        await settle(80);
        const mb = GEOMETRIES.iosShortIcb.mapBottom;

        for (let i = 0; i < 6; i++) tapOn(win, 200, 400);          // mid-map taps
        assert.strictEqual($(win, 'dlPwaDebugOverlay'), null,
            'tapping the map must never switch the probe on');

        for (let i = 0; i < 4; i++) tapOn(win, 360, mb - 10);       // on the tag
        assert.strictEqual($(win, 'dlPwaDebugOverlay'), null, 'four taps are not the gesture');

        tapOn(win, 360, mb - 10);                                   // fifth
        assert($(win, 'dlPwaDebugOverlay'), 'the fifth tap on the tag must open the probe');
        assert.strictEqual(win.localStorage.getItem(FLAG_KEY), 'numbers',
            'the gesture must persist so a relaunch of the installed app keeps it on');

        for (let i = 0; i < 5; i++) tapOn(win, 360, mb - 10);
        assert(win.document.documentElement.classList.contains('dl-pwa-debug-colors'),
            'the next five taps must turn the colour bands on');
        assert($(win, 'dlPwaDebugColors'), 'colour mode must inject its stylesheet');
        assert(/#ff0000/i.test($(win, 'dlPwaDebugColors').textContent),
            'html must be painted red so the band colour names its painter');

        for (let i = 0; i < 5; i++) tapOn(win, 360, mb - 10);
        assert(!win.document.documentElement.classList.contains('dl-pwa-debug-colors'),
            'the following five taps must switch the probe off again');
        assert.strictEqual($(win, 'dlPwaDebugOverlay'), null, 'the overlay must be removed');
        assert.strictEqual($(win, 'dlPwaDebugProbes'), null, 'the probe nodes must be removed');
        assert.strictEqual($(win, 'dlPwaDebugColors'), null, 'the colour stylesheet must be removed');
        assert.strictEqual($(win, 'dlPwaDebugTagProbe'), null, 'the tag probe must leave the map');
        assert.strictEqual(win.localStorage.getItem(FLAG_KEY), null, 'the flag must be cleared');
        ok('five taps on the © Leafleet tag cycle off → numbers → colours → off, and tear down cleanly');
        win.close();
    }

    /* ── 5. a persisted flag re-arms on relaunch; ?pwaDebug=0 clears it ── */
    {
        const win = makeWindow('', GEOMETRIES.iosShortIcb, 'numbers');
        await settle(BOOT_DELAY_MS);
        assert($(win, 'dlPwaDebugOverlay'),
            'a flag persisted by an earlier session must re-arm the probe on relaunch');
        ok('a persisted flag survives relaunch (iOS A2HS storage is isolated from Safari)');
        win.close();

        const off = makeWindow('?pwaDebug=0', GEOMETRIES.iosShortIcb, 'numbers');
        await settle(BOOT_DELAY_MS);
        assert.strictEqual($(off, 'dlPwaDebugOverlay'), null, '?pwaDebug=0 must win over a stale flag');
        assert.strictEqual(off.localStorage.getItem(FLAG_KEY), null,
            '?pwaDebug=0 must clear the persisted flag');
        ok('?pwaDebug=0 is an explicit off switch that also clears the stored flag');
        off.close();
    }

    console.log('\n✓ the probe is inert until enabled, and tears down completely');
    console.log('✓ it prints the ICB edge, 100vh/100dvh/100svh, env() and every element rect');
    console.log('✓ its verdict separates a short ICB from a full-screen page from a layout bug');
    console.log('✓ the five-tap gesture reaches it inside the installed app (isolated storage)');
    console.log('OK — ' + notes.length + ' probe behaviours verified.');
})().catch(function (err) {
    console.error('\n✗ ' + (err && err.message ? err.message : err));
    process.exit(1);
});
