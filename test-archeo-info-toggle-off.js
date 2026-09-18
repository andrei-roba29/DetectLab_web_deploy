// Regression test — „Zone cu potențial arheologic” panel cleanup.
//
// What changed
// ------------
// 1. The explanatory bar under the colour legend („Se caută locații cu
//    potențial arheologic … Roșu = intravilanul UAT …”) moved OUT of the
//    layers panel and INTO the layer-info popup (the „i” button), under the
//    title + the „© DetectLab 2026 · date RAN CIMEC” attribution. The panel
//    keeps only the colour legend (bubbles + heatmap variants).
// 2. The layer no longer starts ON: #archeoPotToggle ships without the
//    `checked` attribute and the module's _resultsVisible defaults to false;
//    wireUI() syncs the true initial state from the toggle itself, so the
//    purple pin / radius mirror / Detect button only arm once the user
//    switches the layer on.
// 3. showLayerInfo(name, attribution, description) gained an optional third
//    parameter rendered in #layerInfoDescription (styled by
//    .layer-info-description in css/styles.css).
//
// Run: node test-archeo-info-toggle-off.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const html = read('index.html');
const css = read('css/styles.css');
const translations = read('js/translations.js');
const archeoCode = read('js/archeo-potential.js');

let failures = 0;
function check(name, cond, extra) {
    if (cond) { console.log('  ✔ ' + name); }
    else { failures++; console.error('  ✘ ' + name + (extra ? ' — ' + extra : '')); }
}

/* ── 1. Panel: hint bar gone, legend kept, toggle OFF by default ── */
console.log('\n[Panel markup]');
{
    check('the explanatory hint bar is removed from the panel',
        !/data-key="archeo_hint"/.test(html));
    check('the bubbles legend stays', /id="archeoPotLegendBubbles"/.test(html));
    check('the heatmap legend stays', /id="archeoPotLegendHeat"/.test(html));
    // The toggle input must ship without `checked` (OFF by default).
    const toggleTag = /<input[^>]*id="archeoPotToggle"[^>]*>/i.exec(html);
    check('the layer toggle exists', !!toggleTag);
    check('the layer toggle has NO checked attribute (OFF by default)',
        !!toggleTag && !/\schecked[\s=>]/i.test(toggleTag[0]));
    // The info button goes through the localized showArcheoPotInfo() helper
    // (with a plain showLayerInfo fallback if the module fails to load).
    check('the info button opens the localized info helper',
        /showArcheoPotInfo\(\)/.test(html) &&
        /showLayerInfo\('Archeological Potential Sites','© DetectLab 2026 · date RAN CIMEC'\)/.test(html));
}

/* ── 2. Info popup: description slot + extended showLayerInfo ── */
console.log('\n[Layer info popup]');
{
    check('the popup has a #layerInfoDescription slot under the attribution',
        /<p class="layer-info-attribution" id="layerInfoAttribution">[^]*?<p class="layer-info-description" id="layerInfoDescription"/.test(html));
    check('showLayerInfo accepts the optional description',
        /function showLayerInfo\(name, attribution, description\)/.test(html));
    check('showLayerInfo fills + hides the description box',
        /desc\.textContent = text/.test(html) &&
        /desc\.style\.display = text \? '' : 'none'/.test(html));
    const m = new RegExp('\\.layer-info-description\\s*\\{([^}]*)\\}').exec(css);
    check('.layer-info-description is styled', !!m);
    check('the description sits under a hairline divider',
        !!m && /border-top:/.test(m[1]) && /margin:\s*10px 0 0 0/.test(m[1]));
}

