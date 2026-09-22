// Regression test — two different layer mirrors can remain on the map together.
// Usage: node test-two-layer-opacity-mirrors.js
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
        this.value = '';
        this.min = '0';
        this.max = '100';
        this.step = '1';
        this.title = '';
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
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || null; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll(selector) {
        if (selector === '[data-key^="layer_"]') return [];
        return [];
    }
    closest(selector) {
        if (/input|button|label|a|select|textarea/.test(selector) &&
            /^(INPUT|BUTTON|LABEL|A|SELECT|TEXTAREA)$/.test(this.tagName)) return this;
        return this.parentElement ? this.parentElement.closest(selector) : null;
    }
    click() { this.dispatchEvent(new Event('click', { bubbles: true })); }
    focus() { this.dispatchEvent(new Event('focus')); }
}

function range(id, value) {
    const el = new MockElement('input', id, ['transp-slider']);
    el.value = String(value);
    return el;
}

const byId = {};
function add(el) { byId[el.id] = el; return el; }
function control(prefix, secondary) {
    const root = add(new MockElement('div', prefix + 'Control', ['vertical-opacity-control']));
    const close = add(new MockElement('button', prefix + 'Close'));
    const title = add(new MockElement('span', prefix + 'Title'));
    const caption = add(new MockElement('span', prefix + 'Caption'));
    const label = add(new MockElement('span', prefix + 'Layer'));
    const slider = add(range(prefix + 'Slider', 80));
    const output = add(new MockElement('output', prefix + 'Value'));
    const actions = add(new MockElement('div', prefix + 'Actions'));
    root.appendChild(close); root.appendChild(title); title.appendChild(caption); title.appendChild(label);
    root.appendChild(slider); root.appendChild(output); root.appendChild(actions);
    return { root, close, caption, label, slider, output, actions };
}

const panel = add(new MockElement('div', 'transpPanel', ['open']));
const tab = add(new MockElement('button', 'transpTab'));
tab.addEventListener('click', () => panel.classList.remove('open'));
const primary = control('verticalOpacity', false);
const secondary = control('verticalOpacitySecondary', true);
// The real secondary markup keeps the primary id before the "Secondary" suffix.
byId.verticalOpacityControlSecondary = secondary.root;
byId.verticalOpacityCloseSecondary = secondary.close;
byId.verticalOpacityCaptionSecondary = secondary.caption;
byId.verticalOpacityLayerSecondary = secondary.label;
byId.verticalOpacitySliderSecondary = secondary.slider;
byId.verticalOpacityValueSecondary = secondary.output;
byId.verticalOpacityActionsSecondary = secondary.actions;
const apmOwner = new MockElement('div', 'apmOwner');
const lidarOwner = new MockElement('div', 'lidarOwner');
const apm = add(range('apmOpacitySlider', 80));
const lidar = add(range('lidarHdOpacitySlider', 35));
apmOwner.appendChild(apm);
lidarOwner.appendChild(lidar);
panel.appendChild(apmOwner);
panel.appendChild(lidarOwner);

const allOwners = [apmOwner, lidarOwner];
const documentMock = new (class extends EventTarget {
    constructor() { super(); this.readyState = 'complete'; this.body = new MockElement('body'); }
    getElementById(id) { return byId[id] || null; }
    createElement(tag) { return new MockElement(tag); }
    querySelectorAll(selector) {
        if (selector.indexOf('[id*="Opacity"]') !== -1) return [apm, lidar];
        if (selector === '#transpPanel .opacity-layer-selectable') return allOwners;
        if (selector === '#satPeriodTicks span') return [];
        if (selector === '#satPeriodTicks span:last-child') return null;
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
    addEventListener() {}
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

const api = windowMock.DetectLabVerticalOpacity;
assert(api, 'the mirror API should initialise');

api.select('apmOpacitySlider');
assert(primary.root.classList.contains('visible'), 'the first layer should open the primary mirror');
assert(!secondary.root.classList.contains('visible'), 'the second mirror starts hidden');
assert(apmOwner.classList.contains('opacity-layer-mirrored'), 'the first row should advertise its map mirror');
assert.strictEqual(api.getActiveSliderId(), 'apmOpacitySlider');

api.select('lidarHdOpacitySlider');
assert(primary.root.classList.contains('visible'), 'the first mirror remains visible');
assert(secondary.root.classList.contains('visible'), 'the second layer opens a second mirror');
assert(apmOwner.classList.contains('opacity-layer-mirrored'), 'the first row remains marked on-map');
assert(lidarOwner.classList.contains('opacity-layer-mirrored'), 'the second row is marked on-map');
assert(lidarOwner.classList.contains('opacity-layer-selected'), 'the newly selected row is focused');
assert.strictEqual(api.getActiveSliderId(), 'lidarHdOpacitySlider');
assert.strictEqual(secondary.slider.value, '35', 'the second mirror adopts its own source value');

secondary.slider.value = '61';
secondary.slider.dispatchEvent(new Event('input'));
assert.strictEqual(lidar.value, '61', 'the second mirror drives only the second source');
assert.strictEqual(apm.value, '80', 'the first source remains independent');

secondary.close.click();
assert(primary.root.classList.contains('visible'), 'closing one mirror leaves the other open');
assert(!secondary.root.classList.contains('visible'), 'closing one mirror hides only that mirror');
assert(apmOwner.classList.contains('opacity-layer-mirrored'), 'the remaining row stays marked on-map');
assert(!lidarOwner.classList.contains('opacity-layer-mirrored'), 'the closed row returns to normal colour');
assert.strictEqual(api.getActiveSliderId(), 'apmOpacitySlider', 'focus returns to the remaining mirror');

console.log('OK — two layer sliders stay visible, sync independently, and mark their panel rows.');
