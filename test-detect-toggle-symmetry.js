// Behavioural test: turning the detection switch OFF must hand back everything
// turning it ON borrowed — and must leave alone whatever the user had already
// enabled themselves.
//
// Why this matters
// ----------------
// toggleDetection(true) switches on, on the user's behalf: the heritage layer
// (via heritageChk.click()), its radius circles, a minimum canvas opacity, and
// live location. The OFF branch used to revert none of it, so a single use of
// the detection switch permanently changed the user's map — that asymmetry is
// what kept the click regression alive after the switch was turned back off.
//
// Rather than grep the source, this test EXTRACTS the real window.toggleDetection
// body out of js/map-app.js and runs it in a vm against a small DOM/geolocation
// harness, so it exercises the actual control flow.
//
// Run: node test-detect-toggle-symmetry.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
    if (!cond) {
        console.error('✗ ' + name + (extra ? '\n    ' + extra : ''));
        process.exitCode = 1;
        return;
    }
    passed++;
    console.log('✓ ' + name);
}

// ── Extract the real toggleDetection source ──────────────────────────────────
function extractFn(marker) {
    const start = SRC.indexOf(marker);
    if (start < 0) throw new Error('could not find ' + marker + ' in js/map-app.js');
    let depth = 0, i = SRC.indexOf('{', start);
    for (let j = i; j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}') {
            depth--;
            if (depth === 0) return SRC.slice(start, j + 2); // include the trailing ;
        }
    }
    throw new Error('unbalanced braces for ' + marker);
}
const toggleSrc = extractFn('window.toggleDetection = function (on) {');

// ── Minimal DOM ──────────────────────────────────────────────────────────────
function makeEl(id, props) {
    const el = Object.assign({
        id,
        checked: false,
        value: null,
        textContent: '',
        style: { display: '' },
        _classes: new Set(),
        classList: {
            add(c) { el._classes.add(c); },
            remove(c) { el._classes.delete(c); },
            toggle(c, on) { on ? el._classes.add(c) : el._classes.delete(c); },
            contains(c) { return el._classes.has(c); }
        }
    }, props || {});
    return el;
}