/* ── 3. Translations: the old archeo_hint key is fully retired ── */
console.log('\n[Translations]');
{
    // The key definition is retired; a pointer comment (“ex-archeo_hint: …”)
    // documents where the text lives now, so only a real `key:` entry fails.
    check('archeo_hint is gone from translations.js', !/archeo_hint\s*:/.test(translations.replace(/ex-archeo_hint\s*:/g, '')));
    // …and its text now lives in the module's own I18N, under info_hint,
    // for BOTH languages, next to a localized popup title.
    check('the EN info hint moved into archeo-potential.js',
        /info_hint: 'Searches for locations with archaeological potential reported/.test(archeoCode));
    check('the RO info hint moved into archeo-potential.js',
        /info_hint: 'Se cauta locatii cu potential arheologic raportate/.test(archeoCode));
    check('the popup title is localized too',
        /info_title: 'Archeological Potential Sites'/.test(archeoCode) &&
        /info_title: 'Zone cu potențial arheologic'/.test(archeoCode));
}

/* ── 4. Runtime: unchecked toggle → layer OFF; info helper localized ── */
console.log('\n[Runtime: default OFF + info popup]');
{
    const fakeEl = (extra) => Object.assign({
        textContent: '', innerHTML: '', style: {}, disabled: false, checked: false,
        value: '10', min: '1', max: '10', dataset: {}, parentElement: null,
        classList: (() => {
            const set = new Set();
            return {
                add(c) { set.add(c); }, remove(c) { set.delete(c); },
                toggle(c, on) { const v = (on === undefined) ? !set.has(c) : !!on; v ? set.add(c) : set.delete(c); return v; },
                contains(c) { return set.has(c); }
            };
        })(),
        attrs: {},
        addEventListener() {},
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
        appendChild(child) { return child; }, focus() {}, querySelector() { return null; }
    }, extra || {});

    const build = (toggleChecked, lang) => {
        const dom = {
            archeoPotRunBtn: fakeEl(),
            archeoPotStatus: fakeEl(),
            archeoPotSummary: fakeEl(),
            archeoPotDistance: fakeEl({ value: '10', min: '1', max: '10' }),
            archeoPotDistanceValue: fakeEl(),
            archeoPotModeBubbles: fakeEl(),
            archeoPotModeHeat: fakeEl(),
            archeoPotLegendBubbles: fakeEl(),
            archeoPotLegendHeat: fakeEl(),
            archeoPotHeatbar: fakeEl(),
            archeoPotToggle: fakeEl({ checked: toggleChecked }),
            archeoPotentialRow: fakeEl()
        };
        const sandbox = {
            console, performance: { now: () => Date.now() }, setTimeout, clearTimeout,
            Promise, Math, JSON, isFinite, isNaN,
            document: {
                readyState: 'complete',
                addEventListener() {},
                getElementById: (id) => dom[id] || null,
                querySelectorAll: () => [],
                createElement: (tag) => tag === 'canvas'
                    ? { width: 0, height: 0, style: {}, getContext: () => null }
                    : { style: {} }
            },
            window: {},
            L: { layerGroup: () => ({ addTo() { return this; } }), latLng: (a, b) => ({ lat: a, lng: b }) }
        };
        sandbox.window.window = sandbox.window;
        sandbox.window.document = sandbox.document;
        sandbox.window.L = sandbox.L;
        sandbox.window._currentLang = () => lang;
        sandbox.window._dlMap = null;
        sandbox.window._localLayerData = {};
        sandbox.window._uatGetTile = null;
        sandbox.window._UAT_TILE_UNREADABLE = { unreadable: true };
        sandbox.window.UAT_TILE_Z = 14;
        const infoCalls = [];
        sandbox.window.showLayerInfo = (t, a, d) => { infoCalls.push({ title: t, attribution: a, description: d }); };
        return { sandbox, dom, infoCalls };
    };

    // 4a. Production markup (unchecked toggle) → the layer must boot OFF.
    const off = build(false, 'en');
    vm.runInNewContext(archeoCode, off.sandbox, { filename: 'archeo-potential.js' });
    const st0 = off.sandbox.window._archeoPotentialState();
    check('unchecked toggle → results hidden at load', st0.resultsVisible === false, JSON.stringify(st0));
    check('unchecked toggle → pin mode stays off at load', st0.pinMode === false, JSON.stringify(st0));
    check('unchecked toggle → the Detect button stays hidden',
        off.dom.archeoPotRunBtn.style.display === 'none' ||
        off.dom.archeoPotRunBtn.classList.contains('is-hidden'),
        off.dom.archeoPotRunBtn.style.display);
    check('unchecked toggle → the row is not marked as on',
        !off.dom.archeoPotentialRow.classList.contains('is-on'));

    // …and switching the layer on arms everything again.
    off.sandbox.window.toggleArcheoPotentialLayer(true);
    const st1 = off.sandbox.window._archeoPotentialState();
    check('switching ON brings back results visibility + pin mode',
        st1.resultsVisible === true && st1.pinMode === true, JSON.stringify(st1));
    check('switching ON shows the Detect button',
        off.dom.archeoPotRunBtn.style.display !== 'none', off.dom.archeoPotRunBtn.style.display);

    // 4b. The info helper feeds showLayerInfo with the localized triple.
    off.sandbox.window.showArcheoPotInfo();
    check('info popup (EN): title / attribution / description',
        off.infoCalls.length === 1 &&
        off.infoCalls[0].title === 'Archeological Potential Sites' &&
        off.infoCalls[0].attribution === '© DetectLab 2026 · date RAN CIMEC' &&
        /^Searches for locations with archaeological potential/.test(off.infoCalls[0].description) &&
        /Red = the UAT built-up area/.test(off.infoCalls[0].description),
        JSON.stringify(off.infoCalls[0] || null));

    const ro = build(false, 'ro');
    vm.runInNewContext(archeoCode, ro.sandbox, { filename: 'archeo-potential.js' });
    ro.sandbox.window.showArcheoPotInfo();
    check('info popup (RO): title / attribution / description',
        ro.infoCalls.length === 1 &&
        ro.infoCalls[0].title === 'Zone cu potențial arheologic' &&
        ro.infoCalls[0].attribution === '© DetectLab 2026 · date RAN CIMEC' &&
        /^Se cauta locatii cu potential arheologic raportate/.test(ro.infoCalls[0].description) &&
        /Roșu = intravilanul UAT/.test(ro.infoCalls[0].description),
        JSON.stringify(ro.infoCalls[0] || null));
}

/* ── 5. Cache busting: the touched assets ship under the new ?v= tag ── */
console.log('\n[Cache busting]');
{
    const v = 'archeo-info-toggle-off';
    check('index.html requests the bumped styles.css', html.includes('css/styles.css?v=20260918-' + v));
    check('index.html requests the bumped translations.js', html.includes('js/translations.js?v=20260918-' + v));
    check('index.html requests the bumped archeo-potential.js', html.includes('js/archeo-potential.js?v=20260918-' + v));
    const sw = read('sw.js');
    check('sw.js precaches the bumped app shell',
        sw.includes('js/archeo-potential.js?v=20260918-' + v) &&
        sw.includes('js/translations.js?v=20260918-' + v) &&
        sw.includes('css/styles.css?v=20260918-' + v));
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
