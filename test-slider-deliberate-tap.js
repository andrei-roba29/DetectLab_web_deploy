// Regression test — „tap concret pe strat” în PWA: oglinda unui strat se
// adaugă pe ecran DOAR la un tap deliberat pe cardul stratului.
//
// Ce era rupt (raportat din aplicația instalată): în PWA era foarte ușor să
// adaugi din greșeală slidere pe ecran și, odată cu ele, să pornești straturile
// lor. Se întâmpla pe două căi implicite:
//   1. orice atingere / glisare a unui range din panou (inclusiv degetul care
//      alunecă peste el în timp ce derulezi lista) declanșa selectSource prin
//      pointerdown / focus → oglindă pe hartă + comutatorul stratului bifat;
//   2. orice clic pe cardul stratului — inclusiv cel produs la capătul unei
//      derulări — selecta stratul, închidea panoul și aprindea stratul.
//
// Regula de acum (aplicația instalată și orice ecran tactil): atingerea unui
// slider NU adaugă nimic — doar alimentează o oglindă aflată deja pe ecran;
// iar un tap pe card selectează stratul doar dacă gestul e un tap real: fără
// deplasare peste prag, fără derulare a panoului între apăsare și ridicare,
// fără un al doilea deget, fără apăsare lungă și nu imediat după o derulare.
// Pe desktop (în afara modului PWA) comportamentul rămâne cel dinainte.
//
// Real module over a mock DOM (same pattern as test-two-layer-opacity-mirrors.js),
// plus static checks on the shipped wiring.
//
// Usage: node test-slider-deliberate-tap.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const voSrc = fs.readFileSync(path.join(__dirname, 'js/vertical-opacity-control.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

/* ─────────────────── 1. static wiring of the tap guard ─────────────────── */

assert(/var TAP_MOVE_TOLERANCE = \d+/.test(voSrc), 'the tap guard needs a movement tolerance');
assert(/var TAP_MAX_DURATION = \d+/.test(voSrc), 'the tap guard needs a touch duration ceiling');
assert(/var SCROLL_QUIET_MS = \d+/.test(voSrc), 'the tap guard needs a scroll-quiet window');
assert(/function deliberateTap\(event\)/.test(voSrc), 'card taps must go through deliberateTap()');
assert(/function sliderTouch\(source, event\)/.test(voSrc), 'range touches must go through sliderTouch()');
assert(/function activateExistingMirror\(source\)/.test(voSrc),
    'touching a range may only re-activate an on-screen mirror');

// The gesture is tracked on the document, in the capture phase, so a handler
// that stops propagation cannot hide the real pointerdown from the guard.
assert(voSrc.includes("document.addEventListener('pointerdown', beginGesture, true)"),
    'pointerdown must be tracked on the document (capture phase)');
assert(voSrc.includes("document.addEventListener('pointerup', endGesture, true)"),
    'pointerup must end the tracked gesture');
assert(voSrc.includes("document.addEventListener('pointercancel', endGesture, true)"),
    'a cancelled pointer must invalidate the tracked gesture');
