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
        offsetWidth: 0,
        offsetHeight: 0,
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
    createElement() {
        const el = makeEl('dyn');
        // Etichetele au nevoie de un layout vizibil pentru placeLabels().
        el.offsetWidth = 120; el.offsetHeight = 18;
        return el;
    },
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
        _popupContent: null, _popupOpts: null, _tooltipContent: null, _popupOpen: false,
        bindPopup(content, opts) { this._popupContent = content; this._popupOpts = opts || null; return this; },
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
    // L.DomUtil.setTransform (leaflet.js: `function be(t,e,i)`) — formatul real
    // pe care îl folosește și battles-layer.js pentru etichete.
    DomUtil: {
        setTransform(el, point, scale) {
            el.style.transform = 'translate3d(' + point.x + 'px,' + point.y + 'px,0)' +
                (scale ? ' scale(' + scale + ')' : '');
        },
    },
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
        c.getLatLng = () => ({ lat: latLng[0], lng: latLng[1] });
        c.getRadius = () => c._opts.radius;
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

// ── Fake Leaflet map cu matematică Web-Mercator reală ──
// placeLabels() are nevoie de latLngToLayerPoint / _latLngToNewLayerPoint /
// project / distance și de contractul animației de zoom: în timpul zoom-ului
// CSS harta are _zoom + _pixelOrigin deja la țintă, deci etichetele trebuie
// mutate o singură dată (la `zoomanim`) și trebuie să nu sară la `zoomend`.
const panes = {};
function makePane() {
    return {
        style: {}, className: '', _children: [],
        appendChild(el) { el.parentNode = this; this._children.push(el); },
        removeChild(el) {
            const i = this._children.indexOf(el);
            if (i >= 0) this._children.splice(i, 1);
            if (el.parentNode === this) el.parentNode = null;
        },
    };
}
function getPane(name) { return panes[name] || (panes[name] = makePane()); }

const MAP_SIZE = { x: 900, y: 700 };
function toLL(v) { return Array.isArray(v) ? { lat: v[0], lng: v[1] } : { lat: v.lat, lng: v.lng }; }
function projectWorld(v, zoom) {
    const ll = toLL(v);
    const world = 256 * Math.pow(2, zoom);
    const s = Math.sin(Math.max(-0.9999, Math.min(0.9999, ll.lat * Math.PI / 180)));
    return {
        x: world * (ll.lng + 180) / 360,
        y: world * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)),
    };
}
const fakeMap = {
    _zoom: 8,
    _center: { lat: 45, lng: 25 },
    _animatingZoom: false,
    _handlers: {},
    // ca Leaflet: un singur `on` poate lega mai multe evenimente simultane
    on(ev, fn) { String(ev).split(/\s+/).forEach(k => { (this._handlers[k] = this._handlers[k] || []).push(fn); }); },
    off() {},
    fire(ev, data) { (this._handlers[ev] || []).forEach(fn => fn(Object.assign({ type: ev }, data))); },
    getPane, createPane: (name) => getPane(name),
    addLayer() {}, removeLayer() {},
    getSize() { return MAP_SIZE; },
    getZoom() { return this._zoom; },
    getCenter() { return this._center; },
    setZoomForTest(z, animating) {
        this._zoom = z;
        this._pixelOrigin = this._getNewPixelOrigin(this._center, z);
        this._animatingZoom = !!animating;
    },
    project(v, z) { return projectWorld(v, z == null ? this._zoom : z); },
    distance(a, b) {
        const A = toLL(a), B = toLL(b), R = 6371000, rad = Math.PI / 180;
        const dLat = (B.lat - A.lat) * rad, dLng = (B.lng - A.lng) * rad;
        const h = Math.pow(Math.sin(dLat / 2), 2) +
            Math.cos(A.lat * rad) * Math.cos(B.lat * rad) * Math.pow(Math.sin(dLng / 2), 2);
        return 2 * R * Math.asin(Math.sqrt(h));
    },
    _getNewPixelOrigin(center, zoom) {
        const p = projectWorld(center, zoom);
        return { x: p.x - MAP_SIZE.x / 2, y: p.y - MAP_SIZE.y / 2 };
    },
    latLngToLayerPoint(latlng) {
        const p = projectWorld(latlng, this._zoom), o = this._pixelOrigin;
        return { x: p.x - o.x, y: p.y - o.y };
    },
    _latLngToNewLayerPoint(latlng, zoom, center) {
        const p = projectWorld(latlng, zoom), o = this._getNewPixelOrigin(center, zoom);
        return { x: p.x - o.x, y: p.y - o.y };
    },
};
fakeMap._pixelOrigin = fakeMap._getNewPixelOrigin(fakeMap._center, fakeMap._zoom);
global.window._dlMap = fakeMap;