function buildHarness(opts) {
    opts = opts || {};
    const els = {
        detectWrap: makeEl('detectWrap'),
        detectSwitch: makeEl('detectSwitch'),
        siteAlert: makeEl('siteAlert'),
        patrimoniuOpacitySlider: makeEl('patrimoniuOpacitySlider', { value: String(opts.slider ?? 35) }),
        patrimoniuPct: makeEl('patrimoniuPct', { textContent: (opts.slider ?? 35) + '%' }),
        patrimoniuToggle: makeEl('patrimoniuToggle', { checked: !!opts.heritageOn })
    };
    els.siteAlert._classes.add('visible');

    const log = [];
    const state = {
        circlesVisible: !!opts.heritageOn,
        flatOpacity: opts.flatOpacity ?? 0.35,
        liveOn: !!opts.liveOn,
        liveStarts: 0,
        liveStops: 0,
        heritageCalls: []
    };

    // Faithful stand-in for the real togglePatrimoniuLayer (js/map-app.js):
    // it owns _circlesVisible, the canvas display and the 0%→25% slider nudge.
    function togglePatrimoniuLayer(on) {
        state.heritageCalls.push(on);
        ctx._circlesVisible = on;
        if (on) {
            const sl = els.patrimoniuOpacitySlider;
            if (sl && parseInt(sl.value, 10) === 0) {
                sl.value = '25';
                ctx.FLAT_OPACITY = 0.25;
                els.patrimoniuPct.textContent = '25%';
            }
            ctx._displayCanvas.style.display = '';
        } else {
            ctx._displayCanvas.style.display = 'none';
        }
    }

    const els_by_onchange = els.patrimoniuToggle;
    els_by_onchange.click = function () {
        // Mirrors a real checkbox click: flip, then fire the inline onchange.
        els_by_onchange.checked = !els_by_onchange.checked;
        togglePatrimoniuLayer(els_by_onchange.checked);
    };

    const ctx = {
        console: { log: (...a) => log.push(a.join(' ')), warn: () => {} },
        alert: () => { log.push('ALERT'); },
        Date,
        Math,
        parseInt,
        String,

        document: {
            getElementById: (id) => els[id] || null,
            querySelector: (sel) =>
                sel.includes('togglePatrimoniuLayer') ? els_by_onchange : null
        },

        navigator: {
            geolocation: opts.noGeo ? undefined : {
                watchPosition: () => 42,
                clearWatch: () => { state.clearedWatch = true; }
            },
            serviceWorker: { controller: null }
        },

        localStorage: (() => {
            const m = new Map();
            return {
                getItem: (k) => (m.has(k) ? m.get(k) : null),
                setItem: (k, v) => m.set(k, String(v)),
                removeItem: (k) => m.delete(k),
                _map: m
            };
        })(),

        // Free variables the extracted function closes over in map-app.js
        _det: { active: false, watchId: null, wasInside: false, alertUp: false, restore: null },
        _detLat: 46.77,
        _detLng: 23.59,
        _detCheck: () => {},
        _detOnPosition: () => {},
        _circlesVisible: !!opts.heritageOn,
        FLAT_OPACITY: opts.flatOpacity ?? 0.35,
        _displayCanvas: { style: { display: opts.heritageOn ? '' : 'none' } },
        _scheduleRedraw: () => { state.redrawn = true; },
        loadSiteCircles: () => { state.loaded = true; },
        publishDetectorPresence: (la, ln, vis) => { state.lastPresence = vis; }
    };

    ctx.window = ctx;
    ctx.window.togglePatrimoniuLayer = togglePatrimoniuLayer;
    ctx.window._isLiveLocationActive = () => state.liveOn;
    ctx.window._startLiveLocation = () => { state.liveOn = true; state.liveStarts++; };
    ctx.window._stopLiveLocation = () => { state.liveOn = false; state.liveStops++; };

    vm.createContext(ctx);
    vm.runInContext(toggleSrc, ctx);

    return { ctx, els, state, log, checkbox: els_by_onchange };
}

// ── Scenario A: user had NOTHING on → detection must fully clean up ──────────
{
    const h = buildHarness({ heritageOn: false, liveOn: false, slider: 0, flatOpacity: 0 });

    h.ctx.window.toggleDetection(true);
    check('A1. ON enables the heritage layer the user did not have on',
        h.checkbox.checked === true && h.ctx._circlesVisible === true);
    check('A2. ON auto-starts live location', h.state.liveOn === true && h.state.liveStarts === 1);
    check('A3. ON persists the switch state',
        h.ctx.localStorage.getItem('detection_enabled') === 'true' &&
        !!h.ctx.localStorage.getItem('detection_enabled_at'));

    const stampAfterOn = h.ctx.localStorage.getItem('detection_enabled_at');

    h.ctx.window.toggleDetection(false);
    check('A4. OFF turns the heritage layer back off',
        h.checkbox.checked === false && h.ctx._circlesVisible === false,
        'checkbox=' + h.checkbox.checked + ' circles=' + h.ctx._circlesVisible);
    check('A5. OFF hides the radius canvas again',
        h.ctx._displayCanvas.style.display === 'none');
    check('A6. OFF restores the original slider value (the 0→25 nudge is undone)',
        h.els.patrimoniuOpacitySlider.value === '0' && h.els.patrimoniuPct.textContent === '0%',
        'slider=' + h.els.patrimoniuOpacitySlider.value);
    check('A7. OFF restores the original canvas opacity', h.ctx.FLAT_OPACITY === 0);
    check('A8. OFF stops the live location it auto-started',
        h.state.liveOn === false && h.state.liveStops === 1);
    check('A9. OFF clears the persisted state', 
        h.ctx.localStorage.getItem('detection_enabled') === 'false' &&
        h.ctx.localStorage.getItem('detection_enabled_at') === null);
    check('A10. OFF hides the site alert', !h.els.siteAlert.classList.contains('visible'));
    check('A11. OFF marks the detectorist invisible to others', h.state.lastPresence === false);
    void stampAfterOn;
}