assert(/panelScroller\.addEventListener\('scroll'/.test(voSrc),
    'panel scrolling must be timestamped so a scroll-stopping tap never selects');

// No registration may reach selectSource() directly from a range gesture.
assert.strictEqual((voSrc.match(/sliderTouch\(source, event\);/g) || []).length, 8,
    'all range gestures (pointerdown / focus / range clicks) must use sliderTouch()');
assert.strictEqual((voSrc.match(/if \(!deliberateTap\(event\)\) return;/g) || []).length, 2,
    'both card registrations (opacity + distance/radius) must gate the tap');
assert(!/addEventListener\('pointerdown', function \(\) \{\s*selectSource\(source, false\);/.test(voSrc),
    'no range may select its layer directly on pointerdown any more');
assert(!/addEventListener\('focus', function \(\) \{\s*selectSource\(source, false\);/.test(voSrc),
    'no range may select its layer directly on focus any more');

console.log('[Test] Tap concret pe strat (PWA) — sliderul se adaugă doar la un tap deliberat...');

/* ─────────────────── 2. behaviour over the real module ─────────────────── */

class ClassList {
    constructor(classes) { this._set = new Set(classes || []); }
    add(...names) { names.forEach(name => this._set.add(name)); }
    remove(...names) { names.forEach(name => this._set.delete(name)); }
    contains(name) { return this._set.has(name); }
    toggle(name, force) {
        const on = force === undefined ? !this.contains(name) : !!force;
        if (on) this.add(name); else this.remove(name);
        return on;
    }
}

class MockEvent {
    constructor(type, props) {
        this.type = String(type);
        Object.assign(this, props || {});
        this.target = null;
        this.currentTarget = null;
        this.defaultPrevented = false;
        this._stopped = false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this._stopped = true; }
}

class MockElement {
    constructor(tag, id, classes) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.id = id || '';
        this.classList = new ClassList(classes);
        this.parentElement = null;
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.dataset = {};
        this.textContent = '';
        this.value = '';
        this.min = '0';
        this.max = '100';
        this.step = '1';
        this.title = '';
        this.checked = false;
        this.scrollTop = 0;
        this.offsetHeight = 0;
        this.clientHeight = 0;
        this._listeners = {};
    }
    addEventListener(type, fn, options) {
        const capture = !!(options === true || (options && options.capture));
        (this._listeners[type] = this._listeners[type] || []).push({ fn, capture });
    }
    removeEventListener(type, fn) {
        const list = this._listeners[type] || [];
        this._listeners[type] = list.filter(entry => entry.fn !== fn);
    }
    dispatchEvent(event) {
        propagate(this, event);
        return true;
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    insertBefore(child, ref) {
        child.parentElement = this;
        const at = this.children.indexOf(ref);
        if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
        return child;
    }
    removeChild(child) {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
        child.parentElement = null;
        return child;
    }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() { return null; }
    get parentNode() { return this.parentElement; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    contains(node) {
        let walk = node;
        while (walk) {
            if (walk === this) return true;
            walk = walk.parentElement;
        }
        return false;
    }
    closest(selector) {
        const runtimeSelector = String(selector || '');
        const tagMatch = /input|button|label|a,|select|textarea/i.test(runtimeSelector);
        let node = this;
        while (node) {
            if (tagMatch && /^(INPUT|BUTTON|LABEL|A|SELECT|TEXTAREA)$/.test(node.tagName)) return node;
            if (runtimeSelector.indexOf('[role="button"]') !== -1 &&
                node.getAttribute && node.getAttribute('role') === 'button') return node;
            if (runtimeSelector.indexOf('.transp-layer-row') !== -1 &&
                node.classList && node.classList.contains('transp-layer-row')) return node;
            node = node.parentElement;
        }
        return null;
    }
    click() { propagate(this, new MockEvent('click', { bubbles: true })); }
    focus() { propagate(this, new MockEvent('focus', {})); }
}

class MockDocument extends MockElement {
    constructor() {
        super('document', '#document');
        this.readyState = 'complete';
        this.documentElement = new MockElement('html');
        this.body = new MockElement('body');
        this.byId = {};
    }
    getElementById(id) { return this.byId[id] || null; }
    createElement(tag) { return new MockElement(tag); }
}

function invokeListeners(node, event, capture) {
    if (!node || !node._listeners || event._stopped) return;
    const list = (node._listeners[event.type] || []).slice();
    list.forEach(function (entry) {
        if (!!entry.capture !== !!capture) return;
        event.currentTarget = node;
        entry.fn.call(node, event);
    });
}

/* Real DOM order: capture from the document down to the target, the target's
   own listeners, then bubble back up (where the module's document-level click
   listener clears the tracked gesture, AFTER the card handler has read it). */
function propagate(target, event) {
    const path = [];
    let node = target;
    while (node && node !== harnessDocument) { path.push(node); node = node.parentElement; }
    path.push(harnessDocument);
    event.target = target;
    for (let i = path.length - 1; i >= 1; i--) invokeListeners(path[i], event, true);
    invokeListeners(target, event, true);
    invokeListeners(target, event, false);
    for (let i = 1; i < path.length; i++) {
        if (event._stopped) break;
        invokeListeners(path[i], event, false);
    }
}

let harnessDocument = null;

const MODULE_SRC = voSrc;

function makeHarness(options) {
    const pwa = !!(options && options.pwa);
    const doc = new MockDocument();
    harnessDocument = doc;
    if (pwa) {
        doc.documentElement.classList.add('is-pwa');
        doc.body.classList.add('is-pwa');
    }

    const add = el => { doc.byId[el.id] = el; return el; };
    const range = (id, value) => {
        const el = new MockElement('input', id, ['transp-slider']);
        el.attributes.type = 'range';
        el.value = String(value);
        return el;
    };
    const mirror = prefix => {
        const root = add(new MockElement('div', prefix + 'Control', ['vertical-opacity-control']));
        const close = add(new MockElement('button', prefix + 'Close'));
        const caption = add(new MockElement('span', prefix + 'Caption'));
        const label = add(new MockElement('span', prefix + 'Layer'));
        const slider = add(range(prefix + 'Slider', 80));
        const output = add(new MockElement('output', prefix + 'Value'));
        const actions = add(new MockElement('div', prefix + 'Actions'));
        root.appendChild(close);
        root.appendChild(caption);
        root.appendChild(label);
        root.appendChild(slider);
        root.appendChild(output);
        root.appendChild(actions);
        return { root, close, caption, label, slider, output, actions };
    };

    const panel = add(new MockElement('div', 'transpPanel', ['open']));
    panel.scrollTop = 0;
    const tab = add(new MockElement('button', 'transpTab'));
    tab.addEventListener('click', () => panel.classList.remove('open'));

    const primary = mirror('verticalOpacity');
    const secondary = mirror('verticalOpacitySecondary');
    // The shipped secondary markup keeps the primary id before the suffix.
    doc.byId.verticalOpacityControlSecondary = secondary.root;
    doc.byId.verticalOpacityCloseSecondary = secondary.close;
    doc.byId.verticalOpacityCaptionSecondary = secondary.caption;
    doc.byId.verticalOpacityLayerSecondary = secondary.label;
    doc.byId.verticalOpacitySliderSecondary = secondary.slider;
    doc.byId.verticalOpacityValueSecondary = secondary.output;
    doc.byId.verticalOpacityActionsSecondary = secondary.actions;

    // Source A — APM (switch #apmToggle), source B — Roman Empire (#romanToggle).
    const apmOwner = new MockElement('div', 'apmOwner', ['transp-layer-row']);
    const apmTitle = new MockElement('span', 'apmTitle');
    apmTitle.textContent = 'APM Layer';
    const apmToggle = add(new MockElement('input', 'apmToggle', ['toggle']));
    const apm = add(range('apmOpacitySlider', 80));
    apmOwner.appendChild(apmTitle);
    apmOwner.appendChild(apmToggle);
    apmOwner.appendChild(apm);
    panel.appendChild(apmOwner);

    const romanOwner = new MockElement('div', 'romanOwner', ['transp-layer-row']);
    const romanTitle = new MockElement('span', 'romanTitle');
    romanTitle.textContent = 'Roman Empire';
    const romanToggle = add(new MockElement('input', 'romanToggle', ['toggle']));
    const roman = add(range('romanOpacitySlider', 70));
    romanOwner.appendChild(romanTitle);
    romanOwner.appendChild(romanToggle);
    romanOwner.appendChild(roman);
    panel.appendChild(romanOwner);

    const owners = [apmOwner, romanOwner];
    doc.querySelectorAll = function (selector) {
        const sel = String(selector || '');
        if (sel.indexOf('battlesPeriodSlider') !== -1) return [apm, roman];
        if (sel === '#transpPanel .opacity-layer-selectable') return owners;
        return [];
    };

    const intervals = new Map();
    const timeouts = new Map();
    let nextId = 0;
    let now = 1000000;
    const windowMock = {
        setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
        clearInterval(id) { intervals.delete(id); },
        setTimeout(fn) { const id = ++nextId; timeouts.set(id, fn); return id; },
        clearTimeout(id) { timeouts.delete(id); },
        addEventListener() {}
    };
    windowMock.window = windowMock;
    windowMock.document = doc;

    const sandbox = {
        window: windowMock,
        document: doc,
        Event: MockEvent,
        Date: { now: () => now },
        console,
        Number,
        String,
        Math,
        isFinite
    };
    vm.createContext(sandbox);
    vm.runInContext(MODULE_SRC, sandbox, { filename: 'vertical-opacity-control.js' });

    const api = windowMock.DetectLabVerticalOpacity;
    assert(api, 'the mirror API should initialise');

    let apmChanges = 0;
    let romanChanges = 0;
    apmToggle.addEventListener('change', () => { apmChanges++; });
    romanToggle.addEventListener('change', () => { romanChanges++; });

    const pointer = (type, el, opts) => {
        const o = opts || {};
        propagate(el, new MockEvent(type, {
            bubbles: true,
            pointerType: o.pointerType === undefined ? 'touch' : o.pointerType,
            pointerId: o.pointerId || 1,
            clientX: o.x === undefined ? 100 : o.x,
            clientY: o.y === undefined ? 200 : o.y
        }));
    };

    const harness = {
        doc,
        panel,
        primary,
        secondary,
        apmOwner,
        romanOwner,
        apmTitle,
        romanTitle,
        apm,
        roman,
        apmToggle,
        romanToggle,
        api,
        intervals,
        pointerDown: (el, opts) => pointer('pointerdown', el, opts),
        pointerUp: (el, opts) => pointer('pointerup', el, opts),
        pointerCancel: (el, opts) => pointer('pointercancel', el, opts),
        clickOn: (el, opts) => {
            const o = opts || {};
            propagate(el, new MockEvent('click', {
                bubbles: true,
                pointerType: o.pointerType === undefined ? 'touch' : o.pointerType,
                clientX: o.x === undefined ? 100 : o.x,
                clientY: o.y === undefined ? 200 : o.y
            }));
        },
        scrollPanelTo(top) {
            panel.scrollTop = top;
            propagate(panel, new MockEvent('scroll', {}));
        },
        touchTap(el, opts) {
            harness.pointerDown(el, opts);
            harness.pointerUp(el, opts);
            harness.clickOn(el, opts);
        },
        setNow(value) { now = value; },
        getNow() { return now; },
        countApmChanges() { return apmChanges; },
        countRomanChanges() { return romanChanges; }
    };
    return harness;
}

/* ── 2a. Installed PWA / touch: ranges never add a mirror nor start a layer ── */

{
    const h = makeHarness({ pwa: true });
    assert(!h.primary.root.classList.contains('visible'), 'no mirror on screen at start');

    // 1. A finger that slides over the panel range while scrolling the list.
    h.setNow(1000000);
    h.pointerDown(h.apm, { pointerType: 'touch', y: 200 });
    h.pointerUp(h.apm, { pointerType: 'touch', y: 140 });
    h.clickOn(h.apm, { pointerType: 'touch', y: 140 });
    assert(!h.primary.root.classList.contains('visible'),
        'a touch drag over the panel range must not put a mirror on the map');
    assert.strictEqual(h.api.getActiveSliderId(), null, 'a touch drag on a range selects nothing');
    assert.strictEqual(h.apmToggle.checked, false, 'a touch drag on a range must not switch the layer on');
    assert.strictEqual(h.countApmChanges(), 0, 'the layer switch receives no change event');

    // 2. A plain touch tap on the range (no movement) is still only a range touch.
    h.touchTap(h.apm, { pointerType: 'touch' });
    assert(!h.primary.root.classList.contains('visible'),
        'even a clean tap on the panel range must not add its slider on the map');
    assert.strictEqual(h.apmToggle.checked, false, 'and must not start the layer');

    // 3. A deliberate tap on the layer card — this is the one that adds it.
    h.touchTap(h.apmTitle, { pointerType: 'touch' });
    assert(h.primary.root.classList.contains('visible'),
        'a deliberate tap on the layer card adds its slider on the map');
    assert.strictEqual(h.api.getActiveSliderId(), 'apmOpacitySlider', 'the tapped layer becomes the active mirror');
    assert.strictEqual(h.apmToggle.checked, true, 'the layer of the on-screen slider is switched on');
    assert.strictEqual(h.countApmChanges(), 1, 'the layer switch is driven exactly once');
    assert(!h.panel.classList.contains('open'), 'the panel closes so the mirror is visible');

    // 4. With a mirror on screen, touching its panel range only re-activates
    //    that mirror: no second slot, no second switch-on event.
    h.pointerDown(h.apm, { pointerType: 'touch' });
    assert(h.primary.root.classList.contains('visible'), 'the existing mirror stays on screen');
    assert(!h.secondary.root.classList.contains('visible'), 'touching a range never opens a second slot');
    assert.strictEqual(h.countApmChanges(), 1, 're-touching the range does not re-drive the switch');
}

/* ── 2b. Every scroll-ish gesture is ignored on the card ── */

{
    const h = makeHarness({ pwa: true });
    const TAP = { pointerType: 'touch', x: 150, y: 300 };

    // 5. Finger moved over the tolerance between press and release.
    h.pointerDown(h.apmTitle, TAP);
    h.pointerUp(h.apmTitle, { ...TAP, y: 300 + 40 });
    h.clickOn(h.apmTitle, { ...TAP, y: 300 + 40 });
    assert(!h.primary.root.classList.contains('visible'), 'a card drag (scroll) must not select the layer');

    // 6. Panel scrolled between the press and the click.
    h.pointerDown(h.apmTitle, TAP);
    h.scrollPanelTo(120);
    h.pointerUp(h.apmTitle, TAP);
    h.clickOn(h.apmTitle, TAP);
    assert(!h.primary.root.classList.contains('visible'), 'a card tap that rode a panel scroll must not select');

    // 7. Tap whose press landed on the range and whose click bubbled to the card.
    h.pointerDown(h.apm, TAP);
    h.pointerUp(h.apm, TAP);
    h.clickOn(h.apmOwner, TAP);
    assert(!h.primary.root.classList.contains('visible'), 'a tap that started on a range must not select the layer');

    // 8. A tap that only stops an in-flight panel scroll (right after a scroll).
    h.scrollPanelTo(200);
    h.touchTap(h.apmTitle, TAP);
    assert(!h.primary.root.classList.contains('visible'), 'a tap that stops a scroll must not select the layer');

    // 9. Two fingers (second pointer during the same gesture).
    h.pointerDown(h.apmTitle, { ...TAP, pointerId: 1 });
    h.pointerDown(h.romanTitle, { ...TAP, pointerId: 2, x: 190 });
    h.pointerUp(h.apmTitle, { ...TAP, pointerId: 1 });
    h.clickOn(h.apmTitle, { ...TAP, pointerId: 1 });
    assert(!h.primary.root.classList.contains('visible'), 'a two-finger gesture must not select the layer');

    // 10. Long press on touch.
    h.setNow(h.getNow() + 2000);
    h.pointerDown(h.apmTitle, TAP);
    h.setNow(h.getNow() + 1200);
    h.pointerUp(h.apmTitle, TAP);
    h.clickOn(h.apmTitle, TAP);
    assert(!h.primary.root.classList.contains('visible'), 'a long press must not select the layer');

    // 11. Now a clean, deliberate tap — and the second card too.
    h.setNow(h.getNow() + 1000);
    h.touchTap(h.apmTitle, TAP);
    assert(h.primary.root.classList.contains('visible'), 'a clean tap still selects the layer');
    h.touchTap(h.romanTitle, TAP);
    assert(h.primary.root.classList.contains('visible') && h.secondary.root.classList.contains('visible'),
        'a second deliberate tap opens the second mirror slot');
    assert.strictEqual(h.romanToggle.checked, true, 'the second layer is switched on by its own tap');
    assert.strictEqual(h.api.getActiveSliderId(), 'romanOpacitySlider', 'the last tapped layer is active');

    // 12. Closing a mirror still stops its layer (unchanged contract).
    h.secondary.close.click();
    assert.strictEqual(h.romanToggle.checked, false, 'closing the mirror switches its layer off');
}

/* ── 2c. Pointer type alone is enough on a touch device ── */

{
    const h = makeHarness({ pwa: false });
    h.touchTap(h.apm, { pointerType: 'touch' });
    assert(!h.primary.root.classList.contains('visible'),
        'a touch on a range must not select the layer even outside the PWA shell');
    h.touchTap(h.apmTitle, { pointerType: 'touch' });
    assert(h.primary.root.classList.contains('visible'),
        'a deliberate touch tap on the card still works outside the PWA shell');
}

/* ── 2d. Desktop (no PWA, mouse): the old behaviour is untouched ── */

{
    const h = makeHarness({ pwa: false });

    h.pointerDown(h.apm, { pointerType: 'mouse' });
    assert(h.primary.root.classList.contains('visible'),
        'on the desktop site touching the panel range still selects the layer');
    assert(!h.panel.classList.contains('open') === false, 'the desktop range selection keeps the panel open');
    h.primary.close.click();

    h.pointerDown(h.apmTitle, { pointerType: 'mouse', x: 10, y: 10 });
    h.pointerUp(h.apmTitle, { pointerType: 'mouse', x: 90, y: 90 });
    h.clickOn(h.apmTitle, { pointerType: 'mouse', x: 90, y: 90 });
    assert(h.primary.root.classList.contains('visible'),
        'the desktop card click keeps its previous, ungated behaviour');
}

/* ── 2e. The shipped page still loads the module ── */

assert(indexHtml.indexOf('js/vertical-opacity-control.js?v=') !== -1,
    'index.html must keep loading the mirror module with a cache-busting version');

console.log('OK — în PWA sliderul se adaugă doar la un tap deliberat pe strat;');
console.log('    atingerea unui slider și gesturile de derulare nu mai adaugă nimic.');
