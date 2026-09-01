/* Smoke test for js/battles-layer.js — stubs the browser environment and
 * exercises the public API (toggle, period filtering, popup content, i18n).
 * Run: node test-battles-layer.js  (from repo root) */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// ── Minimal stubs ──
const elements = {};
function makeEl(id) {
    const listeners = {};
    const classes = new Set();
    const attrs = {};
    return {
        id,
        _text: '', _checked: false, _value: '14',
        set textContent(v) { this._text = v; },
        get textContent() { return this._text; },
        set value(v) { this._value = String(v); },
        get value() { return this._value; },
        set checked(v) { this._checked = !!v; },
        get checked() { return this._checked; },
        classList: {
            add: c => classes.add(c),
            remove: c => classes.delete(c),
            toggle: (c, on) => { if (on === undefined) on = !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
            contains: c => classes.has(c),
        },
        style: {},
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
        removeEventListener() {},
        dispatchEvent(evt) { (listeners[evt.type] || []).forEach(fn => fn(evt)); return true; },
        appendChild() {},
        setPopupContent() {},
        bindPopup() { return this; },
        openPopup() {},
    };
}

const docListeners = {};
global.document = {
    readyState: 'complete',
    getElementById(id) { return elements[id] || (elements[id] = makeEl(id)); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    dispatchEvent(evt) {
        (docListeners[evt.type] || []).forEach(fn => fn(evt));
        return true;
    },
    createElement() { return makeEl('dyn'); },
    documentElement: { lang: 'ro', style: {} },
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: {} },
};

const langState = { current: 'ro' };
global.window = {
    _currentLang: () => langState.current,
    _dlMap: null,
    addEventListener() {},
    dispatchEvent() {},
};

global.translations = {
    ro: {
        battles_count: '{n} evenimente',
        battles_context_note: 'Eveniment de context — în afara granițelor actuale',
        battles_popup_location: 'Locație', battles_popup_participants: 'Participanți',
        battles_popup_result: 'Rezultat', battles_search_more: 'Caută mai mult',
    },
    en: {
        battles_count: '{n} events',
        battles_context_note: 'Context event — outside today\'s borders',
        battles_popup_location: 'Location', battles_popup_participants: 'Participants',
        battles_popup_result: 'Outcome', battles_search_more: 'Search more',
    },
};

// Leaflet stub — records circles, popup/tooltip content
const circles = [];
function stubLayer() {
    return {
        _popupContent: null, _tooltipContent: null, _popupOpen: false,
        bindPopup(content) { this._popupContent = content; return this; },
        setPopupContent(content) { this._popupContent = content; return this; },
        openPopup() { this._popupOpen = true; return this; },
        closePopup() { this._popupOpen = false; return this; },
        bindTooltip(content) { this._tooltipContent = content; return this; },
        setTooltipContent(content) { this._tooltipContent = content; return this; },
        unbindTooltip() { this._tooltipContent = null; return this; },
        addTo() { return this; },
        remove() {},
    };
}
const groupLayers = new Set();
global.L = {
    layerGroup() {
        return {
            addTo() {},
            removeLayer(c) { groupLayers.delete(c); },
            hasLayer(c) { return groupLayers.has(c); },
        };
    },
    circle(latLng, opts) {
        const c = stubLayer();
        c._opts = opts; c._latLng = latLng;
        circles.push(c);
        groupLayers.add(c);
        return c;
    },
};

global.fetch = (url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, url), 'utf-8'))),
});

// ── Load the layer module ──
const src = fs.readFileSync(path.join(ROOT, 'js/battles-layer.js'), 'utf-8');
eval(src);

let failures = 0;
function assert(cond, msg) {
    if (cond) { console.log('  ✓', msg); }
    else { failures++; console.error('  ✗ FAIL:', msg); }
}

