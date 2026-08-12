// Integration checks for the map-side vertical opacity mirror.
// Usage: node test-vertical-opacity-control.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Static coverage: every opacity range currently shipped by the real panel is
// discoverable by the feature selector, while the similarly styled scanner
// distance range is not.
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const rangeTags = indexHtml.match(/<input\b[^>]*>/gis) || [];
const opacityIds = rangeTags.filter(function (tag) {
    return /class="[^"]*transp-slider/.test(tag) && /type="range"/.test(tag) && /id="[^"]*Opacity/.test(tag);
}).map(function (tag) {
    return (tag.match(/id="([^"]+)"/) || [])[1];
});
assert.strictEqual(opacityIds.length, 33, 'all 33 shipped layer opacity ranges should be discoverable');
assert(!opacityIds.includes('lidarScannerDistance'), 'scanner distance is not an opacity range');
assert(indexHtml.includes('body.is-pwa .transp-panel'), 'page should retain its installed-PWA layer panel mode');

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
        this.textContent = '';
        this.title = '';
        this.value = '';
        this.min = '';
        this.max = '';
        this.step = '';
        this.focused = false;
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
    focus() { this.focused = true; this.dispatchEvent(new Event('focus')); }
}

function range(id, value) {
    const input = new MockElement('input', id, ['transp-slider']);
    input.value = String(value);
    input.min = '0';
    input.max = '100';
    input.step = '1';
    return input;
}

const panel = new MockElement('div', 'transpPanel', ['open']);
const tab = new MockElement('button', 'transpTab');
const control = new MockElement('div', 'verticalOpacityControl');
const vertical = range('verticalOpacitySlider', 80);
vertical.classList = new ClassList(['vertical-opacity-slider']);
const output = new MockElement('output', 'verticalOpacityValue');
const label = new MockElement('span', 'verticalOpacityLayer');
const close = new MockElement('button', 'verticalOpacityClose');

const apmOwner = new MockElement('div', 'apmOwner', ['transp-layer-row']);
const apmTitle = new MockElement('span');
apmTitle.textContent = 'APM Layer';
apmTitle.setAttribute('data-key', 'layer_apm');
const apm = range('apmOpacitySlider', 80);
apmOwner.appendChild(apmTitle);
apmOwner.appendChild(apm);
panel.appendChild(apmOwner);

const lidarOwner = new MockElement('div', 'lidarOwner');
const lidar = range('lidarHdOpacitySlider', 0);
lidarOwner.appendChild(lidar);
panel.appendChild(lidarOwner);

// This visually similar range is not opacity and must never become selectable.
const distanceOwner = new MockElement('div', 'distanceOwner');
const distance = range('lidarScannerDistance', 10);
distanceOwner.appendChild(distance);
panel.appendChild(distanceOwner);

const byId = {};
[panel, tab, control, vertical, output, label, close, apm, lidar, distance].forEach(function (el) {
    byId[el.id] = el;
});

let panelCloseClicks = 0;
tab.addEventListener('click', function () {
    panelCloseClicks++;
    panel.classList.remove('open');
});

const documentMock = new (class extends EventTarget {
    constructor() { super(); this.readyState = 'complete'; }
    getElementById(id) { return byId[id] || null; }
    querySelectorAll(selector) {
        if (selector.indexOf('[id*="Opacity"]') !== -1) return [apm, lidar];
        return [];
    }
})();

const intervals = new Map();
let intervalId = 0;
const windowMock = {
    setInterval(fn) { const id = ++intervalId; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); }
};

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
windowMock.window = windowMock;
windowMock.document = documentMock;
vm.createContext(sandbox);
vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'js/vertical-opacity-control.js'), 'utf8'),
    sandbox,
    { filename: 'vertical-opacity-control.js' }
);

assert(apmOwner.classList.contains('opacity-layer-selectable'), 'APM row should be clickable');
assert(lidarOwner.classList.contains('opacity-layer-selectable'), 'nested LIDAR row should be clickable');
assert(!distanceOwner.classList.contains('opacity-layer-selectable'), 'distance range must not register as opacity');

// Clicking a layer row selects it, opens the vertical mirror and closes the panel.
apmOwner.click();
assert.strictEqual(windowMock.DetectLabVerticalOpacity.getActiveSliderId(), 'apmOpacitySlider');
assert(control.classList.contains('visible'), 'vertical control should become visible');
assert(apmOwner.classList.contains('opacity-layer-selected'), 'selected row should be highlighted');
assert.strictEqual(panelCloseClicks, 1, 'existing layer panel should close via its own tab');
assert.strictEqual(label.textContent, 'APM Layer', 'translated live layer title should be used');
assert.strictEqual(vertical.value, '80');
assert.strictEqual(output.textContent, '80%');

// Dragging the vertical mirror must drive the real source range's input logic.
let sourceInputs = 0;
apm.addEventListener('input', function () { sourceInputs++; });
vertical.value = '37';
vertical.dispatchEvent(new Event('input'));
assert.strictEqual(apm.value, '37', 'vertical value should propagate to source');
assert.strictEqual(sourceInputs, 1, 'source input event should fire exactly once');
assert.strictEqual(output.textContent, '37%');

// Selecting another source updates selection and uses its fallback name.
windowMock.DetectLabVerticalOpacity.select('lidarHdOpacitySlider');
assert.strictEqual(windowMock.DetectLabVerticalOpacity.getActiveSliderId(), 'lidarHdOpacitySlider');
assert(!apmOwner.classList.contains('opacity-layer-selected'), 'old row highlight should clear');
assert(lidarOwner.classList.contains('opacity-layer-selected'), 'new row should be highlighted');
assert.strictEqual(label.textContent, 'HD · Hunedoara');
assert.strictEqual(output.textContent, '0%');

// The polling sync covers existing code that assigns source.value directly.
lidar.value = '64';
intervals.forEach(function (fn) { fn(); });
assert.strictEqual(vertical.value, '64');
assert.strictEqual(output.textContent, '64%');

close.click();
assert(!control.classList.contains('visible'), 'close button should hide the mirror');
assert.strictEqual(windowMock.DetectLabVerticalOpacity.getActiveSliderId(), null);
assert.strictEqual(intervals.size, 0, 'sync timer should stop when closed');

console.log('✅ test-vertical-opacity-control.js passed: layer click, vertical sync, filtering and close behavior work.');
