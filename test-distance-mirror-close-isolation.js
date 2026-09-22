// Regression test — closing a distance mirror (LIDAR Scanner / „Zone cu
// potențial arheologic” / „Raport arheologic”) that sits on the map as the
// SECOND slider must close only that slider and deactivate only its own
// layer; the neighbouring mirror stays open with its layer on.
//
// Previously the analysis modules answered their own layer shutdown with the
// GLOBAL mirror close() (closeAllControls): because clearSlot re-fires the
// layer switch's change event DURING the mirror teardown, the module saw its
// mirror still „active” and closed every on-screen mirror, also deactivating
// the other layer (its panel switch unchecked). The modules now use the
// single-slot closeFor(id) API, and isActiveFor(id) no longer reports the
// slot that is currently being torn down.
//
// The REAL modules are loaded over a mock DOM (same pattern as
// test-two-layer-opacity-mirrors.js): js/vertical-opacity-control.js,
// js/archeo-potential.js, js/lidar-scanner.js, js/archeo-report.js.
//
// Usage: node test-distance-mirror-close-isolation.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

class MockElement extends EventTarget {
    constructor(tag, id, classes) {
        super();
        this.tagName = String(tag || 'div').toUpperCase();
        this.id = id || '';
        this.classList = new ClassList(classes);
        this.parentElement = null;
        this.children = [];
        this.attributes = {};
        this.style = {};
        this.dataset = {};
        this.textContent = '';
        this.innerHTML = '';
        this.value = '';
        this.min = '0';
        this.max = '100';
        this.step = '1';
        this.title = '';
        this.checked = false;
        this.disabled = false;
    }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) {
        if (child.parentElement) child.parentElement.removeChild(child);
        child.parentElement = this; this.children.push(child); return child;
    }
    insertBefore(child, ref) {
        if (child.parentElement) child.parentElement.removeChild(child);
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
    contains(node) {
        for (let cur = node; cur; cur = cur.parentElement) if (cur === this) return true;
        return false;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    _matchesOne(sel) {
        sel = sel.trim();
        if (!sel) return false;
        if (sel[0] === '.') return this.classList.contains(sel.slice(1));
        if (sel[0] === '[') return false;
        return this.tagName === sel.toUpperCase();
    }
    closest(selector) {
        const wanted = String(selector || '').split(',').map(s => s.trim()).filter(Boolean);
        for (let cur = this; cur; cur = cur.parentElement) {
            for (const sel of wanted) {
                if ((/^\./.test(sel) || /^[A-Za-z]+$/.test(sel)) && cur._matchesOne && cur._matchesOne(sel)) {
                    return cur;
                }
            }
        }
        return null;
    }
    click() { this.dispatchEvent(new Event('click', { bubbles: true })); }
    focus() { this.dispatchEvent(new Event('focus')); }
}

function range(id, value, min, max, step) {
    const el = new MockElement('input', id, ['transp-slider']);
    el.value = String(value);
    if (min !== undefined) el.min = String(min);
    if (max !== undefined) el.max = String(max);
    if (step !== undefined) el.step = String(step);
    return el;
}
function toggle(id) { const el = new MockElement('input', id, []); el.setAttribute('type', 'checkbox'); return el; }

const byId = {};
function add(el) { if (el.id) byId[el.id] = el; return el; }

function buildControl(prefix) {
    const root = add(new MockElement('div', prefix + 'Control', ['vertical-opacity-control']));
    const close = add(new MockElement('button', prefix + 'Close'));
    const title = add(new MockElement('span', prefix + 'Title'));
    const caption = add(new MockElement('span', prefix + 'Caption'));
    const label = add(new MockElement('span', prefix + 'Layer'));
    const slider = add(range(prefix + 'Slider', 80));
    const output = add(new MockElement('output', prefix + 'Value'));
    const actions = add(new MockElement('div', prefix + 'Actions', ['vertical-opacity-actions']));
    root.appendChild(close); root.appendChild(title); title.appendChild(caption); title.appendChild(label);
    root.appendChild(slider); root.appendChild(output); root.appendChild(actions);
    return { root, close, caption, label, slider, output, actions };
}

// ── Panel rows (mirroring index.html: row > inner container > slider) ──────
const panel = add(new MockElement('div', 'transpPanel', []));
const apmOwner = new MockElement('div', '', []);
const apm = add(range('apmOpacitySlider', 80));
const apmToggle = add(toggle('apmToggle'));
apmOwner.appendChild(apm);
panel.appendChild(apmOwner);

function distanceRow(rowId, toggleId, sliderId, val, min, max, runId, valueId) {
    const row = add(new MockElement('div', rowId, ['transp-layer-row']));
    const innerWrap = new MockElement('div', '', []);
    const chk = add(toggle(toggleId));
    const slider = add(range(sliderId, val, min, max, 1));
    const value = add(new MockElement('strong', valueId));
    const run = add(new MockElement('button', runId, []));
    run.style.display = 'none';
    innerWrap.appendChild(slider);
    row.appendChild(chk);
    row.appendChild(innerWrap);
    row.appendChild(value);
    row.appendChild(run);
    panel.appendChild(row);
    return { row, chk, slider, run, value };
}

add(new MockElement('span', 'lidarScannerStatus'));
const lidar = distanceRow('lidarScannerRow', 'lidarScannerToggle', 'lidarScannerDistance', 10, 10, 50, 'lidarScannerRun', 'lidarScannerDistanceValue');
add(new MockElement('span', 'archReportStatus'));
const arch = distanceRow('archReportRow', 'archReportToggle', 'archReportDistance', 3, 1, 10, 'archReportRunBtn', 'archReportDistanceValue');
add(new MockElement('span', 'archeoPotStatus'));
const pot = distanceRow('archeoPotentialRow', 'archeoPotToggle', 'archeoPotDistance', 10, 1, 10, 'archeoPotRunBtn', 'archeoPotDistanceValue');

const dock = add(new MockElement('div', 'layerActionDock', ['layer-action-dock']));
const dockInner = add(new MockElement('div', 'layerActionDockInner', []));
dock.appendChild(dockInner);

const primary = buildControl('verticalOpacity');
const secondary = buildControl('verticalOpacitySecondary');
// The real secondary markup keeps the primary stem + "Secondary" suffix.
byId.verticalOpacityControlSecondary = secondary.root;
byId.verticalOpacityCloseSecondary = secondary.close;
byId.verticalOpacityCaptionSecondary = secondary.caption;
byId.verticalOpacityLayerSecondary = secondary.label;
byId.verticalOpacitySliderSecondary = secondary.slider;
byId.verticalOpacityValueSecondary = secondary.output;
byId.verticalOpacityActionsSecondary = secondary.actions;

const allRows = [apmOwner, lidar.row, arch.row, pot.row];

const documentMock = new (class extends EventTarget {
    constructor() { super(); this.readyState = 'complete'; this.body = new MockElement('body'); }
    getElementById(id) { return byId[id] || null; }
    createElement(tag) { return new MockElement(tag); }
    querySelectorAll(selector) {
        if (selector.indexOf('[id*="Opacity"]') !== -1) return [apm];
        if (selector === '#transpPanel .opacity-layer-selectable') return allRows;
        if (selector === '#satPeriodTicks span') return [];
        return [];
    }
})();

const intervals = new Map();
const timeouts = new Map();
let nextId = 0;
const windowMock = {
    setInterval(fn) { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { const id = ++nextId; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    addEventListener() {},
    _dlMap: {
        _layers: new Set(),
        on() {}, off() {},
        hasLayer(l) { return this._layers.has(l); },
        removeLayer(l) { this._layers.delete(l); },
        addLayer(l) { this._layers.add(l); },
        createPane() {}, getPane() { return null; }
    }
};
windowMock.window = windowMock;
windowMock.document = documentMock;

const sandbox = {
    window: windowMock,
    document: documentMock,
    Event,
    console,
    Number, String, Math, Boolean, Object, Array, JSON, Promise, Date, RegExp, Error,
    isFinite, parseFloat, parseInt, encodeURIComponent,
    // The LIDAR Scanner prefetches its CSV the moment its layer switches on;
    // stay offline here — the module consumes the rejection itself.
    fetch: () => Promise.reject(new Error('offline mock')),
    setTimeout: windowMock.setTimeout,
    clearTimeout: windowMock.clearTimeout,
    setInterval: windowMock.setInterval,
    clearInterval: windowMock.clearInterval
};
vm.createContext(sandbox);

// Load order taken from index.html.
for (const file of [
    'js/vertical-opacity-control.js',
    'js/archeo-potential.js',
    'js/lidar-scanner.js',
    'js/archeo-report.js'
]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
}

const api = windowMock.DetectLabVerticalOpacity;
assert(api, 'the vertical-opacity API should initialise');
assert.strictEqual(typeof api.closeFor, 'function', 'the API should expose the single-slot closeFor(id)');

function visible(el) { return el.classList.contains('visible'); }
function turnOn(chk) { chk.checked = true; chk.dispatchEvent(new Event('change', { bubbles: true })); }
function turnOff(chk) { chk.checked = false; chk.dispatchEvent(new Event('change', { bubbles: true })); }
function assertOnlyPrimary(where) {
    assert(visible(primary.root), where + ': the first mirror must stay open');
    assert.strictEqual(apmToggle.checked, true, where + ': the first layer must stay activated');
    assert(!visible(secondary.root), where + ': the second mirror must be closed');
    assert.strictEqual(api.getActiveSliderId(), 'apmOpacitySlider', where + ': focus must return to the remaining mirror');
    assert(primary.root.classList.contains('mirror-sole'), where + ': the remaining lone mirror takes the right-most anchor');
}
function assertAllClosed(where) {
    assert(!visible(primary.root), where + ': primary mirror should be closed');
    assert(!visible(secondary.root), where + ': secondary mirror should be closed');
}

// ── Scenario 1: opacity mirror first + LIDAR Scanner second, close with „×”
api.select('apmOpacitySlider');
assert(visible(primary.root), 'the first layer opens the primary mirror');
assert.strictEqual(apmToggle.checked, true, 'adding the mirror auto-activates its layer');
turnOn(lidar.chk);
assert(visible(secondary.root), 'LIDAR Scanner opens as the second mirror');
assert.strictEqual(api.getActiveSliderId(), 'lidarScannerDistance', 'the new mirror takes focus');
assert(!primary.root.classList.contains('mirror-sole'), 'two mirrors keep their pair anchors');
secondary.close.click();
assert.strictEqual(lidar.chk.checked, false, 'closing the LIDAR mirror deactivates the LIDAR layer');
assertOnlyPrimary('LIDAR Scanner closed with „×” as the second slider');

// ── Scenario 2: same, but closed by switching the layer OFF from the panel
turnOn(lidar.chk);
assert(visible(secondary.root), 'LIDAR mirror reopens as the second mirror');
turnOff(lidar.chk);
assertOnlyPrimary('LIDAR Scanner switched off from the panel');

// ── Scenario 3: „Raport arheologic” second, close with „×”
turnOn(arch.chk);
assert(visible(secondary.root), 'Archaeological Report opens as the second mirror');
assert.strictEqual(api.getActiveSliderId(), 'archReportDistance');
secondary.close.click();
assert.strictEqual(arch.chk.checked, false, 'closing the report mirror deactivates the report layer');
assertOnlyPrimary('Archaeological Report closed with „×” as the second slider');

// ── Scenario 4: „Zone cu potențial arheologic” second, close with „×”
turnOn(pot.chk);
assert(visible(secondary.root), 'Archaeological Potential opens as the second mirror');
assert.strictEqual(api.getActiveSliderId(), 'archeoPotDistance');
secondary.close.click();
assert.strictEqual(pot.chk.checked, false, 'closing the potential mirror deactivates the potential layer');
assertOnlyPrimary('Archaeological Potential closed with „×” as the second slider');

// ── Scenario 5: TWO distance mirrors — closing one keeps the other layer on
// (primary slot free for a moment so the new mirrors land on distinct slots)
primary.close.click();
assertAllClosed('setup: both slots free');
turnOn(pot.chk);
assert(visible(primary.root), 'the potential mirror takes the first free slot');
turnOn(lidar.chk);
assert(visible(secondary.root), 'the LIDAR mirror joins as the second mirror');
assert.strictEqual(api.getActiveSliderId(), 'lidarScannerDistance');
secondary.close.click();
assert.strictEqual(lidar.chk.checked, false, 'LIDAR layer deactivated by its own mirror close');
assert(visible(primary.root), 'the potential mirror survives the LIDAR close');
assert.strictEqual(pot.chk.checked, true, 'the potential layer stays on');
assert.strictEqual(api.getActiveSliderId(), 'archeoPotDistance', 'focus returns to the potential mirror');
primary.close.click();
assertAllClosed('scenario 5 teardown');
assert.strictEqual(pot.chk.checked, false, 'closing the potential mirror deactivates its own layer');

// ── Scenario 6: programmatic OFF (no change event — e.g. premium expiry)
turnOn(lidar.chk);
assert(visible(primary.root) || visible(secondary.root), 'LIDAR mirror on screen');
windowMock.toggleLidarScannerLayer(false);
assert(!visible(primary.root) && !visible(secondary.root), 'programmatic LIDAR shutdown closes only its mirror');
assert.strictEqual(lidar.chk.checked, false, 'the LIDAR switch follows the programmatic shutdown');
turnOn(pot.chk);
assert(visible(primary.root) || visible(secondary.root), 'potential mirror on screen');
windowMock.toggleArcheoPotentialLayer(false);
assert(!visible(primary.root) && !visible(secondary.root), 'programmatic potential shutdown closes only its mirror');
assert.strictEqual(pot.chk.checked, false, 'the potential switch follows the programmatic shutdown');
turnOn(arch.chk);
assert(visible(primary.root) || visible(secondary.root), 'report mirror on screen');
windowMock.toggleArcheoReportLayer(false);
assert(!visible(primary.root) && !visible(secondary.root), 'programmatic report shutdown closes only its mirror');
assert.strictEqual(arch.chk.checked, false, 'the report switch follows the programmatic shutdown');

// ── Scenario 7: the documented Escape/global close still closes everything
api.select('apmOpacitySlider');
turnOn(lidar.chk);
assert(visible(primary.root) && visible(secondary.root), 'both mirrors on screen');
api.close();
assertAllClosed('api.close() (Escape)');
assert.strictEqual(apmToggle.checked, false, 'global close deactivates the first layer too');
assert.strictEqual(lidar.chk.checked, false, 'global close deactivates the second layer too');

// ── Scenario 8: closeFor on a mirror that is not on the map is a no-op
api.closeFor('archReportDistance');
api.closeFor('archeoPotDistance');
api.closeFor('lidarScannerDistance');
assertAllClosed('closeFor() without a visible mirror');
assert.strictEqual(api.getActiveSliderId(), null, 'no active mirror at the end');

console.log('OK — a distance mirror closed as the second slider only takes down its own layer;');
console.log('    the neighbouring mirror and layer stay on (×, panel switch, programmatic shutdown).');