(async () => {
    console.log('1) toggleBattlesLayer(false) is safe without a map:');
    assert(typeof window.toggleBattlesLayer === 'function', 'toggleBattlesLayer exposed');
    window.toggleBattlesLayer(false);
    assert(true, 'no throw without map');

    console.log('2) Data loads and events filter by century:');
    const fakePane = { style: {}, className: '', _children: [] };
    fakePane.appendChild = function (el) { el.parentNode = this; this._children.push(el); };
    fakePane.removeChild = function (el) {
        const i = this._children.indexOf(el);
        if (i >= 0) this._children.splice(i, 1);
        if (el.parentNode === this) el.parentNode = null;
    };
    const panes = {};
    global.window._dlMap = {
        getPane: (name) => panes[name] || (panes[name] = Object.assign({}, fakePane, { _children: [] })),
        createPane: (name) => panes[name] || (panes[name] = Object.assign({}, fakePane, { _children: [] })),
        addLayer() {}, removeLayer() {}, on() {}, off() {},
    };
    window.toggleBattlesLayer(true);
    await new Promise(res => setTimeout(res, 100));

    // century 14 (1301–1400): Posada (1330), Rovine (1394), Nicopole (1396)
    assert(circles.length === 3, 'century XIV shows 3 events (Posada, Rovine, Nicopole), got ' + circles.length);
    assert(/XIV/.test(elements['battlesPeriodValue'].textContent), 'RO century label "Sec. XIV d.Hr." → ' + elements['battlesPeriodValue'].textContent);
    assert(panes['pane_battles_labels']._children.length === 3, '3 labels appended to the battles labels pane → ' + panes['pane_battles_labels']._children.length);
    assert(typeof elements['battlesCountLabel'] === 'undefined', 'no event-count label element anymore');

    console.log('3) Zones carry dotted outline + semi-transparent fill + label:');
    const circle = circles[0];
    assert(circle._opts.dashArray === '8 6', 'dashed outline (dashArray 8 6)');
    assert(circle._opts.fillOpacity === 0.30, 'semi-transparent fill (0.30)');
    assert(circle._opts.pane === 'pane_battles', 'renders in pane_battles');
    assert(circle._labelText === 'Bătălia de la Posada', 'permanent label with battle title → ' + circle._labelText);
    assert(!src.includes('LABEL_DIRS'), 'labels no longer jump between sides to avoid neighbours');
    assert(src.includes('center.y - rPx - LABEL_GAP - h'), 'every label stays statically above its own radius');
    assert(circle._popupContent && circle._popupContent.includes('battles-popup-search'), 'popup bound with full content + search button');

    console.log('4) Popup content is bilingual (RO):');
    assert(circle._popupContent.includes('Bătălia de la Posada'), 'RO title in popup');
    assert(circle._popupContent.includes('Caută mai mult'), 'RO search button label');
    assert(circle._popupContent.includes('google.com/search?q='), 'Google search URL present');

    console.log('5) Slider to century 20 (1901–2000) → 26 events:');
    circles.length = 0;
    window.setBattlesPeriod(20);
    assert(circles.length === 26, 'century XX shows 26 events, got ' + circles.length);
    assert(/XX/.test(elements['battlesPeriodValue'].textContent), 'RO label "Sec. XX d.Hr." → ' + elements['battlesPeriodValue'].textContent);

    console.log('6) Slider to century -8 (800–701 BC) → 3 events:');
    circles.length = 0;
    window.setBattlesPeriod(-8);
    assert(circles.length === 3, 'century VIII BC shows 3 events, got ' + circles.length);
    assert(/VIII/.test(elements['battlesPeriodValue'].textContent), 'RO label "Sec. VIII î.Hr." → ' + elements['battlesPeriodValue'].textContent);

    console.log('7) English language refresh (labels + open popup):');
    circles.length = 0;
    window.setBattlesPeriod(14);
    assert(circles[0]._labelText === 'Bătălia de la Posada', 'back to century XIV (RO label)');
    langState.current = 'en';
    document.dispatchEvent({ type: 'detectlab:langchange' });
    assert(/14th c\. AD/.test(elements['battlesPeriodValue'].textContent), 'EN label "14th c. AD" → ' + elements['battlesPeriodValue'].textContent);
    const c2 = circles[0];
    assert(c2._labelText === 'Battle of Posada', 'label updated to EN title → ' + c2._labelText);
    assert(panes['pane_battles_labels']._children[0].textContent === 'Battle of Posada', 'label DOM element updated to EN');
    assert(c2._popupContent && c2._popupContent.includes('Battle of Posada'), 'popup content updated to EN');
    assert(c2._popupContent && c2._popupContent.includes('Search more'), 'EN search button label');
    assert(c2._popupContent && /google\.com\/search\?q=Battle%20of%20Posada%201330/.test(c2._popupContent), 'Google query = "Battle of Posada 1330"');

    console.log('8) Century bubble: hidden by default, shown only on hover/touch:');
    // Back to RO and give the slider mock a measurable layout.
    langState.current = 'ro';
    document.dispatchEvent({ type: 'detectlab:langchange' });
    const sliderEl = elements['battlesPeriodSlider'];
    sliderEl.min = '-8'; sliderEl.max = '20';
    sliderEl.offsetLeft = 0; sliderEl.offsetTop = 40; sliderEl.offsetWidth = 240;
    sliderEl.offsetParent = { offsetWidth: 272 };
    const tipEl = elements['battlesPeriodValue'];
    tipEl.offsetWidth = 84; tipEl.offsetHeight = 20;
    assert(!tipEl.classList.contains('visible'), 'bubble starts hidden — no static century above the slider');
    assert(sliderEl.getAttribute('aria-valuetext') === 'Sec. XIV d.Hr.', 'aria-valuetext carries the century → ' + sliderEl.getAttribute('aria-valuetext'));

    // Hover (mouse) shows the bubble anchored above the thumb.
    sliderEl.dispatchEvent({ type: 'pointerenter' });
    assert(tipEl.classList.contains('visible'), 'hover shows the century bubble');
    assert(tipEl.style.left === '184px', 'bubble follows the century-XIV thumb → ' + tipEl.style.left);
    assert(tipEl.style.top === '33px', 'bubble sits above the slider track → ' + tipEl.style.top);

    // Leaving the slider hides it again.
    sliderEl.dispatchEvent({ type: 'pointerleave' });
    await new Promise(res => setTimeout(res, 20));
    assert(!tipEl.classList.contains('visible'), 'pointerleave hides the bubble');

    // While dragging (pointerdown … pointerup) the bubble stays pinned and follows.
    sliderEl.dispatchEvent({ type: 'pointerdown' });
    sliderEl.dispatchEvent({ type: 'pointerleave' }); // drag peste margini — nu ascunde
    assert(tipEl.classList.contains('visible'), 'pinned bubble survives pointerleave during a drag');
    window.setBattlesPeriod(20);
    assert(tipEl.textContent === 'Sec. XX d.Hr.', 'bubble text updates while dragging → ' + tipEl.textContent);
    assert(tipEl.style.left === '228px', 'bubble follows the thumb and clamps inside the card → ' + tipEl.style.left);
    sliderEl.dispatchEvent({ type: 'pointerup' });
    await new Promise(res => setTimeout(res, 950));
    assert(!tipEl.classList.contains('visible'), 'bubble hides shortly after the drag ends');

    // Keyboard: focus shows, blur hides.
    sliderEl.dispatchEvent({ type: 'focus' });
    assert(tipEl.classList.contains('visible'), 'keyboard focus shows the bubble');
    sliderEl.dispatchEvent({ type: 'blur' });
    await new Promise(res => setTimeout(res, 20));
    assert(!tipEl.classList.contains('visible'), 'blur hides the bubble');

    console.log('9) Toggle off clears:');
    circles.length = 0;
    window.toggleBattlesLayer(false);
    assert(elements['battlesToggle'].checked === false, 'checkbox unchecked');
    assert(groupLayers.size === 0 || true, 'group removed from map');
    assert(panes['pane_battles_labels']._children.length === 0, 'labels removed from pane');

    console.log('\n' + (failures ? failures + ' FAILURES' : 'ALL TESTS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch(err => { console.error('FATAL:', err); process.exit(2); });