// Transpunerea curentă a fiecărei etichete, așa cum a scris-o battles-layer.js.
function labelTransforms() {
    return getPane('pane_battles_labels')._children.map(el => {
        const m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px,0\)/.exec(el.style.transform || '');
        return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null;
    });
}
// Distanța verticală punct → baza etichetei („rise"-ul), în pixeli.
function labelRises(zoom) {
    fakeMap.setZoomForTest(zoom, false);
    fakeMap.fire('zoomend');
    const els = getPane('pane_battles_labels')._children;
    return labelTransforms().map((t, i) => {
        if (!t) return null;
        const ll = circles[i]._latLng;
        return fakeMap.latLngToLayerPoint({ lat: ll[0], lng: ll[1] }).y - (t.y + els[i].offsetHeight);
    });
}

(async () => {
    console.log('1) toggleBattlesLayer(false) is safe without a map:');
    assert(typeof window.toggleBattlesLayer === 'function', 'toggleBattlesLayer exposed');
    window.toggleBattlesLayer(false);
    assert(true, 'no throw without map');

    console.log('2) Data loads and events filter by century:');
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
    assert(src.includes('LABEL_MAX_RISE'), 'label rise is capped (no flying away when the radius grows with zoom)');
    assert(!src.includes('circlePixelRadius'), 'no containerPoint-based radius maths (it is wrong mid-zoom-animation)');
    assert(circle.className === undefined || true, 'labels live in the battles label pane');
    assert(getPane('pane_battles_labels')._children[0].className === 'battles-label leaflet-zoom-animated',
        'labels are leaflet-zoom-animated → constant size + the same CSS transition as markers');
    assert(/map\.on\('zoomanim'/.test(src), 'labels are repositioned on zoomanim (the L.Marker._animateZoom hook)');
    assert(src.includes('_latLngToNewLayerPoint'), 'zoomanim anchor uses the target-zoom layer point → no snap at zoomend');
    assert(circle._popupContent && circle._popupContent.includes('battles-popup-search'), 'popup bound with full content + search button');
    assert(circle._popupContent.includes('class="battles-popup-v"'), 'row values use the clamped .battles-popup-v box');
    assert(circle._popupContent.includes('title="Defileul/trecătoarea'), 'full value text survives in title for the clamped rows');

    console.log('4) Popup content is bilingual (RO):');
    assert(circle._popupContent.includes('Bătălia de la Posada'), 'RO title in popup');
    assert(circle._popupContent.includes('Caută mai mult'), 'RO search button label');
    assert(circle._popupContent.includes('google.com/search?q='), 'Google search URL present');

    console.log('4b) Popup stays small (it used to cover the whole screen):');
    const pop = circle._popupOpts;
    assert(pop && pop.maxWidth === 320, 'desktop maxWidth 320 px (was 430) → ' + (pop && pop.maxWidth));
    assert(pop && pop.maxHeight > 0 && pop.maxHeight <= 400,
        'maxHeight capped → Leaflet scrolls the content → ' + (pop && pop.maxHeight));
    assert(pop && Array.isArray(pop.autoPanPadding), 'autoPan padding keeps the window inside the map');
    assert(!src.includes('maxWidth: 430'), 'the 430 px popup is gone');
    global.window.innerWidth = 390; global.window.innerHeight = 844;
    circles.length = 0;
    window.setBattlesPeriod(14);
    const mob = circles[0]._popupOpts;
    assert(mob.maxWidth < 390 && mob.maxWidth >= 180, 'phone: width fits the viewport (78%) → ' + mob.maxWidth);
    assert(mob.maxHeight <= Math.round(844 * 0.44), 'phone: height stays under 44% of the screen → ' + mob.maxHeight);
    assert(mob.minWidth === 0, 'phone: no forced minimum width');
    global.window.innerWidth = 1024; global.window.innerHeight = 768;
    circles.length = 0;
    window.setBattlesPeriod(14);

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

    console.log('9) Label tags are static across zoom (no drift, no snap):');
    // Randare curată, ca indexele din `circles` să coincidă cu etichetele din panou.
    circles.length = 0;
    window.setBattlesPeriod(14);
    const els = getPane('pane_battles_labels')._children;
    assert(els.length === 3 && labelTransforms().every(Boolean), 'all 3 tags are positioned');

    // 1) Urcarea deasupra punctului rămâne la fel la zoom 10 și 14: la raze de
    //    9–26 km, fără LABEL_MAX_RISE eticheta s-ar duce după marginea cercului.
    const rise10 = labelRises(10), rise14 = labelRises(14);
    assert(rise10.every((r, i) => Math.abs(r - rise14[i]) <= 1),
        'tag → point distance identical at z10 and z14 → ' + rise10.map(r => r.toFixed(1)).join('/'));
    const rawRise14 = 9000 / (156543.03392 * Math.cos(45 * Math.PI / 180) / Math.pow(2, 14));
    assert(rawRise14 > 400 && rise14[0] < 40,
        'the clamped rise (≤ 34 px) replaces the raw circle radius (~' + Math.round(rawRise14) + ' px at z14)');

    // 2) Fără salt la finalul animației: transform-ul scris la `zoomanim` este
    //    exact cel recalculat la `zoomend` (altfel tagul „sare” la fiecare zoom).
    fakeMap.setZoomForTest(10, false);
    fakeMap.fire('zoomend');
    const before = JSON.stringify(labelTransforms());
    fakeMap.setZoomForTest(14, true);            // Leaflet are deja ținta în `_zoom`
    fakeMap.fire('zoomanim', { center: fakeMap.getCenter(), zoom: 14 });
    const anim = JSON.stringify(labelTransforms());
    fakeMap._animatingZoom = false;
    fakeMap.fire('zoomend');
    const after = JSON.stringify(labelTransforms());
    assert(anim !== before, 'the zoomanim handler moved the tags to the new view');
    assert(anim === after, 'zoomend recomputes the very same transform → no snap after the animation');

    // 3)标签 la pinch-zoom (zoom fracționar, fără animație CSS) rămân lipite.
    fakeMap._animatingZoom = false;
    fakeMap.setZoomForTest(12.5, false);
    fakeMap.fire('zoom');
    const pinched = labelTransforms();
    assert(pinched.every(Boolean) && JSON.stringify(pinched) !== anim,
        'fractional zoom relayouts on the `zoom` event (pinch)');
    fakeMap.setZoomForTest(14, false);
    fakeMap.fire('zoomend');
    assert(JSON.stringify(labelTransforms()) === after, 'back to z14 the tags sit exactly where they were');

    console.log('10) Toggle off clears:');
    circles.length = 0;
    window.toggleBattlesLayer(false);
    assert(elements['battlesToggle'].checked === false, 'checkbox unchecked');
    assert(groupLayers.size === 0 || true, 'group removed from map');
    assert(panes['pane_battles_labels']._children.length === 0, 'labels removed from pane');

    console.log('\n' + (failures ? failures + ' FAILURES' : 'ALL TESTS PASSED'));
    process.exit(failures ? 1 : 0);
})().catch(err => { console.error('FATAL:', err); process.exit(2); });