// ── Scenario B: user had heritage + live location on → detection must NOT
//    take them away when it is switched off ───────────────────────────────────
{
    const h = buildHarness({ heritageOn: true, liveOn: true, slider: 60, flatOpacity: 0.6 });

    h.ctx.window.toggleDetection(true);
    check('B1. ON leaves the already-enabled heritage layer alone (no extra click)',
        h.checkbox.checked === true && h.state.heritageCalls.length === 0);
    check('B2. ON does not restart an already-running live location', h.state.liveStarts === 0);

    h.ctx.window.toggleDetection(false);
    check('B3. OFF keeps the heritage layer the USER enabled',
        h.checkbox.checked === true && h.ctx._circlesVisible === true,
        'checkbox=' + h.checkbox.checked);
    check('B4. OFF keeps the user\'s live location running',
        h.state.liveOn === true && h.state.liveStops === 0);
    check('B5. OFF does not touch the user\'s opacity settings',
        h.els.patrimoniuOpacitySlider.value === '60' && h.ctx.FLAT_OPACITY === 0.6);
}

// ── Scenario C: re-entrant ON must not corrupt the snapshot ──────────────────
// _detRestorePersistedState(), the PWA mirror switch and focus/visibility
// handlers can all call toggleDetection(true) again while it is already on. A
// second snapshot taken at that point would record detection's OWN state as if
// the user had chosen it, and OFF would then never clean up.
{
    const h = buildHarness({ heritageOn: false, liveOn: false, slider: 0, flatOpacity: 0 });

    h.ctx.window.toggleDetection(true);
    h.ctx.window.toggleDetection(true);   // resume / mirror switch / focus event
    h.ctx.window.toggleDetection(true);

    h.ctx.window.toggleDetection(false);
    check('C1. repeated ON calls still clean up fully on OFF',
        h.checkbox.checked === false && h.ctx._circlesVisible === false && h.state.liveOn === false,
        'checkbox=' + h.checkbox.checked + ' circles=' + h.ctx._circlesVisible + ' live=' + h.state.liveOn);
}

// ── Scenario D: ON → OFF → ON → OFF is stable (no state leaks between runs) ──
{
    const h = buildHarness({ heritageOn: false, liveOn: false, slider: 0, flatOpacity: 0 });
    h.ctx.window.toggleDetection(true);
    h.ctx.window.toggleDetection(false);
    h.ctx.window.toggleDetection(true);
    check('D1. second ON re-enables the heritage layer', h.checkbox.checked === true);
    h.ctx.window.toggleDetection(false);
    check('D2. second OFF cleans up just as completely',
        h.checkbox.checked === false && h.ctx._circlesVisible === false && h.state.liveOn === false);
}

// ── Scenario E: an OFF that was never preceded by ON must be harmless ────────
// _detEnforceExpiry() and the cold-start path can call toggleDetection(false)
// on a fresh page where the user has their own layers on.
{
    const h = buildHarness({ heritageOn: true, liveOn: true, slider: 45, flatOpacity: 0.45 });
    h.ctx.window.toggleDetection(false);
    check('E1. a bare OFF does not strip layers detection never touched',
        h.checkbox.checked === true && h.ctx._circlesVisible === true &&
        h.state.liveOn === true && h.els.patrimoniuOpacitySlider.value === '45');
}

// ── Scenario F: geolocation unsupported → ON rolls itself back cleanly ───────
{
    const h = buildHarness({ noGeo: true, heritageOn: false, liveOn: false });
    h.ctx.window.toggleDetection(true);
    check('F1. ON aborts when geolocation is unavailable',
        h.ctx._det.active === false && h.els.detectSwitch.checked === false);
    check('F2. the aborted ON did not enable the heritage layer',
        h.checkbox.checked === false && h.state.heritageCalls.length === 0);
}

console.log('\n' + passed + ' checks passed.');
if (process.exitCode) console.error('SOME CHECKS FAILED');
