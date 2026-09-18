/*
 * test-sat-historic-periods.js
 * ──────────────────────────────────────────────────────────────────────────
 * Guards the Satellite layer's "Istoric" period slider:
 *
 *   2016    → geospatial:of_2017_2020  (services.geo-spatial.org /geoserver/geospatial/wms)
 *   2025    → the existing Esri World Imagery base (window._satLayer)
 *
 *   The 2018 orthophoto (clc:of_2018_2020, GeoServer "clc") was removed from
 *   the base layer, so the slider has two stops instead of three.
 *
 * Requirements covered:
 *   1. The 2016 orthophoto is a real WMS layer owned by the Satellite layer —
 *      NOT a sublayer in the panel; exactly one base period is on the map and
 *      nothing reaches for a 2018 layer any more.
 *   2. The panel Satellite card carries a second slider titled "Istoric" with
 *      two stops (2016 / 2025); switching shows the matching map.
 *   3. The map-side vertical mirrors: opacity AND period both appear together
 *      whenever the Satellite layer is selected, even if only one is touched —
 *      on desktop AND at phone width (≤600px), which is what every installed
 *      PWA reports. Both mirrors used to resolve to the SAME `right` edge
 *      there (a later, equal-specificity media rule won the cascade), so only
 *      the ISTORIC mirror was ever visible in the PWA.
 *
 * Run:  node test-sat-historic-periods.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mapApp = fs.readFileSync(path.join(__dirname, 'js/map-app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, 'css/styles.css'), 'utf8');
const translations = fs.readFileSync(path.join(__dirname, 'js/translations.js'), 'utf8');
const swJs = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

let failures = 0;
let checks = 0;
function check(name, cond, detail) {
    checks++;
    if (cond) {
        console.log('  \u2713 ' + name);
    } else {
        failures++;
        console.error('  \u2717 ' + name + (detail ? ' — ' + detail : ''));
    }
}

console.log('[1] WMS layer for the 2016 orthophoto (2018 removed)');
{
    check('2016 layer uses the geo-spatial workspace WMS',
        /services\.geo-spatial\.org\/geoserver\/geospatial\/wms/.test(mapApp));
    check('2016 layer requests geospatial:of_2017_2020',
        /layers:\s*'geospatial:of_2017_2020'/.test(mapApp));
    // The prose comment may still name the dropped layer; no CODE may use it.
    check('the 2018 orthophoto is gone from the base layer',
        !/layers:\s*'clc:of_2018_2020'/.test(mapApp) &&
        !/geoserver\/clc\/wms/.test(mapApp) &&
        !/_sat2018Layer/.test(mapApp) &&
        !/'2018'\s*:/.test(mapApp));
    check('historical layer lives on the satellite-level pane',
        /pane_sat_hist/.test(mapApp) && /window\._sat2016Layer/.test(mapApp));
    check('the historical registry still ships for external consumers',
        /window\._satHistPeriods = SAT_HIST_PERIODS/.test(mapApp));
}

console.log('[2] Period switching (setSatPeriod)');
{
    check('setSatPeriod is a global entry point', /window\.setSatPeriod\s*=\s*function/.test(mapApp));
    check('period order is 2016 → prezent (two stops)',
        /SAT_PERIOD_ORDER\s*=\s*\[\s*'2016',\s*'prezent'\s*\]/.test(mapApp));
    check('the last stop index is derived from the order, not hard-coded',
        /SAT_PERIOD_LAST_INDEX\s*=\s*SAT_PERIOD_ORDER\.length - 1/.test(mapApp));
    check('the Esri base is removed when a historical period is active',
        /map\.removeLayer\(satelliteLayer\)/.test(mapApp));
    check('opacity applies to the historical orthophoto too',
        /SAT_HIST_PERIODS\['2016'\]\.setOpacity\(/.test(mapApp));
    check('setSatOpacity keeps driving the historical layer',
        /window\._satHistPeriods\['2016'\]\.setOpacity\(opacity\)/.test(mapApp));
    check('no opacity or visibility path still reaches a 2018 layer',
        !/SAT_HIST_PERIODS\['2018'\]/.test(mapApp) && !/_satHistPeriods\['2018'\]/.test(mapApp));
}

console.log('[3] Panel UI: the "Istoric" slider inside the Satellite card');
{
    const periodSliderTag = (indexHtml.match(/<input\b[^>]*id="satPeriodSlider"[^>]*>/) || [])[0] || '';
    check('period slider exists', !!periodSliderTag);
    check('period slider has exactly two stops (min 0, max 1, step 1)',
        /min="0"/.test(periodSliderTag) && /max="1"/.test(periodSliderTag) && /step="1"/.test(periodSliderTag));
    check('period slider defaults to 2025 (value 1)', /value="1"/.test(periodSliderTag));
    check('period slider drives setSatPeriod', /oninput="setSatPeriod\(this\.value\)"/.test(periodSliderTag));
    check('period slider is NOT an opacity id (panel auto-discovery stays at 35)',
        !/id="[^"]*Opacity/.test(periodSliderTag));
    check('slider title "Istoric" is translated via data-key',
        /data-key="layer_sat_period_label"/.test(indexHtml));
    check('last stop "2025" is translated via data-key',
        /data-key="layer_sat_period_present"/.test(indexHtml));
    check('tick labels row with two stops ships in the card',
        /id="satPeriodTicks"/.test(indexHtml) &&
        (indexHtml.match(/<div class="sat-period-ticks" id="satPeriodTicks"[\s\S]{0,400}?<\/div>/) || [''])[0]
            .split('<span').length - 1 === 2);
    check('the 2018 tick label is gone from the card',
        !/<div class="sat-period-ticks" id="satPeriodTicks"[\s\S]{0,400}?2018/.test(indexHtml));
    check('live period label element exists', /id="satPeriodLabel"/.test(indexHtml));
    check('period slider sits inside the Satellite card (no separate sublayer)',
        /<!-- Satellite basemap slider -->[\s\S]*?id="satOpacitySlider"[\s\S]*?id="satPeriodSlider"[\s\S]*?<\/div>\s*<div class="transp-divider/.test(indexHtml));
}

console.log('[4] Map-side vertical mirrors (opacity + period shown together)');
{
    check('vertical period control markup exists',
        /id="verticalSatPeriodControl"/.test(indexHtml) &&
        /id="verticalSatPeriodSlider"/.test(indexHtml) &&
        /id="verticalSatPeriodValue"/.test(indexHtml));
    check('vertical period control is marked satperiod kind',
        /id="verticalSatPeriodControl"[\s\S]{0,300}?data-kind="satperiod"/.test(indexHtml));
    check('vertical period slider mirrors the two stops',
        /<input[^>]*id="verticalSatPeriodSlider"[^>]*min="0"[^>]*max="1"/.test(indexHtml));
    check('CSS anchors the period mirror to the left of the opacity mirror',
        /\.vertical-period-control\s*\{[^}]*right:\s*calc\(38px \+ 50px \+ 14px/.test(stylesCss));
    check('panel period slider ships stop markers',
        /input\.transp-slider\.sat-period-slider/.test(stylesCss));
    check('tick labels have an active state', /\.sat-period-ticks span\.active/.test(stylesCss));

    /* ── PWA regression: the two mirrors must never land on the same anchor ──
       Installed PWAs and phones are always ≤600px wide, where
       `@media (max-width: 600px) { .vertical-opacity-control { right: 34px } }`
       is the LAST `right` declaration for the generic mirror class. Because the
       period anchor used to be a bare `.vertical-period-control` (same 0,1,0
       specificity, earlier in the file) it lost that media rule and both
       mirrors resolved to `right: 34px` — stacked on top of each other, so only
       the ISTORIC one (last in the DOM) was visible. This mini-cascade
       reproduces the browser's pick for both widths so the bug cannot return. */
    function mediaRanges(condition) {
        const ranges = [];
        let idx = stylesCss.indexOf('@media (' + condition + ')');
        while (idx !== -1) {
            const open = stylesCss.indexOf('{', idx);
            let depth = 0;
            let end = open;
            for (let i = open; i < stylesCss.length; i++) {
                if (stylesCss[i] === '{') depth++;
                else if (stylesCss[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            ranges.push({ start: idx, end: end });
            idx = stylesCss.indexOf('@media (' + condition + ')', end);
        }
        return ranges;
    }

    const mobileRanges = mediaRanges('max-width: 600px');
    function inMobileBlock(index) {
        return mobileRanges.some(function (r) { return index > r.start && index < r.end; });
    }

    function collectRightRules() {
        const shapes = [
            { selector: '\\.vertical-opacity-control', classes: 1 },
            { selector: '\\.vertical-opacity-control\\.vertical-period-control', classes: 2 }
        ];
        const rules = [];
        shapes.forEach(function (shape) {
            const re = new RegExp(shape.selector + '\\s*\\{([^}]*)\\}', 'g');
            let m;
            while ((m = re.exec(stylesCss))) {
                const right = (m[1].match(/(?:^|;|\{)\s*right\s*:\s*([^;]+);/) || [])[1];
                if (!right) continue;
                rules.push({
                    selector: shape.selector.replace(/\\/g, ''),
                    right: right.trim(),
                    classes: shape.classes,
                    order: m.index,
                    mobile: inMobileBlock(m.index)
                });
            }
        });
        return rules;
    }

    function resolveRight(rules, viewportWidth) {
        const applicable = rules.filter(function (r) { return !r.mobile || viewportWidth <= 600; });
        applicable.sort(function (a, b) { return (a.classes - b.classes) || (a.order - b.order); });
        return applicable[applicable.length - 1];
    }

    function calcPxTotal(value) {
        const calc = value.match(/calc\(([^)]*)\)/);
        let total = 0;
        (calc ? calc[1] : value).split('+').forEach(function (part) {
            const px = part.match(/(-?\d+(?:\.\d+)?)px/);
            if (px) total += Number(px[1]);
        });
        return total;
    }

    const desktopWidth = 1280;
    const phoneWidth = 390;
    const rightRules = collectRightRules();
    const opacityOnly = rightRules.filter(function (r) { return r.classes === 1; });
    const desktopOpacity = resolveRight(opacityOnly, desktopWidth);
    const desktopPeriod = resolveRight(rightRules, desktopWidth);
    const phoneOpacity = resolveRight(opacityOnly, phoneWidth);
    const phonePeriod = resolveRight(rightRules, phoneWidth);

    check('desktop keeps the classic anchors (38px / 38 + 50 + 14)',
        desktopOpacity.right === 'calc(38px + env(safe-area-inset-right, 0px))' &&
        desktopPeriod.right === 'calc(38px + 50px + 14px + env(safe-area-inset-right, 0px))');
    check('phone/PWA narrows the opacity mirror to 34px + 46px wide',
        phoneOpacity.right === 'calc(34px + env(safe-area-inset-right, 0px))');
    check('phone/PWA moves the period mirror left by its width + the gap',
        phonePeriod.right === 'calc(34px + 46px + 14px + env(safe-area-inset-right, 0px))');
    check('phone/PWA: the mirrors cannot overlap (period edge ≥ mirror + gap)',
        calcPxTotal(phonePeriod.right) - calcPxTotal(phoneOpacity.right) >= 46 + 10,
        phonePeriod.right + ' vs ' + phoneOpacity.right);
    check('desktop: the mirrors cannot overlap either',
        calcPxTotal(desktopPeriod.right) - calcPxTotal(desktopOpacity.right) >= 50 + 10);
    check('a two-class period anchor wins the cascade at both widths',
        desktopPeriod.classes === 2 && phonePeriod.classes === 2);
}

console.log('[5] Translations + PWA wiring');
{
    check('EN translations carry the new keys',
        /layer_sat_period_label:\s*'Historic'/.test(translations) &&
        /layer_sat_period_present:\s*'2025'/.test(translations));
    check('RO translations carry the new keys',
        /layer_sat_period_label:\s*'Istoric'/.test(translations) &&
        /layer_sat_period_present:\s*'2025'/.test(translations));
    check('index.html loads the sat-historic builds',
        // map-app.js keeps getting re-versioned by every later release
        // (the visibility prompt bumped it to ?v=20260915-visibility-prompt),
        // so require the cache-buster pattern instead of one frozen string.
        /js\/map-app\.js\?v=\d{8}-/.test(indexHtml) &&
        // vertical-opacity-control.js is re-versioned too (the dropped OPACITY
        // caption bumped it past ?v=20260916-sat-2016-only), so match the
        // cache-buster pattern instead of one frozen tag.
        /js\/vertical-opacity-control\.js\?v=\d{8}-/.test(indexHtml) &&
        // translations.js keeps getting re-versioned by every later release
        // (social bumped it to ?v=20260915-social), so require the cache-buster
        // pattern instead of one frozen string.
        /js\/translations\.js\?v=\d{8}-/.test(indexHtml) &&
        // styles.css is re-versioned as well (2018 removal + the PWA mirror
        // fix bumped it to ?v=20260916-sat-2016-only), so match the pattern,
        // not a frozen tag.
        /css\/styles\.css\?v=\d{8}-/.test(indexHtml));
    check('SW pre-caches the sat-historic builds',
        swJs.includes("'js/map-app.js?v=20260915-sat-historic'") &&
        swJs.includes("'js/vertical-opacity-control.js?v=20260915-sat-historic'") &&
        swJs.includes("'css/styles.css?v=20260915-sat-historic'"));
    // The page can only request ONE URL per asset, so assert the LIVE
    // relationship instead of frozen tags: every asset index.html requests must
    // be the exact URL the service worker pre-caches (no offline gap), while
    // the older entries above stay in the list purely historically.
    ['css/styles.css', 'js/map-app.js', 'js/vertical-opacity-control.js', 'js/auth.js'].forEach(function (asset) {
        const live = (indexHtml.match(new RegExp(asset.replace(/\./g, '\\.') + '\\?v=[^"\']+')) || [])[0];
        check('SW pre-caches the live ' + asset + ' URL requested by index.html',
            !!live && swJs.includes("'" + live + "'"), live || '<none>');
    });
    // The cache name is re-bumped by every release; parse the number and
    // require at least the sat-historic bump (v85) instead of pinning a tag
    // that goes stale with the next release.
    const cacheVersion = Number((swJs.match(/const CACHE_NAME = 'detectlab-v(\d+)-/) || [])[1] || 0);
    check('SW CACHE_NAME was bumped past the sat-historic release', cacheVersion >= 85, 'v' + cacheVersion);
}

// ─────────────────────────────────────────────────────────────────────────
// Behaviour: run vertical-opacity-control.js against a mock DOM and verify
// the paired mirrors.
// ─────────────────────────────────────────────────────────────────────────
console.log('[6] Paired vertical mirrors behave correctly');

class ClassList {
    constructor(classes) { this._set = new Set(classes || []); }
    add(name) { this._set.add(name); }
    remove(name) { this._set.delete(name); }
    contains(name) { return this._set.has(name); }
    toggle(name, on) {
        if (on === undefined) on = !this.contains(name);
        if (on) this.add(name); else this.remove(name);
        return on;
    }
}

class MockElement extends EventTarget {
    constructor(tag, id, classes) {
        super();
        this.tagName = String(tag || 'div').toUpperCase();
        this.id = id || '';
        this.classList = new ClassList(classes || []);
        this.parentElement = null;
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.textContent = '';
        this.title = '';
        this.value = '';
        this.min = '';
        this.max = '';
        this.step = '';
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || null; }
    querySelectorAll(selector) {
        const result = [];
        function visit(node) {
            node.children.forEach(function (child) {
                if (selector === '[data-key^="layer_"]' &&
                    String(child.getAttribute('data-key') || '').indexOf('layer_') === 0) result.push(child);
                visit(child);
            });
        }
        visit(this);
        return result;
    }
    closest(selector) {
        const interactive = /input|button|label|a|select|textarea/.test(selector);
        if (interactive && /^(INPUT|BUTTON|LABEL|A|SELECT|TEXTAREA)$/.test(this.tagName)) return this;
        return this.parentElement ? this.parentElement.closest(selector) : null;
    }
    click() { this.dispatchEvent(new Event('click')); }
    focus() { this.dispatchEvent(new Event('focus')); }
}

function range(id, value, min, max) {
    const input = new MockElement('input', id, ['transp-slider']);
    input.value = String(value);
    input.min = min || '0';
    input.max = max || '100';
    input.step = '1';
    return input;
}

const panel = new MockElement('div', 'transpPanel', ['open']);
const tab = new MockElement('button', 'transpTab');
const control = new MockElement('div', 'verticalOpacityControl');
const caption = new MockElement('span', 'verticalOpacityCaption');
const vertical = range('verticalOpacitySlider', 80);
const output = new MockElement('output', 'verticalOpacityValue');
const label = new MockElement('span', 'verticalOpacityLayer');
const close = new MockElement('button', 'verticalOpacityClose');

const periodControl = new MockElement('div', 'verticalSatPeriodControl');
const periodCaption = new MockElement('span', 'verticalSatPeriodCaption');
const periodVertical = range('verticalSatPeriodSlider', 1, '0', '1');
const periodOutput = new MockElement('output', 'verticalSatPeriodValue');
const periodLabel = new MockElement('span', 'verticalSatPeriodLayer');

// Satellite card: opacity + period ranges in ONE row, plus the tick labels.
const satOwner = new MockElement('div', 'satOwner', ['transp-layer-row']);
const satTitle = new MockElement('span');
satTitle.textContent = 'Satelit';
satTitle.setAttribute('data-key', 'layer_satellite');
const satOpacity = range('satOpacitySlider', 100, '10', '100');
const satPeriod = range('satPeriodSlider', 1, '0', '1');
const ticks = new MockElement('div', 'satPeriodTicks', ['sat-period-ticks']);
const tick2016 = new MockElement('span'); tick2016.textContent = '2016';
const tickPrezent = new MockElement('span'); tickPrezent.textContent = '2025';
ticks.appendChild(tick2016); ticks.appendChild(tickPrezent);
satOwner.appendChild(satTitle);
satOwner.appendChild(satOpacity);
satOwner.appendChild(satPeriod);
satOwner.appendChild(ticks);
panel.appendChild(satOwner);

// A second, unrelated layer to verify the pair hides when selection moves.
const apmOwner = new MockElement('div', 'apmOwner', ['transp-layer-row']);
const apm = range('apmOpacitySlider', 80);
apmOwner.appendChild(apm);
panel.appendChild(apmOwner);

const byId = {};
[panel, tab, control, caption, vertical, output, label, close,
 periodControl, periodCaption, periodVertical, periodOutput, periodLabel,
 satOpacity, satPeriod, ticks, apm].forEach(function (el) { byId[el.id] = el; });

let panelCloseClicks = 0;
tab.addEventListener('click', function () { panelCloseClicks++; panel.classList.remove('open'); });

const documentMock = new (class extends EventTarget {
    constructor() { super(); this.readyState = 'complete'; }
    getElementById(id) { return byId[id] || null; }
    querySelector(selector) {
        if (selector === '#satPeriodTicks span:last-child') return tickPrezent;
        return null;
    }
    querySelectorAll(selector) {
        if (selector.indexOf('[id*="Opacity"]') !== -1) return [satOpacity, apm];
        return [];
    }
})();

const intervals = new Map();
const timeouts = new Map();
let intervalId = 0;
let timeoutId = 0;
let lang = 'ro';
const windowMock = {
    setInterval(fn) { const id = ++intervalId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = ++timeoutId; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    _currentLang: function () { return lang; }
};
windowMock.window = windowMock;
windowMock.document = documentMock;

const sandbox = {
    window: windowMock,
    document: documentMock,
    Event,
    console,
    Number,
    String,
    Math,
    isFinite
};
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'js/vertical-opacity-control.js'), 'utf8'),
    sandbox,
    { filename: 'vertical-opacity-control.js' }
);

// Selecting the Satellite layer through its opacity slider reveals BOTH mirrors.
satOwner.click();
check('selecting the Satellite card shows the opacity mirror',
    control.classList.contains('visible'));
check('selecting the Satellite card also shows the period mirror',
    periodControl.classList.contains('visible'));
check('the opacity mirror keeps mirroring the opacity range',
    vertical.value === '100' && output.textContent === '100%');
check('the period mirror starts on 2025',
    periodVertical.value === '1' && periodOutput.textContent === '2025');
check('the period mirror follows the panel range geometry (two stops, no phantom 2018)',
    periodVertical.max === satPeriod.max && periodVertical.max === '1');
check('the period caption reads ISTORIC in Romanian',
    periodCaption.textContent === 'ISTORIC');
check('the satellite row stays highlighted',
    satOwner.classList.contains('opacity-layer-selected'));
check('the layer panel closes after the card click', panelCloseClicks === 1);

// Dragging the vertical period mirror switches the period through the panel slider.
let satPeriodInputs = 0;
satPeriod.addEventListener('input', function () { satPeriodInputs++; });
periodVertical.value = '0';
periodVertical.dispatchEvent(new Event('input'));
check('vertical period drag propagates to the panel slider', satPeriod.value === '0');
check('the panel slider input event fires exactly once', satPeriodInputs === 1);
check('the period mirror value shows the year', periodOutput.textContent === '2016');

// Back to the last stop: „2025" comes from the translated tick label.
periodVertical.value = '1';
periodVertical.dispatchEvent(new Event('input'));
check('the last stop renders the translated 2025 on the mirror',
    periodOutput.textContent === '2025');
check('the panel slider is back on 2025 too', satPeriod.value === '1');

// Programmatic panel updates (e.g. setSatPeriod) are picked up by the poll.
satPeriod.value = '0';
intervals.forEach(function (fn) { fn(); });
check('polling keeps the period mirror in sync', periodVertical.value === '0');
check('the 2016 mirror label comes from the year itself', periodOutput.textContent === '2016');

// Touching ONLY the period slider still shows both mirrors ("chiar daca doar
// unul din ele e apasat").
close.click();
check('close hides the opacity mirror', !control.classList.contains('visible'));
check('close hides the period mirror too', !periodControl.classList.contains('visible'));
satPeriod.dispatchEvent(new Event('pointerdown'));
check('pressing only the period slider re-shows the opacity mirror',
    control.classList.contains('visible'));
check('pressing only the period slider re-shows the period mirror',
    periodControl.classList.contains('visible'));

// Selecting a different layer hides the pair.
windowMock.DetectLabVerticalOpacity.select('apmOpacitySlider');
check('another layer selection hides the period mirror',
    !periodControl.classList.contains('visible'));
check('another layer selection keeps the regular single mirror',
    control.classList.contains('visible') && output.textContent === '80%');

// Language switch translates the caption; Escape clears both mirrors.
windowMock.DetectLabVerticalOpacity.select('satPeriodSlider');
lang = 'en';
documentMock.dispatchEvent(new Event('detectlab:langchange'));
check('caption follows the language (HISTORIC)', periodCaption.textContent === 'HISTORIC');
const esc = new Event('keydown');
esc.key = 'Escape';
documentMock.dispatchEvent(esc);
check('Escape hides the opacity mirror', !control.classList.contains('visible'));
check('Escape hides the period mirror', !periodControl.classList.contains('visible'));

console.log('');
if (failures) {
    console.error((checks - failures) + '/' + checks + ' checks passed — ' + failures + ' FAILED');
    process.exit(1);
}
console.log('✅ test-sat-historic-periods.js passed: ' + checks + '/' + checks + ' checks.');
