/*
 * test-sat-historic-periods.js
 * ──────────────────────────────────────────────────────────────────────────
 * Guards the Satellite layer's "Istoric" period slider:
 *
 *   2016    → geospatial:of_2017_2020  (services.geo-spatial.org /geoserver/geospatial/wms)
 *   2018    → clc:of_2018_2020         (services.geo-spatial.org /geoserver/clc/wms)
 *   Prezent → the existing Esri World Imagery base (window._satLayer)
 *
 * Requirements covered:
 *   1. The two orthophotos are real WMS layers owned by the Satellite layer —
 *      NOT sublayers in the panel; exactly one base period is on the map.
 *   2. The panel Satellite card carries a second slider titled "Istoric" with
 *      three stops (2016 / 2018 / Prezent); switching shows the matching map.
 *   3. The map-side vertical mirrors: opacity AND period both appear together
 *      whenever the Satellite layer is selected, even if only one is touched.
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

console.log('[1] WMS layers for the 2016 / 2018 orthophotos');
{
    check('2016 layer uses the geo-spatial workspace WMS',
        /services\.geo-spatial\.org\/geoserver\/geospatial\/wms/.test(mapApp));
    check('2016 layer requests geospatial:of_2017_2020',
        /layers:\s*'geospatial:of_2017_2020'/.test(mapApp));
    check('2018 layer uses the clc workspace WMS',
        /services\.geo-spatial\.org\/geoserver\/clc\/wms/.test(mapApp));
    check('2018 layer requests clc:of_2018_2020',
        /layers:\s*'clc:of_2018_2020'/.test(mapApp));
    check('historical layers live on the satellite-level pane',
        /pane_sat_hist/.test(mapApp) && /window\._sat2016Layer/.test(mapApp) && /window\._sat2018Layer/.test(mapApp));
}

console.log('[2] Period switching (setSatPeriod)');
{
    check('setSatPeriod is a global entry point', /window\.setSatPeriod\s*=\s*function/.test(mapApp));
    check('period order is 2016 → 2018 → prezent',
        /SAT_PERIOD_ORDER\s*=\s*\[\s*'2016',\s*'2018',\s*'prezent'\s*\]/.test(mapApp));
    check('the Esri base is removed when a historical period is active',
        /map\.removeLayer\(satelliteLayer\)/.test(mapApp));
    check('opacity applies to the historical orthophotos too',
        /SAT_HIST_PERIODS\['2016'\]\.setOpacity\(op\)/.test(mapApp) &&
        /SAT_HIST_PERIODS\['2018'\]\.setOpacity\(op\)/.test(mapApp));
    check('setSatOpacity keeps driving the historical layers',
        /window\._satHistPeriods\['2016'\]\.setOpacity\(opacity\)/.test(mapApp));
}

console.log('[3] Panel UI: the "Istoric" slider inside the Satellite card');
{
    const periodSliderTag = (indexHtml.match(/<input\b[^>]*id="satPeriodSlider"[^>]*>/) || [])[0] || '';
    check('period slider exists', !!periodSliderTag);
    check('period slider has exactly three stops (min 0, max 2, step 1)',
        /min="0"/.test(periodSliderTag) && /max="2"/.test(periodSliderTag) && /step="1"/.test(periodSliderTag));
    check('period slider defaults to Prezent (value 2)', /value="2"/.test(periodSliderTag));
    check('period slider drives setSatPeriod', /oninput="setSatPeriod\(this\.value\)"/.test(periodSliderTag));
    check('period slider is NOT an opacity id (panel auto-discovery stays at 35)',
        !/id="[^"]*Opacity/.test(periodSliderTag));
    check('slider title "Istoric" is translated via data-key',
        /data-key="layer_sat_period_label"/.test(indexHtml));
    check('third stop "Prezent" is translated via data-key',
        /data-key="layer_sat_period_present"/.test(indexHtml));
    check('tick labels row with three stops ships in the card',
        /id="satPeriodTicks"/.test(indexHtml) &&
        (indexHtml.match(/<div class="sat-period-ticks" id="satPeriodTicks"[\s\S]{0,400}?<\/div>/) || [''])[0]
            .split('<span').length - 1 === 3);
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
    check('vertical period slider mirrors the three stops',
        /<input[^>]*id="verticalSatPeriodSlider"[^>]*min="0"[^>]*max="2"/.test(indexHtml));
    check('CSS anchors the period mirror to the left of the opacity mirror',
        /\.vertical-period-control\s*\{[^}]*right:\s*calc\(38px \+ 68px \+ 14px/.test(stylesCss));
    check('panel period slider ships stop markers',
        /input\.transp-slider\.sat-period-slider/.test(stylesCss));
    check('tick labels have an active state', /\.sat-period-ticks span\.active/.test(stylesCss));
}

console.log('[5] Translations + PWA wiring');
{
    check('EN translations carry the new keys',
        /layer_sat_period_label:\s*'Historic'/.test(translations) &&
        /layer_sat_period_present:\s*'Present'/.test(translations));
    check('RO translations carry the new keys',
        /layer_sat_period_label:\s*'Istoric'/.test(translations) &&
        /layer_sat_period_present:\s*'Prezent'/.test(translations));
    check('index.html loads the sat-historic builds',
        indexHtml.includes('js/map-app.js?v=20260915-sat-historic') &&
        indexHtml.includes('js/vertical-opacity-control.js?v=20260915-sat-historic') &&
        // translations.js keeps getting re-versioned by every later release
        // (social bumped it to ?v=20260915-social), so require the cache-buster
        // pattern instead of one frozen string.
        /js\/translations\.js\?v=\d{8}-/.test(indexHtml) &&
        indexHtml.includes('css/styles.css?v=20260915-sat-historic'));
    check('SW pre-caches the sat-historic builds',
        swJs.includes("'js/map-app.js?v=20260915-sat-historic'") &&
        swJs.includes("'js/vertical-opacity-control.js?v=20260915-sat-historic'") &&
        swJs.includes("'css/styles.css?v=20260915-sat-historic'"));
    // The cache name is re-bumped by every release; assert it is at least the
    // sat-historic one (v85) rather than pinning a version that is already stale.
    check('SW CACHE_NAME was bumped', /const CACHE_NAME = 'detectlab-v(8[5-9]|9\d)-/.test(swJs));
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
const periodVertical = range('verticalSatPeriodSlider', 2, '0', '2');
const periodOutput = new MockElement('output', 'verticalSatPeriodValue');
const periodLabel = new MockElement('span', 'verticalSatPeriodLayer');

// Satellite card: opacity + period ranges in ONE row, plus the tick labels.
const satOwner = new MockElement('div', 'satOwner', ['transp-layer-row']);
const satTitle = new MockElement('span');
satTitle.textContent = 'Satelit';
satTitle.setAttribute('data-key', 'layer_satellite');
const satOpacity = range('satOpacitySlider', 100, '10', '100');
const satPeriod = range('satPeriodSlider', 2, '0', '2');
const ticks = new MockElement('div', 'satPeriodTicks', ['sat-period-ticks']);
const tick2016 = new MockElement('span'); tick2016.textContent = '2016';
const tick2018 = new MockElement('span'); tick2018.textContent = '2018';
const tickPrezent = new MockElement('span'); tickPrezent.textContent = 'Prezent';
ticks.appendChild(tick2016); ticks.appendChild(tick2018); ticks.appendChild(tickPrezent);
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
check('the period mirror starts on Prezent',
    periodVertical.value === '2' && periodOutput.textContent === 'Prezent');
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

periodVertical.value = '1';
periodVertical.dispatchEvent(new Event('input'));
check('period 2018 renders on the mirror', periodOutput.textContent === '2018');

// Programmatic panel updates (e.g. setSatPeriod) are picked up by the poll.
satPeriod.value = '2';
intervals.forEach(function (fn) { fn(); });
check('polling keeps the period mirror in sync', periodVertical.value === '2');
check('Prezent label comes from the translated tick', periodOutput.textContent === 'Prezent');

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
